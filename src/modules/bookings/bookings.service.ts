import type { BookingType } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { cancellationSplit, computeBreakdown } from "../../lib/money";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors";

const RESPONSE_WINDOW_MS = 24 * 3_600_000;

export async function createBooking(input: {
  userId: string;
  nannyId: string;
  type: BookingType;
  startAt: Date;
  hours: number;
  address: string;
  instructions?: string;
}) {
  const parent = await prisma.parentProfile.findUnique({ where: { userId: input.userId } });
  if (!parent) throw badRequest("PROFILE_MISSING", "Completez votre profil famille avant de reserver");

  const nanny = await prisma.nannyProfile.findUnique({
    where: { id: input.nannyId },
    include: { user: { select: { status: true } } },
  });
  if (!nanny || nanny.verificationStatus !== "VERIFIED" || nanny.user.status !== "ACTIVE") {
    throw notFound("Nounou indisponible");
  }
  if (!nanny.bookingTypes.includes(input.type)) {
    throw badRequest("TYPE_UNSUPPORTED", "Cette nounou ne propose pas ce type de garde");
  }
  if (input.startAt.getTime() < Date.now()) throw badRequest("DATE_PAST", "La date est deja passee");

  const b = computeBreakdown(nanny.hourlyRateXof, input.hours);

  return prisma.booking.create({
    data: {
      parentId: parent.id,
      nannyId: nanny.id,
      type: input.type,
      address: input.address,
      instructions: input.instructions,
      startAt: input.startAt,
      hours: input.hours,
      hourlyRateXof: nanny.hourlyRateXof,
      amountXof: b.amountXof,
      feeXof: b.feeXof,
      commissionXof: b.commissionXof,
      totalXof: b.totalXof,
      respondBy: new Date(Date.now() + RESPONSE_WINDOW_MS),
      missions: {
        create: {
          scheduledStart: input.startAt,
          scheduledEnd: new Date(input.startAt.getTime() + input.hours * 3_600_000),
        },
      },
      conversation: { create: {} },
    },
    include: { missions: true },
  });
}

/** La nounou accepte : la mission passe en confirmee. Le paiement doit deja etre en sequestre. */
export async function respondToBooking(userId: string, bookingId: string, accept: boolean) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { nanny: true, payments: true },
  });
  if (!booking) throw notFound("Reservation introuvable");
  if (booking.nanny.userId !== userId) throw forbidden();
  if (booking.status !== "PENDING") throw conflict("BOOKING_SETTLED", "Cette demande a deja ete traitee");
  if (booking.respondBy < new Date()) {
    await prisma.booking.update({ where: { id: bookingId }, data: { status: "EXPIRED" } });
    throw conflict("BOOKING_EXPIRED", "Le delai de reponse est depasse");
  }

  return prisma.booking.update({
    where: { id: bookingId },
    data: { status: accept ? "CONFIRMED" : "REFUSED" },
  });
}

export async function checkIn(userId: string, missionId: string, lat?: number, lng?: number) {
  const mission = await prisma.mission.findUnique({
    where: { id: missionId },
    include: { booking: { include: { nanny: true } } },
  });
  if (!mission) throw notFound("Mission introuvable");
  if (mission.booking.nanny.userId !== userId) throw forbidden();
  if (mission.booking.status !== "CONFIRMED") throw conflict("BOOKING_NOT_CONFIRMED", "Mission non confirmee");
  if (mission.checkinAt) throw conflict("ALREADY_CHECKED_IN", "Check-in deja effectue");

  return prisma.$transaction(async (tx) => {
    await tx.booking.update({ where: { id: mission.bookingId }, data: { status: "IN_PROGRESS" } });
    return tx.mission.update({
      where: { id: missionId },
      data: { checkinAt: new Date(), checkinLat: lat, checkinLng: lng },
    });
  });
}

/**
 * Check-out : la somme nette passe en attente dans le portefeuille de la nounou,
 * et la liberation est programmee 24 h plus tard (tache planifiee).
 */
export async function checkOut(userId: string, missionId: string, lat?: number, lng?: number) {
  const mission = await prisma.mission.findUnique({
    where: { id: missionId },
    include: { booking: { include: { nanny: { include: { wallet: true } } } } },
  });
  if (!mission) throw notFound("Mission introuvable");
  if (mission.booking.nanny.userId !== userId) throw forbidden();
  if (!mission.checkinAt) throw conflict("NO_CHECKIN", "Faites d'abord le check-in");
  if (mission.checkoutAt) throw conflict("ALREADY_CHECKED_OUT", "Check-out deja effectue");

  const now = new Date();
  const releaseAt = new Date(now.getTime() + 24 * 3_600_000);
  const netXof = mission.booking.amountXof - mission.booking.commissionXof;

  return prisma.$transaction(async (tx) => {
    await tx.booking.update({ where: { id: mission.bookingId }, data: { status: "COMPLETED" } });
    await tx.wallet.upsert({
      where: { nannyId: mission.booking.nannyId },
      create: { nannyId: mission.booking.nannyId, pendingXof: netXof },
      update: { pendingXof: { increment: netXof } },
    });
    return tx.mission.update({
      where: { id: missionId },
      data: { checkoutAt: now, checkoutLat: lat, checkoutLng: lng, releaseAt },
    });
  });
}

