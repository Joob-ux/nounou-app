import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/errors";
import { logger } from "../lib/logger";
import { isProd } from "../config/env";

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Route inconnue" } });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  logger.error({ err }, "Erreur non geree");
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: isProd ? "Erreur interne" : String(err),
    },
  });
}

/** Evite d'entourer chaque handler async d'un try/catch. */
export const asyncHandler =
  <T extends Request>(fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as T, res, next)).catch(next);
  };
