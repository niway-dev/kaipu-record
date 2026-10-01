import { Apple, Menu, Moon, Sun } from "lucide-react";
import { useRouteContext, useRouter } from "@tanstack/react-router";
import { KaipuLogo } from "@kaipu/brand";
import { SUPPORTED_LOCALES, useLocale, useSetLocale, useTranslations } from "@kaipu/i18n";

import { downloadUrls } from "@/lib/download";
import { setLandingTheme } from "@/server-functions/set-landing-theme";
import styles from "./top-nav.module.css";

/**
 * The fixed top bar, and the two switches a visitor actually needs: the
 * language and the landing's theme.
 *
 * Both persist in a cookie and then re-run the route's beforeLoad, so the
 * server re-renders with the new answer instead of the client patching it. That
 * is why neither one flashes and why a reload keeps the choice.
 */
export function TopNav() {
  const t = useTranslations("landing");
  const tRoadmap = useTranslations("roadmap");
  const locale = useLocale();
  const setLocale = useSetLocale();
  const router = useRouter();
  const { landingTheme } = useRouteContext({ from: "__root__" });
  const nextTheme = landingTheme === "dark" ? "light" : "dark";

  const toggleTheme = async () => {
    await setLandingTheme({ data: nextTheme });
    await router.invalidate();
  };

  return (
    <header className={styles.nav}>
      {/*
        The bar is full-bleed (it spans the viewport and carries the blur), but
        its CONTENTS sit in the same container as the page below, so the mark on
        the left and the Download button on the right land on the page's own
        left and right edges instead of on the viewport's.
      */}
      <div className={styles.inner}>
        <a href="#top" className={styles.brand}>
          <KaipuLogo use="product" size={30} />
          {t("navBrand")}
        </a>

        <nav className={styles.center}>
          <a href="#top" className={`${styles.tab} ${styles.tabActive}`}>
            {t("homeNavProduct")}
          </a>
          <a href="#files" className={styles.tab}>
            {t("homeNavYourFiles")}
          </a>
          <a href="/roadmap" className={styles.tab}>
            {tRoadmap("navLabel")}
          </a>
        </nav>

        <button type="button" className={styles.menuBtn} aria-label={t("homeMenuOpen")}>
          <Menu size={19} aria-hidden />
        </button>

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
          <a href={downloadUrls.macArm64} className={styles.download}>
            <Apple size={16} aria-hidden />
            {t("navDownload")}
          </a>
        </div>
      </div>
    </header>
  );
}
