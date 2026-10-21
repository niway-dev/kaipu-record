import { ArrowRight, Monitor } from "lucide-react";
import { KaipuLogo } from "@kaipu/brand";
import { useTranslations } from "@kaipu/i18n";

import { DownloadLink } from "@/components/download-link";
import { downloadUrls } from "@/lib/download";
import styles from "./sticky-cta.module.css";

/**
 * The persistent mobile call to action.
 *
 * On a phone the download button scrolls out of the hero within one swipe and
 * never comes back until the very bottom of the page — this keeps the one thing
 * the page is for within thumb reach the whole way down. Hidden on desktop,
 * where the top bar already carries a permanent Download button.
 *
 * The Mac installer is the main action; the Windows beta sits beside it as a
 * smaller chip so it is reachable without competing with the primary.
 */
export function StickyCta() {
  const t = useTranslations("landing");
  return (
    <div className={styles.bar}>
      <DownloadLink
        placement="sticky"
        href={downloadUrls.macArm64}
        className={`${styles.cta} kl-float-card`}
      >
        <KaipuLogo use="product" size={28} />
        {t("homeStickyCta")}
        <span className={styles.arrow} aria-hidden>
          <ArrowRight size={16} />
        </span>
      </DownloadLink>
      <DownloadLink
        placement="sticky"
        href={downloadUrls.windowsX64}
        className={`${styles.windows} kl-float-card`}
      >
        <Monitor size={16} aria-hidden />
        {t("downloadWindowsBeta")}
      </DownloadLink>
    </div>
  );
}
