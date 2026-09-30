import { Link } from "@tanstack/react-router";
import { useTranslations } from "@kaipu/i18n";

import { KaipuMark } from "@/components/kaipu-mark";
import { LegalLinks } from "@/components/legal/legal-links";

export function Footer() {
  const t = useTranslations("landing");
  const tRoadmap = useTranslations("roadmap");
  return (
    <footer className="border-t border-[var(--kaipu-border)] px-6 py-8 text-center text-sm text-[var(--kaipu-text-muted)]">
      <span className="flex items-center justify-center gap-2 font-semibold text-[var(--kaipu-text-secondary)]">
        <KaipuMark size={16} className="text-[var(--kaipu-accent-primary)]" /> {t("navBrand")}{" "}
        Record
      </span>
      <p className="mt-2 font-medium text-[var(--kaipu-text-secondary)]">{t("footerSignature")}</p>
      <p className="mt-1">{t("footerTagline")}</p>
      <div className="mt-5">
        <Link to="/roadmap" className="underline-offset-4 hover:underline focus-visible:underline">
          {tRoadmap("navLabel")}
        </Link>
      </div>
      <div className="mt-3">
        <LegalLinks />
      </div>
    </footer>
  );
}
