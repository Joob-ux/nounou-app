export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, msg: string) => new AppError(400, code, msg);
export const unauthorized = (msg = "Authentification requise") => new AppError(401, "UNAUTHORIZED", msg);
export const forbidden = (msg = "Acces refuse") => new AppError(403, "FORBIDDEN", msg);
export const notFound = (msg = "Ressource introuvable") => new AppError(404, "NOT_FOUND", msg);
export const conflict = (code: string, msg: string) => new AppError(409, code, msg);
