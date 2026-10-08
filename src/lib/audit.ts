import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

type Db = Prisma.TransactionClient | typeof prisma;

/** Trace chaque action du back-office (qui, quoi, sur quoi). Obligatoire pour l'acces aux pieces. */
export function audit(
  adminId: string,
  action: string,
  entity: string,
  entityId: string,
  payload?: Prisma.InputJsonValue,
  db: Db = prisma,
) {
  return db.auditLog.create({ data: { adminId, action, entity, entityId, payload } });
}
