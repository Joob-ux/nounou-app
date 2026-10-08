import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16, "JWT_SECRET doit faire au moins 16 caracteres"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("30d"),
  OTP_TTL_MINUTES: z.coerce.number().default(5),
  OTP_MAX_ATTEMPTS: z.coerce.number().default(5),
  FRAIS_SERVICE_PCT: z.coerce.number().default(10),
  COMMISSION_PCT: z.coerce.number().default(10),
  PAYMENT_PROVIDER: z.string().default("mock"),
  PAYMENT_API_KEY: z.string().optional(),
  PAYMENT_WEBHOOK_SECRET: z.string().default("change-moi"),
  // Demo en ligne : affiche le code OTP, active la console et les routes de test.
  // A mettre a false des que de vrais utilisateurs arrivent.
  DEMO_MODE: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  UPLOAD_DIR: z.string().default("storage"),
  MAX_UPLOAD_MB: z.coerce.number().default(5),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("Configuration invalide :", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
/** Console de test, routes /api/dev et OTP visible : en local, ou en ligne si DEMO_MODE=true. */
export const testToolsEnabled = !isProd || env.DEMO_MODE;
