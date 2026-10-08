import { Router } from "express";
import rateLimit from "express-rate-limit";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../middleware/error";
import { authenticate } from "../../middleware/auth";
import { revokeAllRefreshTokens } from "../../lib/tokens";
import { testToolsEnabled } from "../../config/env";
import {
  emailOnlySchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from "./auth.schema";
import * as service from "./auth.service";

// Inscription, connexion et codes : limite les essais de mots de passe et l'envoi d'e-mails
const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  // Plus souple en demo : on alterne parent / nounou / admin depuis le meme reseau
  limit: testToolsEnabled ? 60 : 10,
  standardHeaders: true,
  message: { error: { code: "TOO_MANY_REQUESTS", message: "Trop de tentatives, reessayez dans quelques minutes" } },
});

export const authRouter = Router();

authRouter.post(
  "/register",
  authLimiter,
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const { email, password, phone, role } = req.body;
    res.json(await service.register(email, password, phone, role));
  }),
);

authRouter.post(
  "/verify-email",
  authLimiter,
  validate(verifyEmailSchema),
  asyncHandler(async (req, res) => {
    res.json(await service.verifyEmail(req.body.email, req.body.code));
  }),
);

authRouter.post(
  "/verify-email/resend",
  authLimiter,
  validate(emailOnlySchema),
  asyncHandler(async (req, res) => {
    res.json(await service.resendVerification(req.body.email));
  }),
);

authRouter.post(
  "/login",
  authLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    res.json(await service.login(req.body.email, req.body.password));
  }),
);

authRouter.post(
  "/password/forgot",
  authLimiter,
  validate(emailOnlySchema),
  asyncHandler(async (req, res) => {
    res.json(await service.forgotPassword(req.body.email));
  }),
);

authRouter.post(
  "/password/reset",
  authLimiter,
  validate(resetPasswordSchema),
  asyncHandler(async (req, res) => {
    const { email, code, password } = req.body;
    res.json(await service.resetPassword(email, code, password));
  }),
);

authRouter.post(
  "/refresh",
  validate(refreshSchema),
  asyncHandler(async (req, res) => {
    res.json(await service.refresh(req.body.refreshToken));
  }),
);

/** Qui suis-je : role, statut et profil complete ou non (utile au demarrage de l'appli). */
authRouter.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    res.json(await service.me(req.user!.id));
  }),
);

authRouter.post(
  "/logout",
  authenticate,
  asyncHandler(async (req, res) => {
    await revokeAllRefreshTokens(req.user!.id);
    res.status(204).end();
  }),
);
