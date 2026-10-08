import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../middleware/error";
import { authenticate, requireRole } from "../../middleware/auth";
import { badRequest, conflict, notFound } from "../../lib/errors";
import { readFile } from "../../lib/storage";
import { audit } from "../../lib/audit";
import { revokeAllRefreshTokens } from "../../lib/tokens";
import { checklist, DOC_LABELS } from "../nannies/verification";

export const adminRouter = Router();
adminRouter.use(authenticate, requireRole("ADMIN"));

/* Tableau de bord */

adminRouter.get(
  "/stats",
  asyncHandler(async (_req, res) => {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [nannies, parents, bookings30d, revenue30d, openDisputes] = await Promise.all([
      prisma.nannyProfile.groupBy({ by: ["verificationStatus"], _count: true }),
      prisma.parentProfile.count(),
      prisma.booking.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: true }),
      prisma.booking.aggregate({
        where: { createdAt: { gte: since }, status: { in: ["COMPLETED", "PAID_OUT"] } },
        _sum: { feeXof: true, commissionXof: true, totalXof: true },
      }),
      prisma.dispute.count({ where: { status: { in: ["OPEN", "UNDER_REVIEW"] } } }),
    ]);

    res.json({
      nannies: Object.fromEntries(nannies.map((n) => [n.verificationStatus, n._count])),
      parents,
      bookingsLast30Days: Object.fromEntries(bookings30d.map((b) => [b.status, b._count])),
      revenueLast30Days: {
        volumeXof: revenue30d._sum.totalXof ?? 0,
        // Ce que garde la plateforme : frais parent + commission nounou
        platformXof: (revenue30d._sum.feeXof ?? 0) + (revenue30d._sum.commissionXof ?? 0),
      },
      openDisputes,
    });
  }),
);

/* Dossiers nounous */

const listSchema = z.object({
  status: z.enum(["PENDING", "UNDER_REVIEW", "VERIFIED", "REJECTED"]).default("UNDER_REVIEW"),
  q: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(30),
});

