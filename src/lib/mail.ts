import nodemailer from "nodemailer";
import { env } from "../config/env";

/** Transport SMTP (Brevo, Gmail...). Null tant que SMTP_HOST n'est pas renseigne. */
const transport = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : null;

export const mailConfigured = transport !== null;

export async function sendMail(to: string, subject: string, text: string, html: string) {
  if (!transport) throw new Error("E-mail non configure (SMTP_HOST)");
  await transport.sendMail({ from: env.MAIL_FROM || env.SMTP_USER, to, subject, text, html });
}
