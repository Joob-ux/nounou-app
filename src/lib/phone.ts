import { badRequest } from "./errors";

/**
 * Normalise un numero senegalais vers le format E.164 : +221XXXXXXXXX.
 * Accepte "77 123 45 67", "221771234567", "+221 77 123 45 67".
 */
export function normalizePhone(input: string): string {
  const digits = input.replace(/[^\d]/g, "");
  if (digits.length === 9 && /^(7[0-8])/.test(digits)) return `+221${digits}`;
  if (digits.length === 12 && digits.startsWith("221")) return `+${digits}`;
  throw badRequest("PHONE_INVALID", "Numero de telephone senegalais invalide");
}
