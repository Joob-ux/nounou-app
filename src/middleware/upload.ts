import multer from "multer";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { ALLOWED_MIME } from "../lib/storage";
import { AppError, badRequest } from "../lib/errors";

const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME[file.mimetype]) return cb(null, true);
    cb(badRequest("FILE_TYPE", "Formats acceptes : JPG, PNG, WEBP ou PDF"));
  },
}).single("file");

/** Lit un seul fichier dans le champ "file" (multipart/form-data) et traduit les erreurs. */
export function singleFile(req: Request, res: Response, next: NextFunction) {
  parser(req, res, (err: unknown) => {
    if (!err) {
      if (!req.file) return next(badRequest("FILE_MISSING", "Aucun fichier recu (champ 'file')"));
      return next();
    }
    if (err instanceof AppError) return next(err);
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return next(badRequest("FILE_TOO_LARGE", `Fichier trop lourd (max ${env.MAX_UPLOAD_MB} Mo)`));
    }
    next(badRequest("UPLOAD_ERROR", "Envoi du fichier impossible"));
  });
}
