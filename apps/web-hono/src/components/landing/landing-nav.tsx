import { Link } from "@tanstack/react-router";
import { KaipuLogo } from "@kaipu/brand";
import { useTranslations } from "@kaipu/i18n";
import { LocaleSwitcher } from "../locale-switcher";
import { ThemeToggle } from "../theme-toggle";

export function LandingNav() {
  const t = useTranslations("landing");
  const tRoadmap = useTranslations("roadmap");
  return (
    <nav className="flex items-center justify-between px-6 py-4">
      <Link to="/" className="flex items-center gap-2 font-bold text-[var(--kaipu-text-primary)]">
        <KaipuLogo use="product" size={24} />
        {t("navBrand")}
      </Link>
      <div className="flex items-center gap-3">
        <Link
          to="/roadmap"
          className="text-sm font-medium text-[var(--kaipu-text-secondary)] underline-offset-4 transition hover:text-[var(--kaipu-text-primary)] hover:underline"
        >
          {tRoadmap("navLabel")}
        </Link>
        <ThemeToggle />
        <LocaleSwitcher />
        {/* Routed rather than a bare anchor: the nav also renders off the landing page. */}
        <Link
          to="/"
          hash="download"
          className="rounded-lg bg-[var(--kaipu-accent-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--kaipu-accent-primary-hover)]"
        >
          {t("navDownload")}
        </Link>
      </div>
    </nav>
  );
}
