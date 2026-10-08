import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../middleware/error";
import { authenticate, requireRole } from "../../middleware/auth";
import { conflict, notFound } from "../../lib/errors";

export const parentsRouter = Router();
parentsRouter.use(authenticate, requireRole("PARENT"));

const thisYear = () => new Date().getFullYear();

const childSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  birthYear: z.number().int().refine((y) => y >= thisYear() - 14 && y <= thisYear(), {
    message: "Enfant de 0 a 14 ans",
  }),
  specialNeeds: z.string().trim().max(500).optional(),
});

const profileFields = {
  fullName: z.string().trim().min(2).max(80),
  neighborhood: z.string().trim().min(2).max(60),
  address: z.string().trim().max(200).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
};

const createSchema = z.object({
  ...profileFields,
  children: z.array(childSchema).max(8).default([]),
});

const updateSchema = z
  .object(profileFields)
  .partial()
  .refine((o) => Object.keys(o).length > 0, { message: "Rien a modifier" });

const withChildren = { children: { orderBy: { birthYear: "desc" as const } } };

async function getProfile(userId: string) {
  const profile = await prisma.parentProfile.findUnique({ where: { userId }, include: withChildren });
  if (!profile) throw notFound("Profil famille non cree");
  return profile;
}

/** Creation du profil famille (une seule fois, juste apres l'inscription OTP). */
parentsRouter.post(
  "/me",
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createSchema>;
    const exists = await prisma.parentProfile.findUnique({ where: { userId: req.user!.id } });
    if (exists) throw conflict("PROFILE_EXISTS", "Profil famille deja cree");

    const { children, ...profile } = body;
    const created = await prisma.parentProfile.create({
      data: { ...profile, userId: req.user!.id, children: { create: children } },
      include: withChildren,
    });
    res.status(201).json(created);
  }),
);

parentsRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    res.json(await getProfile(req.user!.id));
  }),
);

parentsRouter.patch(
  "/me",
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    await getProfile(req.user!.id);
    const updated = await prisma.parentProfile.update({
      where: { userId: req.user!.id },
      data: req.body,
      include: withChildren,
    });
    res.json(updated);
  }),
);

/* Enfants */

parentsRouter.post(
  "/me/children",
  validate(childSchema),
  asyncHandler(async (req, res) => {
    const profile = await getProfile(req.user!.id);
    if (profile.children.length >= 8) throw conflict("TOO_MANY_CHILDREN", "8 enfants maximum");
    const child = await prisma.child.create({ data: { ...req.body, parentId: profile.id } });
    res.status(201).json(child);
  }),
);

async function ownChild(userId: string, childId: string) {
  const child = await prisma.child.findFirst({ where: { id: childId, parent: { userId } } });
  if (!child) throw notFound("Enfant introuvable");
  return child;
}

parentsRouter.patch(
  "/me/children/:id",
  validate(childSchema.partial()),
  asyncHandler(async (req, res) => {
    await ownChild(req.user!.id, req.params.id);
    res.json(await prisma.child.update({ where: { id: req.params.id }, data: req.body }));
  }),
);

parentsRouter.delete(
  "/me/children/:id",
  asyncHandler(async (req, res) => {
    await ownChild(req.user!.id, req.params.id);
    await prisma.child.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);
