import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { OtpPurpose } from "@prisma/client";
import { env, testToolsEnabled } from "../config/env";
import { prisma } from "./prisma";
import { badRequest, conflict } from "./errors";
import { logger } from "./logger";
import { mailConfigured, sendMail } from "./mail";

const generateCode = () => String(crypto.randomInt(100_000, 999_999));

const SUBJECTS: Record<OtpPurpose, string> = {
  VERIFY_EMAIL: "Votre code de confirmation",
  RESET_PASSWORD: "Votre code pour changer de mot de passe",
};

/** Envoi du code par e-mail. Sans SMTP configure, le code est seulement logue (dev / demo). */
async function sendCode(email: string, code: string, purpose: OtpPurpose) {
  if (!mailConfigured) {
    if (testToolsEnabled) {
      logger.info({ email, code, purpose }, "Code e-mail (dev uniquement)");
      return;
    }
    throw new Error("E-mail non configure (SMTP_HOST)");
  }
  const intro = purpose === "VERIFY_EMAIL"
    ? "Voici votre code pour confirmer votre adresse e-mail :"
    : "Voici votre code pour choisir un nouveau mot de passe :";
  const outro = `Il expire dans ${env.OTP_TTL_MINUTES} minutes. Si vous n'avez rien demande, ignorez cet e-mail.`;
  await sendMail(
    email,
    SUBJECTS[purpose],
    `${intro}\n\n${code}\n\n${outro}`,
    `<p>${intro}</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p><p style="color:#666">${outro}</p>`,
  );
}

export async function requestCode(email: string, purpose: OtpPurpose, userId?: string) {
  const recent = await prisma.otpCode.count({
    where: { email, purpose, createdAt: { gt: new Date(Date.now() - 60_000) } },
  });
  if (recent >= 2) throw conflict("OTP_TOO_SOON", "Patientez avant de redemander un code");

  const code = generateCode();
  await prisma.otpCode.create({
    data: {
      email,
      purpose,
      userId,
      codeHash: await bcrypt.hash(code, 10),
      expiresAt: new Date(Date.now() + env.OTP_TTL_MINUTES * 60_000),
    },
  });
  await sendCode(email, code, purpose);
  return {
    email,
    expiresInMinutes: env.OTP_TTL_MINUTES,
    // Mode demo uniquement : le code est renvoye pour pouvoir continuer sans e-mail
    ...(testToolsEnabled ? { devCode: code } : {}),
  };
}

export async function verifyCode(email: string, purpose: OtpPurpose, code: string) {
  const otp = await prisma.otpCode.findFirst({
    where: { email, purpose, usedAt: null, expiresAt: { gt: new Date() } },
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
