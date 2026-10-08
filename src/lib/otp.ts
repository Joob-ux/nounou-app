import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { env, testToolsEnabled } from "../config/env";
import { prisma } from "./prisma";
import { badRequest, conflict } from "./errors";
import { logger } from "./logger";

const generateCode = () => String(crypto.randomInt(100_000, 999_999));

/**
 * Envoi du SMS. A brancher sur le fournisseur choisi (WhatsApp Business
 * en priorite, SMS en secours). En dev, le code est seulement logue.
 */
async function sendSms(phone: string, code: string) {
  if (testToolsEnabled) {
    logger.info({ phone, code }, "OTP (dev uniquement)");
    return;
  }
  throw new Error("Fournisseur SMS non configure");
}

export async function requestOtp(phone: string) {
  const recent = await prisma.otpCode.count({
    where: { phone, createdAt: { gt: new Date(Date.now() - 60_000) } },
  });
  if (recent >= 2) throw conflict("OTP_TOO_SOON", "Patientez avant de redemander un code");

  const code = generateCode();
  await prisma.otpCode.create({
    data: {
      phone,
      codeHash: await bcrypt.hash(code, 10),
      expiresAt: new Date(Date.now() + env.OTP_TTL_MINUTES * 60_000),
    },
  });
  await sendSms(phone, code);
  return {
    expiresInMinutes: env.OTP_TTL_MINUTES,
    // Mode demo uniquement : pas de SMS, le code est renvoye pour pouvoir se connecter
    ...(testToolsEnabled ? { devCode: code } : {}),
  };
}

export async function verifyOtp(phone: string, code: string) {
  const otp = await prisma.otpCode.findFirst({
    where: { phone, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!otp) throw badRequest("OTP_EXPIRED", "Code expire ou introuvable, demandez-en un nouveau");
  if (otp.attempts >= env.OTP_MAX_ATTEMPTS) {
    throw badRequest("OTP_LOCKED", "Trop de tentatives, demandez un nouveau code");
  }

  const ok = await bcrypt.compare(code, otp.codeHash);
  if (!ok) {
    await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: otp.attempts + 1 } });
    throw badRequest("OTP_INVALID", "Code incorrect");
  }

  await prisma.otpCode.update({ where: { id: otp.id }, data: { usedAt: new Date() } });
  return true;
}
