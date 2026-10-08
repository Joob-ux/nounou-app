import { prisma } from "../../lib/prisma";
import { normalizePhone } from "../../lib/phone";
import { requestOtp, verifyOtp } from "../../lib/otp";
import { issueRefreshToken, rotateRefreshToken, signAccessToken } from "../../lib/tokens";
import { forbidden, unauthorized } from "../../lib/errors";
import type { Role } from "@prisma/client";

export async function startLogin(rawPhone: string) {
  const phone = normalizePhone(rawPhone);
  const result = await requestOtp(phone);
  return { phone, ...result };
}

/**
 * Un seul point d'entree pour l'inscription et la connexion :
 * si le numero est inconnu, le compte est cree avec le role demande.
 */
export async function completeLogin(rawPhone: string, code: string, role: Role = "PARENT") {
  const phone = normalizePhone(rawPhone);
  await verifyOtp(phone, code);

  let user = await prisma.user.findUnique({ where: { phone } });
  let isNew = false;

  if (!user) {
    user = await prisma.user.create({ data: { phone, role } });
    isNew = true;
  }
  if (user.status !== "ACTIVE") throw forbidden("Ce compte est suspendu");

  return {
    isNew,
    // Le client redirige vers l'ecran "completer mon profil" si false
    hasProfile: await hasProfile(user.id, user.role),
    user: { id: user.id, phone: user.phone, role: user.role },
    accessToken: signAccessToken({ sub: user.id, role: user.role }),
    refreshToken: await issueRefreshToken(user.id),
  };
}

export async function refresh(token: string) {
  const userId = await rotateRefreshToken(token);
  if (!userId) throw unauthorized("Jeton de rafraichissement invalide");

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return {
    accessToken: signAccessToken({ sub: user.id, role: user.role }),
    refreshToken: await issueRefreshToken(user.id),
  };
}

export async function hasProfile(userId: string, role: Role) {
  if (role === "PARENT") return !!(await prisma.parentProfile.findUnique({ where: { userId }, select: { id: true } }));
  if (role === "NANNY") return !!(await prisma.nannyProfile.findUnique({ where: { userId }, select: { id: true } }));
  return true;
}

export async function me(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, phone: true, email: true, role: true, status: true, lang: true, createdAt: true },
  });
  if (!user) throw unauthorized();
  return { ...user, hasProfile: await hasProfile(user.id, user.role) };
}
