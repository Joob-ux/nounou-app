import { z } from "zod";

const email = z.string().trim().toLowerCase().email("Adresse e-mail invalide");
const password = z
  .string()
  .min(8, "Le mot de passe doit faire au moins 8 caracteres")
  .max(72, "Le mot de passe doit faire au plus 72 caracteres");
const code = z.string().trim().length(6);

export const registerSchema = z.object({
  email,
  password,
  phone: z.string().min(9),
  role: z.enum(["PARENT", "NANNY"]).optional(),
});

export const verifyEmailSchema = z.object({ email, code });

export const loginSchema = z.object({ email, password: z.string().min(1) });

export const emailOnlySchema = z.object({ email });

export const resetPasswordSchema = z.object({ email, code, password });

export const refreshSchema = z.object({
  refreshToken: z.string().min(20),
});
