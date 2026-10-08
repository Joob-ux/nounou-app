import bcrypt from "bcryptjs";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { normalizePhone } from "../../lib/phone";
import { requestCode, verifyCode } from "../../lib/otp";
import { issueRefreshToken, revokeAllRefreshTokens, rotateRefreshToken, signAccessToken } from "../../lib/tokens";
import { conflict, forbidden, unauthorized } from "../../lib/errors";
import type { Role, User } from "@prisma/client";

const hashPassword = (password: string) => bcrypt.hash(password, 10);

async function session(user: User, isNew = false) {
  if (user.status !== "ACTIVE") throw forbidden("Ce compte est suspendu");
  return {
    isNew,
    // Le client redirige vers l'ecran "completer mon profil" si false
    hasProfile: await hasProfile(user.id, user.role),
    user: { id: user.id, email: user.email, phone: user.phone, role: user.role },
    accessToken: signAccessToken({ sub: user.id, role: user.role }),
    refreshToken: await issueRefreshToken(user.id),
  };
}

/**
 * Inscription : e-mail + mot de passe + numero. Le compte reste inactif
 * tant que l'e-mail n'est pas confirme par le code recu.
 * Une inscription non confirmee peut etre recommencee (nouveau mot de passe, nouveau code).
 */
export async function register(email: string, password: string, rawPhone: string, role: Role = "PARENT") {
  const phone = normalizePhone(rawPhone);

  const byEmail = await prisma.user.findUnique({ where: { email } });
  if (byEmail?.emailVerifiedAt) throw conflict("EMAIL_TAKEN", "Un compte existe deja avec cet e-mail");

  const byPhone = await prisma.user.findUnique({ where: { phone } });
  if (byPhone && byPhone.id !== byEmail?.id) {
    if (byPhone.emailVerifiedAt || !byPhone.email) throw conflict("PHONE_TAKEN", "Ce numero est deja utilise par un autre compte");
    // Inscription abandonnee avec ce numero et un autre e-mail : on la remplace
    await prisma.user.delete({ where: { id: byPhone.id } });
  }

  const passwordHash = await hashPassword(password);
  const user = byEmail
    ? await prisma.user.update({ where: { id: byEmail.id }, data: { phone, passwordHash, role } })
    : await prisma.user.create({ data: { email, phone, passwordHash, role } });

  return requestCode(email, "VERIFY_EMAIL", user.id);
}

export async function verifyEmail(email: string, code: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw unauthorized("Compte introuvable, inscrivez-vous");
  await verifyCode(email, "VERIFY_EMAIL", code);
  const verified = user.emailVerifiedAt
    ? user
    : await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  return session(verified, !user.emailVerifiedAt);
}

/** Renvoie un code de confirmation (inscription non terminee). */
export async function resendVerification(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.emailVerifiedAt) throw conflict("NOTHING_TO_VERIFY", "Aucune inscription en attente pour cet e-mail");
  return requestCode(email, "VERIFY_EMAIL", user.id);
}

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  const ok = user?.passwordHash && (await bcrypt.compare(password, user.passwordHash));
  if (!user || !ok) throw unauthorized("E-mail ou mot de passe incorrect");
  if (user.status !== "ACTIVE") throw forbidden("Ce compte est suspendu");

  // Inscription jamais confirmee : on renvoie un code au lieu d'ouvrir la session
  if (!user.emailVerifiedAt) return { needsVerification: true, ...(await requestCode(email, "VERIFY_EMAIL", user.id)) };
  return session(user);
}

/**
 * Mot de passe oublie : meme reponse que l'e-mail existe ou non,
 * pour ne pas reveler qui est inscrit.
 */
export async function forgotPassword(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return { email, expiresInMinutes: env.OTP_TTL_MINUTES };
  return requestCode(email, "RESET_PASSWORD", user.id);
}

export async function resetPassword(email: string, code: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw unauthorized("Code incorrect");
  await verifyCode(email, "RESET_PASSWORD", code);
  const updated = await prisma.user.update({
    where: { id: user.id },
    // Le code recu prouve aussi que l'e-mail est valide
    data: { passwordHash: await hashPassword(password), emailVerifiedAt: user.emailVerifiedAt ?? new Date() },
  });
  await revokeAllRefreshTokens(user.id);
  return session(updated);
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
