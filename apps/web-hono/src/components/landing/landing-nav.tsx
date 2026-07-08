import { useTranslations } from "@kaipu/i18n";
import { LocaleSwitcher } from "../locale-switcher";
import { ThemeToggle } from "../theme-toggle";

export function LandingNav() {
  const t = useTranslations("landing");
  return (
    <nav className="flex items-center justify-between px-6 py-4">
      <span className="flex items-center gap-2 font-bold text-[var(--kaipu-text-primary)]">
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--kaipu-accent-primary)]" />{" "}
        {t("navBrand")}
      </span>
      <div className="flex items-center gap-3">
        <ThemeToggle />
        <LocaleSwitcher />
        <a
          href="#download"
          className="rounded-lg bg-[var(--kaipu-accent-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--kaipu-accent-primary-hover)]"
        >
          {t("navDownload")}
        </a>
      </div>
    </nav>
  );
}
