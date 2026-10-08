import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { env, testToolsEnabled } from "../config/env";
import { prisma } from "./prisma";
import { badRequest, conflict } from "./errors";
import { logger } from "./logger";

const generateCode = () => String(crypto.randomInt(100_000, 999_999));

/**
 * Envoi du code par WhatsApp (API Cloud de Meta, modele de categorie
 * « Authentification » avec bouton « Copier le code »).
 * Sans configuration WhatsApp, le code est seulement logue (dev / demo).
 */
async function sendCode(phone: string, code: string) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
    if (testToolsEnabled) {
      logger.info({ phone, code }, "OTP (dev uniquement)");
      return;
    }
    throw new Error("WhatsApp non configure (WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID)");
  }

  const res = await fetch(`https://graph.facebook.com/v21.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone.replace(/^\+/, ""),
      type: "template",
      template: {
        name: env.WHATSAPP_TEMPLATE,
        language: { code: env.WHATSAPP_TEMPLATE_LANG },
        components: [
          { type: "body", parameters: [{ type: "text", text: code }] },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
        ],
      },
    }),
  });
  if (!res.ok) {
    logger.error({ phone, status: res.status, body: await res.text() }, "Echec de l'envoi WhatsApp");
    throw new Error("Envoi WhatsApp impossible");
  }
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
  await sendCode(phone, code);
  return {
    expiresInMinutes: env.OTP_TTL_MINUTES,
    // Mode demo uniquement : le code est renvoye pour pouvoir se connecter sans WhatsApp
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
