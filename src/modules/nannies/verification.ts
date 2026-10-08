import type { DocumentType, VerificationDocument, VerificationStatus } from "@prisma/client";

/**
 * Processus de verification en 4 niveaux (cahier des charges) :
 *  1. Identite            -> CNI
 *  2. Antecedents         -> casier judiciaire + justificatif de domicile
 *  3. References          -> au moins une attestation / lettre de reference
 *  4. Entretien           -> realise par l'equipe, confirme au moment de la decision admin
 * Les etudiantes fournissent en plus un certificat de scolarite.
 */
export const DOC_LABELS: Record<DocumentType, string> = {
  CNI: "Carte d'identite",
  CASIER_JUDICIAIRE: "Casier judiciaire",
  JUSTIFICATIF_DOMICILE: "Justificatif de domicile",
  CERTIFICAT_SCOLARITE: "Certificat de scolarite",
  REFERENCE: "Reference (attestation d'un ancien employeur)",
};

export function requiredDocs(isStudent: boolean): DocumentType[] {
  const base: DocumentType[] = ["CNI", "CASIER_JUDICIAIRE", "JUSTIFICATIF_DOMICILE", "REFERENCE"];
  return isStudent ? [...base, "CERTIFICAT_SCOLARITE"] : base;
}

type DocLite = Pick<VerificationDocument, "id" | "type" | "status" | "note" | "createdAt">;

/** Pour chaque piece exigee : la plus recente envoyee et son statut. */
export function checklist(isStudent: boolean, docs: DocLite[]) {
  const items = requiredDocs(isStudent).map((type) => {
    const latest = docs
      .filter((d) => d.type === type)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return {
      type,
      label: DOC_LABELS[type],
      status: (latest?.status ?? "MISSING") as VerificationStatus | "MISSING",
      documentId: latest?.id ?? null,
      note: latest?.note ?? null,
    };
  });
  return {
    items,
    allUploaded: items.every((i) => i.status !== "MISSING" && i.status !== "REJECTED"),
    allVerified: items.every((i) => i.status === "VERIFIED"),
  };
}

/** Champs du profil a remplir avant de pouvoir soumettre le dossier. */
export function missingProfileFields(p: { bio: string | null; bookingTypes: unknown[] }) {
  const missing: string[] = [];
  if (!p.bio || p.bio.length < 30) missing.push("bio (30 caracteres minimum)");
  if (p.bookingTypes.length === 0) missing.push("types de garde proposes");
  return missing;
}
