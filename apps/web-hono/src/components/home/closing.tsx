import { Apple, Monitor } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { KaipuLogo } from "@kaipu/brand";
import { useTranslations } from "@kaipu/i18n";

import { DownloadLink } from "@/components/download-link";
import { downloadUrls } from "@/lib/download";
import { PixelGrid } from "./pixel-grid";
import styles from "./closing.module.css";

/** The last screen and the footer: the decision, and who made this. */
export function Closing() {
  const t = useTranslations("landing");
  const tRoadmap = useTranslations("roadmap");

  return (
    <>
      <section id="download" className={styles.closing}>
        <div className={`kl-glow ${styles.glow}`} aria-hidden />
        <PixelGrid className={styles.pixels} />

        <div className={styles.inner}>
          {/* `done`, once: the quiet celebration the audit asked for at the close. */}
          <KaipuLogo use="done" size={112} className={`${styles.logo} kl-anim-float`} />

          <h2 className={styles.title}>
            {t("homeCtaLead")} <span className={styles.serif}>{t("homeCtaSerif")}</span>
          </h2>

          <div className={styles.buttons}>
            <DownloadLink
              placement="closing"
              href={downloadUrls.macArm64}
              className={styles.primary}
            >
              <Apple size={19} aria-hidden />
              {t("downloadMacArm")}
            </DownloadLink>
            <DownloadLink
              placement="closing"
              href={downloadUrls.macX64}
              className={styles.secondary}
            >
              <Apple size={19} aria-hidden />
              {t("downloadMacIntel")}
            </DownloadLink>
            {/* lucide has no Windows mark; a monitor says "PC" without borrowing a logo. */}
            <DownloadLink
              placement="closing"
              href={downloadUrls.windowsX64}
              className={styles.secondary}
            >
              <Monitor size={19} aria-hidden />
              {t("downloadWindowsBeta")}
            </DownloadLink>
          </div>

          <p className={styles.footnote}>{t("homeCtaFootnote")}</p>
          <p className={styles.smartscreen}>{t("downloadWindowsSmartScreen")}</p>
        </div>
      </section>

      <footer className={styles.footer}>
        <span className={styles.brand}>
          <KaipuLogo use="product" size={26} />
          {t("navBrand")}
          <span className={styles.madeIn}>{t("homeMadeIn")}</span>
        </span>

        <nav className={styles.links}>
          <Link to="/features" className={styles.link}>
            {t("homeNavFeatures")}
          </Link>
          <Link to="/roadmap" className={styles.link}>
            {tRoadmap("navLabel")}
          </Link>
          <Link to="/legal/privacy-policy" className={styles.link}>
            {t("homeFooterPrivacy")}
          </Link>
          <a
            href="https://github.com/niway-dev/kaipu-record"
            className={styles.link}
            rel="noreferrer"
          >
            {t("homeFooterGithub")}
          </a>
        </nav>
      </footer>
    </>
  );
}
