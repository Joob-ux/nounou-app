import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../middleware/error";
import { authenticate, requireRole } from "../../middleware/auth";
import * as service from "./bookings.service";

export const bookingsRouter = Router();
bookingsRouter.use(authenticate);

const createSchema = z.object({
  nannyId: z.string().min(1),
  type: z.enum(["PONCTUELLE", "SORTIE_ECOLE", "REGULIERE", "NUIT"]),
  startAt: z.coerce.date(),
  hours: z.number().int().min(1).max(12),
  address: z.string().min(5),
  instructions: z.string().max(500).optional(),
});

bookingsRouter.post(
  "/",
  requireRole("PARENT"),
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const booking = await service.createBooking({ userId: req.user!.id, ...req.body });
    res.status(201).json(booking);
  }),
);

/** Liste unifiee : le parent voit ses reservations, la nounou ses demandes et missions. */
bookingsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const where =
      req.user!.role === "PARENT"
        ? { parent: { userId: req.user!.id } }
        : { nanny: { userId: req.user!.id } };

    const bookings = await prisma.booking.findMany({
      where,
      orderBy: { startAt: "desc" },
      include: {
        missions: { include: { reviews: { select: { authorId: true } } } },
        payments: { select: { status: true, method: true } },
        nanny: { select: { id: true, fullName: true, photoUrl: true, neighborhood: true, user: { select: { phone: true } } } },
        parent: { select: { id: true, fullName: true, neighborhood: true, user: { select: { phone: true } } } },
      },
    });
    const me = req.user!.id;
    res.json(
      bookings.map(({ missions, payments, parent, nanny, ...b }) => ({
        ...b,
        nanny: {
          id: nanny.id,
          fullName: nanny.fullName,
          photoUrl: nanny.photoUrl,
          neighborhood: nanny.neighborhood,
          phone: ["CONFIRMED", "IN_PROGRESS"].includes(b.status) ? nanny.user.phone : null,
        },
        missions: missions.map(({ reviews, ...m }) => m),
        paid: payments.some((p) => p.status === "ESCROW" || p.status === "RELEASED"),
        paymentStatus: payments[0]?.status ?? null,
        reviewed: missions.some((m) => m.reviews.some((r) => r.authorId === me)),
        // Le numero du parent n'est donne a la nounou qu'une fois la garde confirmee
        parent: {
          id: parent.id,
          fullName: parent.fullName,
          neighborhood: parent.neighborhood,
          phone: ["CONFIRMED", "IN_PROGRESS"].includes(b.status) ? parent.user.phone : null,
        },
      })),
    );
  }),
);

bookingsRouter.post(
  "/:id/respond",
  requireRole("NANNY"),
  validate(z.object({ accept: z.boolean() })),
  asyncHandler(async (req, res) => {
    res.json(await service.respondToBooking(req.user!.id, req.params.id, req.body.accept));
  }),
);

const geoSchema = z.object({
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

bookingsRouter.post(
  "/missions/:id/checkin",
  requireRole("NANNY"),
  validate(geoSchema),
  asyncHandler(async (req, res) => {
    res.json(await service.checkIn(req.user!.id, req.params.id, req.body.latitude, req.body.longitude));
  }),
);

bookingsRouter.post(
  "/missions/:id/checkout",
  requireRole("NANNY"),
  validate(geoSchema),
  asyncHandler(async (req, res) => {
    res.json(await service.checkOut(req.user!.id, req.params.id, req.body.latitude, req.body.longitude));
  }),
);

bookingsRouter.get(
  "/:id/cancel-preview",
  requireRole("PARENT"),
  asyncHandler(async (req, res) => {
    res.json(await service.cancellationPreview(req.user!.id, req.params.id));
  }),
);

bookingsRouter.post(
  "/:id/cancel",
  requireRole("PARENT"),
  asyncHandler(async (req, res) => {
    res.json(await service.cancelByParent(req.user!.id, req.params.id));
  }),
);

const note = z.number().int().min(1).max(5);
bookingsRouter.post(
  "/:id/review",
  requireRole("PARENT"),
  validate(z.object({ punctuality: note, care: note, communication: note, instructions: note, comment: z.string().trim().max(500).optional() })),
  asyncHandler(async (req, res) => {
    res.status(201).json(await service.reviewNanny(req.user!.id, req.params.id, req.body));
  }),
);
