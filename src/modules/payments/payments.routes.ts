import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { env } from "../../config/env";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../middleware/error";
import { authenticate, requireRole } from "../../middleware/auth";
import { badRequest, notFound } from "../../lib/errors";
import { logger } from "../../lib/logger";

export const paymentsRouter = Router();

const initSchema = z.object({
  bookingId: z.string().min(1),
  method: z.enum(["WAVE", "ORANGE_MONEY", "FREE_MONEY", "CARD"]),
});

/**
 * Initie le paiement aupres de l'agregateur et cree la ligne Payment.
 * L'appel reel a l'API du fournisseur va dans initWithProvider().
 */
paymentsRouter.post(
  "/init",
  authenticate,
  requireRole("PARENT"),
  validate(initSchema),
  asyncHandler(async (req, res) => {
    const booking = await prisma.booking.findFirst({
      where: { id: req.body.bookingId, parent: { userId: req.user!.id } },
    });
    if (!booking) throw notFound("Reservation introuvable");
    if (booking.status !== "PENDING") throw badRequest("BOOKING_SETTLED", "Reservation deja traitee");

    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        method: req.body.method,
        provider: env.PAYMENT_PROVIDER,
        amountXof: booking.totalXof,
        status: "PENDING",
      },
    });

    // TODO: appeler l'agregateur et renvoyer son URL de paiement.
    res.status(201).json({
      paymentId: payment.id,
      amountXof: payment.amountXof,
      checkoutUrl: `https://exemple-agregateur.sn/pay/${payment.id}`,
    });
  }),
);

/**
 * Webhook de l'agregateur : signe et idempotent.
 * Un double appel ne doit jamais creer un second encaissement.
 */
paymentsRouter.post(
  "/webhook",
  asyncHandler(async (req, res) => {
    const signature = req.header("x-provider-signature") ?? "";
    const expected = crypto
      .createHmac("sha256", env.PAYMENT_WEBHOOK_SECRET)
      .update(req.body as Buffer)
      .digest("hex");

    if (signature.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      logger.warn("Webhook de paiement rejete : signature invalide");
      return res.status(401).json({ error: { code: "BAD_SIGNATURE", message: "Signature invalide" } });
    }

    const event = JSON.parse((req.body as Buffer).toString("utf8")) as {
      paymentId: string;
      providerRef: string;
      status: "success" | "failed";
    };

    const payment = await prisma.payment.findUnique({ where: { id: event.paymentId } });
    if (!payment) return res.status(200).json({ ignored: true });
    if (payment.providerRef === event.providerRef) return res.status(200).json({ duplicate: true });

    if (event.status === "success") {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "ESCROW", providerRef: event.providerRef },
      });
    } else {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "FAILED", providerRef: event.providerRef },
      });
    }

    res.status(200).json({ received: true });
  }),
);

/** Portefeuille de la nounou. */
paymentsRouter.get(
  "/wallet",
  authenticate,
  requireRole("NANNY"),
  asyncHandler(async (req, res) => {
    const nanny = await prisma.nannyProfile.findUniqueOrThrow({ where: { userId: req.user!.id } });
    const wallet = await prisma.wallet.upsert({
      where: { nannyId: nanny.id },
      create: { nannyId: nanny.id },
      update: {},
      include: { payouts: { orderBy: { createdAt: "desc" }, take: 20 } },
    });
    res.json(wallet);
  }),
);

paymentsRouter.post(
  "/payouts",
  authenticate,
  requireRole("NANNY"),
  validate(z.object({
    amountXof: z.number().int().min(1000),
    method: z.enum(["WAVE", "ORANGE_MONEY", "FREE_MONEY"]),
    phone: z.string().min(9),
  })),
  asyncHandler(async (req, res) => {
    const nanny = await prisma.nannyProfile.findUniqueOrThrow({ where: { userId: req.user!.id } });
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { nannyId: nanny.id } });
    if (wallet.balanceXof < req.body.amountXof) {
      throw badRequest("INSUFFICIENT_BALANCE", "Solde disponible insuffisant");
    }

    const [payout] = await prisma.$transaction([
      prisma.payout.create({
        data: {
          walletId: wallet.id,
          amountXof: req.body.amountXof,
          method: req.body.method,
          phone: req.body.phone,
        },
      }),
      prisma.wallet.update({
        where: { id: wallet.id },
        data: { balanceXof: { decrement: req.body.amountXof } },
      }),
    ]);

    res.status(201).json(payout);
  }),
);
