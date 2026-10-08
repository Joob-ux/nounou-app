import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../middleware/error";
import { authenticate, requireRole } from "../../middleware/auth";
import { singleFile } from "../../middleware/upload";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors";
import { deleteFile, saveFile } from "../../lib/storage";
import { checklist, missingProfileFields } from "./verification";

const BOOKING_TYPES = ["PONCTUELLE", "SORTIE_ECOLE", "REGULIERE", "NUIT"] as const;
const DOC_TYPES = ["CNI", "CASIER_JUDICIAIRE", "JUSTIFICATIF_DOMICILE", "CERTIFICAT_SCOLARITE", "REFERENCE"] as const;

export const nanniesRouter = Router();

/* ------------------------------------------------------------------ */
/* Espace nounou : /me (declare AVANT /:id pour ne pas etre capture)   */
/* ------------------------------------------------------------------ */

const me = Router();
me.use(authenticate, requireRole("NANNY"));

const profileFields = {
  fullName: z.string().trim().min(2).max(80),
  bio: z.string().trim().max(600).optional(),
  neighborhood: z.string().trim().min(2).max(60),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  radiusKm: z.number().int().min(1).max(30).optional(),
  hourlyRateXof: z.number().int().min(500).max(20_000),
  languages: z.array(z.string().trim().min(2)).min(1).max(6).optional(),
  experienceYears: z.number().int().min(0).max(50).optional(),
  isStudent: z.boolean().optional(),
  school: z.string().trim().max(120).optional(),
  fieldOfStudy: z.string().trim().max(120).optional(),
  firstAidCertified: z.boolean().optional(),
  bookingTypes: z.array(z.enum(BOOKING_TYPES)).min(1).optional(),
};

const createSchema = z.object(profileFields).refine((p) => !p.isStudent || !!p.school, {
  message: "Indiquez l'etablissement si vous etes etudiante",
  path: ["school"],
});

const updateSchema = z
  .object({ ...profileFields, examModeUntil: z.coerce.date().nullable().optional() })
  .partial()
  .refine((o) => Object.keys(o).length > 0, { message: "Rien a modifier" });

/** Ces champs touchent a l'identite verifiee : figes pendant l'examen et apres validation. */
const LOCKED_WHEN_REVIEWED = ["fullName", "isStudent"] as const;

const ownProfileInclude = {
  documents: {
    orderBy: { createdAt: "desc" as const },
    select: { id: true, type: true, status: true, note: true, createdAt: true, reviewedAt: true },
  },
  availabilities: { orderBy: [{ weekday: "asc" as const }, { startTime: "asc" as const }] },
  wallet: { select: { balanceXof: true, pendingXof: true } },
};

async function getOwnProfile(userId: string) {
  const profile = await prisma.nannyProfile.findUnique({ where: { userId }, include: ownProfileInclude });
  if (!profile) throw notFound("Profil nounou non cree");
  return profile;
}

/** Profil + etat du dossier de verification : ce que l'appli affiche dans "Mon dossier". */
function withDossier(profile: Awaited<ReturnType<typeof getOwnProfile>>) {
  const list = checklist(profile.isStudent, profile.documents);
  const missingFields = missingProfileFields(profile);
  return {
    ...profile,
    dossier: {
      ...list,
      missingFields,
      canSubmit:
        (profile.verificationStatus === "PENDING" || profile.verificationStatus === "REJECTED") &&
        list.allUploaded &&
        missingFields.length === 0,
    },
  };
}

me.post(
  "/",
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const exists = await prisma.nannyProfile.findUnique({ where: { userId: req.user!.id } });
    if (exists) throw conflict("PROFILE_EXISTS", "Profil nounou deja cree");

    const body = req.body as z.infer<typeof createSchema>;
    await prisma.nannyProfile.create({
      data: {
        ...body,
        languages: body.languages ?? ["Francais", "Wolof"],
        bookingTypes: body.bookingTypes ?? ["PONCTUELLE"],
        userId: req.user!.id,
        wallet: { create: {} },
      },
    });
    res.status(201).json(withDossier(await getOwnProfile(req.user!.id)));
  }),
);

