import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";
import { AppError } from "../lib/errors";

type Source = "body" | "query" | "params";

export function validate(schema: ZodSchema, source: Source = "body") {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
      return next(new AppError(400, "VALIDATION_ERROR", details));
    }
    Object.assign(req[source] as object, result.data);
    next();
  };
}
