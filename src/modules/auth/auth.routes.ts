import { Router } from "express";
import rateLimit from "express-rate-limit";
import { validate } from "../../middleware/validate";
import { asyncHandler } from "../../middleware/error";
import { authenticate } from "../../middleware/auth";
import { revokeAllRefreshTokens } from "../../lib/tokens";
import { testToolsEnabled } from "../../config/env";
import { refreshSchema, requestOtpSchema, verifyOtpSchema } from "./auth.schema";
import * as service from "./auth.service";

const otpLimiter = rateLimit({
  windowMs: 15 * 60_000,
  // Plus souple en demo : on alterne parent / nounou / admin depuis le meme reseau
  limit: testToolsEnabled ? 60 : 10,
  standardHeaders: true,
  message: { error: { code: "TOO_MANY_REQUESTS", message: "Trop de tentatives, reessayez dans quelques minutes" } },
});

export const authRouter = Router();

authRouter.post(
  "/otp/request",
  otpLimiter,
  validate(requestOtpSchema),
  asyncHandler(async (req, res) => {
    res.json(await service.startLogin(req.body.phone));
  }),
);

authRouter.post(
  "/otp/verify",
  otpLimiter,
  validate(verifyOtpSchema),
  asyncHandler(async (req, res) => {
    res.json(await service.completeLogin(req.body.phone, req.body.code, req.body.role));
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
