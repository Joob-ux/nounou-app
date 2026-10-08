import { z } from "zod";

export const requestOtpSchema = z.object({
  phone: z.string().min(9),
});

export const verifyOtpSchema = z.object({
  phone: z.string().min(9),
  code: z.string().length(6),
  role: z.enum(["PARENT", "NANNY"]).optional(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(20),
});

export type RequestOtpInput = z.infer<typeof requestOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
