import { Apple, Menu, Sun } from "lucide-react";
import { KaipuLogo } from "@kaipu/brand";
import { useTranslations } from "@kaipu/i18n";

import { downloadUrls } from "@/lib/download";
import styles from "./top-nav.module.css";

/**
 * The fixed top bar. The theme and locale controls are rendered here as the
 * design shows them, but they are inert placeholders — the owner is building
 * both switches. They carry real labels so swapping in the behaviour is the
 * only change needed.
 */
export function TopNav() {
  const t = useTranslations("landing");
  const tRoadmap = useTranslations("roadmap");

  return (
    <header className={styles.nav}>
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
        <button type="button" className={styles.round} aria-label="Theme">
          <Sun size={17} aria-hidden />
        </button>
        <div className={styles.locale}>
          <button type="button" className={`${styles.localeOption} ${styles.localeActive}`}>
            EN
          </button>
          <button type="button" className={styles.localeOption}>
            ES
          </button>
        </div>
        <a href={downloadUrls.macArm64} className={styles.download}>
          <Apple size={16} aria-hidden />
          {t("navDownload")}
        </a>
      </div>
    </header>
  );
}
