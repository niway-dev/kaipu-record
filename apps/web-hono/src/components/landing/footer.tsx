import { useTranslations } from "@kaipu/i18n";

export function Footer() {
  const t = useTranslations("landing");
  return (
    <footer className="border-t border-[var(--kaipu-border)] px-6 py-8 text-center text-sm text-[var(--kaipu-text-muted)]">
      <span className="flex items-center justify-center gap-2 font-semibold text-[var(--kaipu-text-secondary)]">
        <span className="h-2 w-2 rounded-full bg-[var(--kaipu-accent)]" /> {t("navBrand")} Record
      </span>
      <p className="mt-2">{t("footerTagline")}</p>
    </footer>
  );
}
