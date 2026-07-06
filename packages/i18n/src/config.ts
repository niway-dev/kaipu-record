export const SUPPORTED_LOCALES = ["es", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "es";
export const TIME_ZONE = "America/Lima";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Map a region locale to a supported base: "es-419" → "es", "en-US" → "en", unknown → default. */
export function normalizeLocale(input: string | null | undefined): Locale {
  if (!input) return DEFAULT_LOCALE;
  const base = input.toLowerCase().split("-")[0] ?? "";
  return isLocale(base) ? base : DEFAULT_LOCALE;
}
