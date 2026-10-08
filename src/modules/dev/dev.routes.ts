import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { asyncHandler } from "../../middleware/error";
import { authenticate, requireRole } from "../../middleware/auth";
import { notFound } from "../../lib/errors";
import { releaseDueFunds } from "../bookings/bookings.service";

/**
 * Routes de DEVELOPPEMENT uniquement (jamais montees en production).
 * Elles remplacent l'agregateur de paiement et l'attente de 24 h pour tester le parcours.
 */
export const devRouter = Router();

/** Simule le webhook "paiement reussi" : le paiement passe en sequestre. */
devRouter.post(
  "/payments/:id/succeed",
  authenticate,
  requireRole("PARENT"),
  asyncHandler(async (req, res) => {
    const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
    if (!payment) throw notFound("Paiement introuvable");
    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "ESCROW", providerRef: `DEV-${payment.id}` },
    });
    res.json(updated);
  }),
);

/** Saute l'attente de 24 h : libere tout de suite les missions terminees sans litige. */
devRouter.post(
  "/release-now",
  asyncHandler(async (_req, res) => {
    await prisma.mission.updateMany({
      where: { checkoutAt: { not: null }, releaseAt: { gt: new Date() } },
      data: { releaseAt: new Date() },
    });
    res.json({ released: await releaseDueFunds() });
  }),
);
