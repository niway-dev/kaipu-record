export const LEGAL_VERSION = "2026-09-14";
export const LEGAL_CONTACT_EMAIL = "contacto@niway.dev";

export const LEGAL_DOCUMENTS = {
  terms: "/legal/terms-and-conditions",
  privacy: "/legal/privacy-policy",
  cloud: "/legal/cloud-terms",
  cookies: "/legal/cookies",
} as const;

export type LegalDocumentId = keyof typeof LEGAL_DOCUMENTS;
