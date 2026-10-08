import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "./prisma";

export type AccessPayload = { sub: string; role: Role };

export function signAccessToken(payload: AccessPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_ACCESS_TTL } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessPayload {
  return jwt.verify(token, env.JWT_SECRET) as AccessPayload;
}

const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

/** Le refresh token n'est jamais stocke en clair : seul son hash l'est. */
export async function issueRefreshToken(userId: string, device?: string) {
  const token = crypto.randomBytes(48).toString("base64url");
  const days = Number(env.JWT_REFRESH_TTL.replace(/\D/g, "")) || 30;
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hash(token),
      device,
      expiresAt: new Date(Date.now() + days * 86_400_000),
    },
  });
  return token;
}

export async function rotateRefreshToken(token: string) {
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hash(token) } });
  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) return null;
  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
  return stored.userId;
}

export async function revokeAllRefreshTokens(userId: string) {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
