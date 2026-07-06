import { useLocale, useSetLocale, useTranslations, type Locale } from "@kaipu/i18n";

/** Compact language picker. Writes the cookie + re-runs the root loader via the provider. */
export function LocaleSwitcher() {
  const locale = useLocale();
  const setLocale = useSetLocale();
  const t = useTranslations("settings");
  return (
    <select
      aria-label={t("language")}
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
      className="rounded-md border border-white/15 bg-transparent px-2 py-1 text-sm text-[var(--kaipu-text-primary)]"
    >
      <option value="es">{t("spanish")}</option>
      <option value="en">{t("english")}</option>
    </select>
  );
}
