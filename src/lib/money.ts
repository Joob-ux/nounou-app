import { env } from "../config/env";

export type Breakdown = {
  amountXof: number;     // tarif horaire x heures
  feeXof: number;        // frais de service payes par le parent
  commissionXof: number; // commission retenue sur la nounou
  totalXof: number;      // ce que le parent paie
  netXof: number;        // ce que la nounou recoit
};

/**
 * Tous les montants sont des entiers en FCFA.
 * Le tarif est fige au moment de la reservation : on ne le relit jamais
 * depuis le profil de la nounou une fois la reservation creee.
 */
export function computeBreakdown(hourlyRateXof: number, hours: number): Breakdown {
  const amountXof = hourlyRateXof * hours;
  const feeXof = Math.round((amountXof * env.FRAIS_SERVICE_PCT) / 100);
  const commissionXof = Math.round((amountXof * env.COMMISSION_PCT) / 100);
  return {
    amountXof,
    feeXof,
    commissionXof,
    totalXof: amountXof + feeXof,
    netXof: amountXof - commissionXof,
  };
}

/** Politique d'annulation par le parent : part reversee a la nounou. */
export function cancellationSplit(startAt: Date, breakdown: Breakdown, now = new Date()) {
  const hoursBefore = (startAt.getTime() - now.getTime()) / 3_600_000;
  if (hoursBefore >= 24) return { refundXof: breakdown.totalXof, toNannyXof: 0 };
  if (hoursBefore >= 2) {
    const toNannyXof = Math.round(breakdown.netXof / 2);
    return { refundXof: breakdown.totalXof - toNannyXof, toNannyXof };
  }
  return { refundXof: breakdown.totalXof - breakdown.netXof, toNannyXof: breakdown.netXof };
}
