import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env";
import { badRequest } from "./errors";

/**
 * Stockage des pieces justificatives.
 * En dev : disque local, dans un dossier JAMAIS servi publiquement (UPLOAD_DIR).
 * En production : remplacer saveFile/readFile par S3 chiffre (meme signature).
 */

const ROOT = path.resolve(env.UPLOAD_DIR);

export const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

const MIME_BY_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(ALLOWED_MIME).map(([mime, ext]) => [ext, mime]),
);

/** Verifie la signature du fichier (magic bytes) : on ne fait pas confiance au type annonce. */
function sniffMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (buf.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  return null;
}

function resolveKey(key: string) {
  const full = path.resolve(ROOT, key);
  if (!full.startsWith(ROOT + path.sep)) throw badRequest("BAD_KEY", "Cle de fichier invalide");
  return full;
}

export async function saveFile(folder: string, buf: Buffer) {
  const mime = sniffMime(buf);
  if (!mime) throw badRequest("FILE_TYPE", "Formats acceptes : JPG, PNG, WEBP ou PDF");
  const key = `${folder}/${crypto.randomUUID()}.${ALLOWED_MIME[mime]}`;
  const full = resolveKey(key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buf, { mode: 0o600 });
  return { key, mime };
}

export async function readFile(key: string) {
  const full = resolveKey(key);
  const buf = await fs.readFile(full);
  const ext = path.extname(key).slice(1);
  return { buf, mime: MIME_BY_EXT[ext] ?? "application/octet-stream" };
}

export async function deleteFile(key: string) {
  await fs.rm(resolveKey(key), { force: true });
}