/**
 * Tache planifiee (a appeler toutes les 15 minutes) :
 * libere les fonds des missions terminees depuis plus de 24 h et sans litige.
 */
export async function releaseDueFunds() {
  const due = await prisma.mission.findMany({
    where: {
      releaseAt: { lte: new Date() },
      booking: { status: "COMPLETED" },
      disputes: { none: { status: { in: ["OPEN", "UNDER_REVIEW"] } } },
    },
    include: { booking: true },
  });

  for (const mission of due) {
    const netXof = mission.booking.amountXof - mission.booking.commissionXof;
    await prisma.$transaction([
      prisma.wallet.update({
        where: { nannyId: mission.booking.nannyId },
        data: { pendingXof: { decrement: netXof }, balanceXof: { increment: netXof } },
      }),
      prisma.booking.update({ where: { id: mission.bookingId }, data: { status: "PAID_OUT" } }),
      prisma.payment.updateMany({
        where: { bookingId: mission.bookingId, status: "ESCROW" },
        data: { status: "RELEASED" },
      }),
    ]);
  }
  return due.length;
}

/**
 * Annulation par le parent, selon la politique de money.ts :
 * plus de 24 h avant = rembourse en entier ; 2 a 24 h = moitie du net a la nounou ; moins de 2 h = net entier a la nounou.
 * Le remboursement reel passera par l'agregateur ; ici on trace les montants.
 */
export async function cancelByParent(userId: string, bookingId: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { parent: true, payments: true },
  });
  if (!booking) throw notFound("Reservation introuvable");
  if (booking.parent.userId !== userId) throw forbidden();
  if (booking.status !== "PENDING" && booking.status !== "CONFIRMED") {
    throw conflict("NOT_CANCELLABLE", "Cette reservation ne peut plus etre annulee");
  }

  const paid = booking.payments.find((p) => p.status === "ESCROW");
  const breakdown = {
    amountXof: booking.amountXof,
    feeXof: booking.feeXof,
    commissionXof: booking.commissionXof,
    totalXof: booking.totalXof,
    netXof: booking.amountXof - booking.commissionXof,
  };
  // Une demande que la nounou n'a pas encore acceptee est toujours remboursee en entier
  const split =
    booking.status === "PENDING"
      ? { refundXof: booking.totalXof, toNannyXof: 0 }
      : cancellationSplit(booking.startAt, breakdown);

  await prisma.$transaction(async (tx) => {
    await tx.booking.update({ where: { id: booking.id }, data: { status: "CANCELLED" } });
    if (paid) {
      await tx.payment.update({ where: { id: paid.id }, data: { status: "REFUNDED" } });
      if (split.toNannyXof > 0) {
        await tx.wallet.upsert({
          where: { nannyId: booking.nannyId },
          create: { nannyId: booking.nannyId, balanceXof: split.toNannyXof },
          update: { balanceXof: { increment: split.toNannyXof } },
        });
      }
    }
  });

  return { status: "CANCELLED", paid: !!paid, refundXof: paid ? split.refundXof : 0, toNannyXof: paid ? split.toNannyXof : 0 };
}

/** Apercu de l'annulation (affiche au parent avant de confirmer). */
export async function cancellationPreview(userId: string, bookingId: string) {
  const booking = await prisma.booking.findFirst({ where: { id: bookingId, parent: { userId } } });
  if (!booking) throw notFound("Reservation introuvable");
  if (booking.status === "PENDING") return { refundXof: booking.totalXof, toNannyXof: 0 };
  return cancellationSplit(booking.startAt, {
    amountXof: booking.amountXof,
    feeXof: booking.feeXof,
    commissionXof: booking.commissionXof,
    totalXof: booking.totalXof,
    netXof: booking.amountXof - booking.commissionXof,
  });
}

/** Avis du parent apres la mission. Met a jour la note moyenne de la nounou. */
export async function reviewNanny(
  userId: string,
  bookingId: string,
  input: { punctuality: number; care: number; communication: number; instructions: number; comment?: string },
) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { parent: true, missions: true },
  });
  if (!booking) throw notFound("Reservation introuvable");
  if (booking.parent.userId !== userId) throw forbidden();
  const mission = booking.missions.find((m) => m.checkoutAt);
  if (!mission) throw conflict("NOT_FINISHED", "La garde n'est pas encore terminee");

  const exists = await prisma.review.findUnique({ where: { missionId_authorId: { missionId: mission.id, authorId: userId } } });
  if (exists) throw conflict("ALREADY_REVIEWED", "Vous avez deja donne votre avis");

  const score = (input.punctuality + input.care + input.communication + input.instructions) / 4;
  return prisma.$transaction(async (tx) => {
    const review = await tx.review.create({
      data: { ...input, missionId: mission.id, authorId: userId, targetId: booking.nannyId, publishedAt: new Date() },
    });
    const nanny = await tx.nannyProfile.findUniqueOrThrow({ where: { id: booking.nannyId } });
    const count = nanny.ratingCount + 1;
    await tx.nannyProfile.update({
      where: { id: nanny.id },
      data: { ratingCount: count, ratingAvg: Math.round(((nanny.ratingAvg * nanny.ratingCount + score) / count) * 10) / 10 },
    });
    return review;
  });
}
