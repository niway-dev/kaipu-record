import { Apple, Menu, Moon, Sun } from "lucide-react";
import { useRouteContext, useRouter } from "@tanstack/react-router";
import { KaipuLogo } from "@kaipu/brand";
import { SUPPORTED_LOCALES, useLocale, useSetLocale, useTranslations } from "@kaipu/i18n";

import { downloadUrls } from "@/lib/download";
import { setLandingTheme } from "@/server-functions/set-landing-theme";
import { useScrolled } from "./use-scrolled";
import styles from "./top-nav.module.css";

/**
 * The fixed top bar, and the two switches a visitor actually needs: the
 * language and the landing's theme.
 *
 * Both persist in a cookie and then re-run the route's beforeLoad, so the
 * server re-renders with the new answer instead of the client patching it. That
 * is why neither one flashes and why a reload keeps the choice.
 */
/** The marketing pages that share this bar. */
export type MarketingPage = "home" | "features" | "roadmap";

const PAGE_PATHS: Record<MarketingPage, string> = {
  home: "/",
  features: "/features",
  roadmap: "/roadmap",
};

export function TopNav({ page = "home" }: { page?: MarketingPage }) {
  const t = useTranslations("landing");
  const tRoadmap = useTranslations("roadmap");
  const onHome = page === "home";
  // The current page's tab scrolls back to the top instead of reloading it.
  const tab = (target: MarketingPage) => ({
    href: page === target ? "#top" : PAGE_PATHS[target],
    className: `${styles.tab} ${page === target ? styles.tabActive : ""}`,
    "aria-current": page === target ? ("page" as const) : undefined,
  });
  const locale = useLocale();
  const setLocale = useSetLocale();
  const router = useRouter();
  const { landingTheme, hasSessionCookie } = useRouteContext({ from: "__root__" });
  // Signed in (a session cookie is present): the way back into the app. Otherwise: the way in.
  const account = hasSessionCookie
    ? { href: "/dashboard", label: t("navDashboard"), className: styles.dashboard }
    : { href: "/auth/login", label: t("navSignIn"), className: styles.signIn };
  const nextTheme = landingTheme === "dark" ? "light" : "dark";
  // Transparent over the hero; glass once content scrolls underneath it.
  const scrolled = useScrolled();

  const toggleTheme = async () => {
    await setLandingTheme({ data: nextTheme });
    await router.invalidate();
  };

  return (
    <header className={styles.nav} data-scrolled={scrolled}>
      {/*
        The bar is full-bleed (it spans the viewport and carries the blur), but
        its CONTENTS sit in the same container as the page below, so the mark on
        the left and the Download button on the right land on the page's own
        left and right edges instead of on the viewport's.
      */}
      <div className={styles.inner}>
        <a href={onHome ? "#top" : "/"} className={styles.brand}>
          <KaipuLogo use="product" size={30} />
          {t("navBrand")}
        </a>

        <nav className={styles.center}>
          <a {...tab("home")}>{t("homeNavProduct")}</a>
          <a {...tab("features")}>{t("homeNavFeatures")}</a>
          <a {...tab("roadmap")}>{tRoadmap("navLabel")}</a>
        </nav>

        <div className={styles.mobileEnd}>
          <a href={account.href} className={`${account.className} ${styles.accountMobile}`}>
            {account.label}
          </a>
          <button type="button" className={styles.menuBtn} aria-label={t("homeMenuOpen")}>
            <Menu size={19} aria-hidden />
          </button>
        </div>

        <div className={styles.right}>
          {/* The icon shows the theme you would GET, not the one you are in. */}
          <button
            type="button"
            className={styles.round}
            aria-label={nextTheme === "light" ? t("homeThemeToLight") : t("homeThemeToDark")}
            onClick={() => void toggleTheme()}
          >
            {nextTheme === "light" ? <Sun size={17} aria-hidden /> : <Moon size={17} aria-hidden />}
          </button>
          <div className={styles.locale} role="group" aria-label={t("homeLocaleGroup")}>
            {SUPPORTED_LOCALES.map((code) => (
              <button
                key={code}
                type="button"
                className={`${styles.localeOption} ${code === locale ? styles.localeActive : ""}`}
                aria-pressed={code === locale}
                onClick={() => setLocale(code)}
              >
                {code.toUpperCase()}
              </button>
            ))}
          </div>
          <a href={account.href} className={account.className}>
            {account.label}
          </a>
          <a href={downloadUrls.macArm64} className={styles.download}>
            <Apple size={16} aria-hidden />
            {t("navDownload")}
          </a>
        </div>
      </div>
    </header>
  );
}