me.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(withDossier(await getOwnProfile(req.user!.id)));
  }),
);

me.patch(
  "/",
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const profile = await getOwnProfile(req.user!.id);
    const reviewed = profile.verificationStatus === "UNDER_REVIEW" || profile.verificationStatus === "VERIFIED";
    if (reviewed) {
      const touched = LOCKED_WHEN_REVIEWED.filter((f) => f in req.body);
      if (touched.length) {
        throw forbidden(`Modification impossible apres soumission du dossier : ${touched.join(", ")}. Contactez le support.`);
      }
    }
    const next = { ...profile, ...req.body };
    if (next.isStudent && !next.school) throw badRequest("SCHOOL_REQUIRED", "Indiquez l'etablissement");

    await prisma.nannyProfile.update({ where: { userId: req.user!.id }, data: req.body });
    res.json(withDossier(await getOwnProfile(req.user!.id)));
  }),
);

/* Disponibilites hebdomadaires : la liste envoyee remplace l'ancienne */

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Format HH:MM");
const slotsSchema = z.object({
  slots: z
    .array(
      z
        .object({ weekday: z.number().int().min(0).max(6), startTime: hhmm, endTime: hhmm })
        .refine((s) => s.startTime < s.endTime, { message: "L'heure de fin doit suivre l'heure de debut" }),
    )
    .max(42),
});

me.put(
  "/availabilities",
  validate(slotsSchema),
  asyncHandler(async (req, res) => {
    const profile = await getOwnProfile(req.user!.id);
    const slots = (req.body as z.infer<typeof slotsSchema>).slots;

    // Refuse les creneaux qui se chevauchent le meme jour
    const byDay = new Map<number, { startTime: string; endTime: string }[]>();
    for (const s of slots) byDay.set(s.weekday, [...(byDay.get(s.weekday) ?? []), s]);
    for (const [day, list] of byDay) {
      list.sort((a, b) => a.startTime.localeCompare(b.startTime));
      for (let i = 1; i < list.length; i++) {
        if (list[i].startTime < list[i - 1].endTime) {
          throw badRequest("SLOT_OVERLAP", `Creneaux qui se chevauchent le jour ${day}`);
        }
      }
    }

    await prisma.$transaction([
      prisma.availability.deleteMany({ where: { nannyId: profile.id, weekday: { not: null } } }),
      prisma.availability.createMany({ data: slots.map((s) => ({ ...s, nannyId: profile.id })) }),
    ]);
    res.json(await prisma.availability.findMany({
      where: { nannyId: profile.id },
      orderBy: [{ weekday: "asc" }, { startTime: "asc" }],
    }));
  }),
);

/* Pieces justificatives : multipart/form-data, champs "type" et "file" */

me.post(
  "/documents",
  singleFile,
  validate(z.object({ type: z.enum(DOC_TYPES) })),
  asyncHandler(async (req, res) => {
    const profile = await getOwnProfile(req.user!.id);
    if (profile.verificationStatus === "UNDER_REVIEW") {
      throw conflict("DOSSIER_LOCKED", "Dossier en cours d'examen : attendez la reponse de l'equipe");
    }
    const { key } = await saveFile(`nannies/${profile.id}`, req.file!.buffer);
    const doc = await prisma.verificationDocument.create({
      data: { nannyId: profile.id, type: req.body.type, fileKey: key },
      select: { id: true, type: true, status: true, createdAt: true },
    });
    res.status(201).json(doc);
  }),
);

me.delete(
  "/documents/:id",
  asyncHandler(async (req, res) => {
    const profile = await getOwnProfile(req.user!.id);
    const doc = await prisma.verificationDocument.findFirst({ where: { id: req.params.id, nannyId: profile.id } });
    if (!doc) throw notFound("Piece introuvable");
    if (doc.status === "VERIFIED") throw conflict("DOC_VERIFIED", "Une piece deja validee ne peut pas etre supprimee");
    if (profile.verificationStatus === "UNDER_REVIEW") throw conflict("DOSSIER_LOCKED", "Dossier en cours d'examen");

    await prisma.verificationDocument.delete({ where: { id: doc.id } });
    await deleteFile(doc.fileKey);
    res.status(204).end();
  }),
);