/** File d'attente : par defaut les dossiers soumis, les plus anciens d'abord. */
adminRouter.get(
  "/nannies",
  validate(listSchema, "query"),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof listSchema>;
    const where = {
      verificationStatus: q.status,
      ...(q.q
        ? {
            OR: [
              { fullName: { contains: q.q, mode: "insensitive" as const } },
              { user: { phone: { contains: q.q } } },
              { neighborhood: { contains: q.q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const [total, items] = await Promise.all([
      prisma.nannyProfile.count({ where }),
      prisma.nannyProfile.findMany({
        where,
        orderBy: { createdAt: "asc" },
        skip: (q.page - 1) * q.perPage,
        take: q.perPage,
        select: {
          id: true, fullName: true, neighborhood: true, isStudent: true, school: true,
          hourlyRateXof: true, verificationStatus: true, createdAt: true,
          user: { select: { phone: true, status: true } },
          _count: { select: { documents: true } },
        },
      }),
    ]);
    res.json({ total, page: q.page, perPage: q.perPage, items });
  }),
);

async function loadDossier(nannyId: string) {
  const nanny = await prisma.nannyProfile.findUnique({
    where: { id: nannyId },
    include: {
      user: { select: { id: true, phone: true, email: true, status: true, createdAt: true } },
      documents: { orderBy: { createdAt: "desc" } },
      availabilities: true,
    },
  });
  if (!nanny) throw notFound("Nounou introuvable");
  return nanny;
}

/** Dossier complet : coordonnees, pieces, checklist et historique des decisions. */
adminRouter.get(
  "/nannies/:id",
  asyncHandler(async (req, res) => {
    const nanny = await loadDossier(req.params.id);
    const history = await prisma.auditLog.findMany({
      where: {
        OR: [
          { entity: "NannyProfile", entityId: nanny.id },
          { entity: "VerificationDocument", entityId: { in: nanny.documents.map((d) => d.id) } },
          { entity: "User", entityId: nanny.userId },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { admin: { select: { phone: true } } },
    });
    res.json({
      ...nanny,
      documents: nanny.documents.map(({ fileKey: _hidden, ...d }) => ({ ...d, label: DOC_LABELS[d.type] })),
      checklist: checklist(nanny.isStudent, nanny.documents),
      history,
    });
  }),
);

/** Ouvre une piece. Chaque consultation est journalisee (donnees sensibles, loi CDP). */
adminRouter.get(
  "/documents/:id/file",
  asyncHandler(async (req, res) => {
    const doc = await prisma.verificationDocument.findUnique({ where: { id: req.params.id } });
    if (!doc) throw notFound("Piece introuvable");
    const { buf, mime } = await readFile(doc.fileKey);
    await audit(req.user!.id, "DOCUMENT_VIEWED", "VerificationDocument", doc.id, { type: doc.type });
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Cache-Control", "no-store");
    res.send(buf);
  }),
);

const reviewSchema = z
  .object({ status: z.enum(["VERIFIED", "REJECTED"]), note: z.string().trim().max(500).optional() })
  .refine((r) => r.status === "VERIFIED" || !!r.note, {
    message: "Expliquez le refus a la nounou",
    path: ["note"],
  });

adminRouter.post(
  "/documents/:id/review",
  validate(reviewSchema),
  asyncHandler(async (req, res) => {
    const doc = await prisma.verificationDocument.findUnique({ where: { id: req.params.id } });
    if (!doc) throw notFound("Piece introuvable");

    const updated = await prisma.$transaction(async (tx) => {
      const d = await tx.verificationDocument.update({
        where: { id: doc.id },
        data: { status: req.body.status, note: req.body.note ?? null, reviewedBy: req.user!.id, reviewedAt: new Date() },
      });
      await audit(req.user!.id, `DOCUMENT_${req.body.status}`, "VerificationDocument", doc.id, { note: req.body.note ?? null }, tx);
      return d;
    });
    const { fileKey: _hidden, ...safe } = updated;
    res.json(safe);
  }),
);

const decisionSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("VERIFIED"),
    // 4e niveau du processus : l'entretien doit avoir eu lieu
    interviewDone: z.literal(true, { errorMap: () => ({ message: "Confirmez que l'entretien a eu lieu" }) }),
    note: z.string().trim().max(1000).optional(),
  }),
  z.object({ decision: z.literal("REJECTED"), note: z.string().trim().min(5).max(1000) }),
]);

/** Decision finale sur le dossier. Validation possible seulement si toutes les pieces exigees sont validees. */
adminRouter.post(
  "/nannies/:id/decision",
  validate(decisionSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof decisionSchema>;
    const nanny = await loadDossier(req.params.id);
    if (nanny.verificationStatus !== "UNDER_REVIEW") {
      throw conflict("NOT_UNDER_REVIEW", `Dossier au statut ${nanny.verificationStatus}, rien a decider`);
    }
    if (body.decision === "VERIFIED") {
      const list = checklist(nanny.isStudent, nanny.documents);
      if (!list.allVerified) {
        const pending = list.items.filter((i) => i.status !== "VERIFIED").map((i) => i.label);
        throw badRequest("DOCS_NOT_VERIFIED", `Pieces a valider d'abord : ${pending.join(", ")}`);
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const n = await tx.nannyProfile.update({
        where: { id: nanny.id },
        data: {
          verificationStatus: body.decision,
          verifiedAt: body.decision === "VERIFIED" ? new Date() : null,
        },
      });
      await audit(req.user!.id, `NANNY_${body.decision}`, "NannyProfile", nanny.id, { note: body.note ?? null }, tx);
      return n;
    });
    // TODO notification : SMS / WhatsApp a la nounou avec le resultat
    res.json(updated);
  }),
);

/* Comptes */

const userStatusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "BANNED"]),
  reason: z.string().trim().min(5).max(500),
});

/** Suspendre ou bannir un compte (parent ou nounou). Deconnecte immediatement tous ses appareils. */
adminRouter.post(
  "/users/:id/status",
  validate(userStatusSchema),
  asyncHandler(async (req, res) => {
    if (req.params.id === req.user!.id) throw badRequest("SELF_ACTION", "Impossible de modifier son propre compte");
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) throw notFound("Compte introuvable");
    if (user.role === "ADMIN") throw badRequest("ADMIN_TARGET", "Un compte admin ne se suspend pas ici");

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({ where: { id: user.id }, data: { status: req.body.status } });
      await audit(req.user!.id, `USER_${req.body.status}`, "User", user.id, { reason: req.body.reason }, tx);
      return u;
    });
    if (req.body.status !== "ACTIVE") await revokeAllRefreshTokens(user.id);
    res.json({ id: updated.id, phone: updated.phone, role: updated.role, status: updated.status });
  }),
);

/** Journal d'audit, filtrable par objet. */
adminRouter.get(
  "/audit",
  validate(
    z.object({ entity: z.string().optional(), entityId: z.string().optional(), take: z.coerce.number().int().min(1).max(200).default(50) }),
    "query",
  ),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { entity?: string; entityId?: string; take: number };
    res.json(
      await prisma.auditLog.findMany({
        where: { ...(q.entity ? { entity: q.entity } : {}), ...(q.entityId ? { entityId: q.entityId } : {}) },
        orderBy: { createdAt: "desc" },
        take: Number(q.take),
        include: { admin: { select: { phone: true } } },
      }),
    );
  }),
);