/** La nounou envoie son dossier complet a l'equipe. */
me.post(
  "/submit",
  asyncHandler(async (req, res) => {
    const view = withDossier(await getOwnProfile(req.user!.id));
    if (view.verificationStatus === "UNDER_REVIEW") throw conflict("ALREADY_SUBMITTED", "Dossier deja en cours d'examen");
    if (view.verificationStatus === "VERIFIED") throw conflict("ALREADY_VERIFIED", "Profil deja verifie");
    if (!view.dossier.canSubmit) {
      const missingDocs = view.dossier.items
        .filter((i) => i.status === "MISSING" || i.status === "REJECTED")
        .map((i) => i.label);
      throw badRequest(
        "DOSSIER_INCOMPLETE",
        [...missingDocs, ...view.dossier.missingFields].join(" ; ") || "Dossier incomplet",
      );
    }
    await prisma.nannyProfile.update({
      where: { id: view.id },
      data: { verificationStatus: "UNDER_REVIEW" },
    });
    res.json(withDossier(await getOwnProfile(req.user!.id)));
  }),
);

nanniesRouter.use("/me", me);

/* ------------------------------------------------------------------ */
/* Routes publiques                                                    */
/* ------------------------------------------------------------------ */

const searchSchema = z.object({
  neighborhood: z.string().trim().optional(),
  type: z.enum(BOOKING_TYPES).optional(),
  maxRate: z.coerce.number().int().positive().optional(),
  isStudent: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  firstAid: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(50).default(20),
});

/** Recherche publique : seules les nounous verifiees, actives et hors periode d'examens sortent. */
nanniesRouter.get(
  "/",
  validate(searchSchema, "query"),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof searchSchema>;
    const where = {
      verificationStatus: "VERIFIED" as const,
      user: { status: "ACTIVE" as const },
      ...(q.neighborhood ? { neighborhood: { equals: q.neighborhood, mode: "insensitive" as const } } : {}),
      ...(q.type ? { bookingTypes: { has: q.type } } : {}),
      ...(q.maxRate ? { hourlyRateXof: { lte: q.maxRate } } : {}),
      ...(q.isStudent !== undefined ? { isStudent: q.isStudent } : {}),
      ...(q.firstAid ? { firstAidCertified: true } : {}),
      OR: [{ examModeUntil: null }, { examModeUntil: { lt: new Date() } }],
    };

    const [total, items] = await Promise.all([
      prisma.nannyProfile.count({ where }),
      prisma.nannyProfile.findMany({
        where,
        orderBy: [{ ratingAvg: "desc" }, { ratingCount: "desc" }],
        skip: (q.page - 1) * q.perPage,
        take: q.perPage,
        select: {
          id: true, fullName: true, photoUrl: true, neighborhood: true, bio: true,
          hourlyRateXof: true, languages: true, experienceYears: true, bookingTypes: true,
          isStudent: true, school: true, firstAidCertified: true, ratingAvg: true,
          ratingCount: true, verifiedAt: true,
        },
      }),
    ]);

    res.json({ total, page: q.page, perPage: q.perPage, items });
  }),
);

nanniesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const nanny = await prisma.nannyProfile.findFirst({
      where: { id: req.params.id, verificationStatus: "VERIFIED", user: { status: "ACTIVE" } },
      select: {
        id: true, fullName: true, photoUrl: true, bio: true, neighborhood: true,
        hourlyRateXof: true, languages: true, experienceYears: true, isStudent: true,
        school: true, fieldOfStudy: true, firstAidCertified: true, bookingTypes: true,
        ratingAvg: true, ratingCount: true, verifiedAt: true,
        availabilities: { select: { weekday: true, startTime: true, endTime: true, isAvailable: true } },
      },
    });
    // Jamais de pieces d'identite ni de coordonnees ici : seul le back-office y accede.
    if (!nanny) throw notFound("Nounou introuvable");
    const reviews = await prisma.review.findMany({
      where: { targetId: nanny.id, publishedAt: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { punctuality: true, care: true, communication: true, instructions: true, comment: true, createdAt: true },
    });
    res.json({ ...nanny, reviews });
  }),
);
