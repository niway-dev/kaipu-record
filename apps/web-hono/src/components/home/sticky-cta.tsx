import { ArrowRight } from "lucide-react";
import { KaipuLogo } from "@kaipu/brand";
import { useTranslations } from "@kaipu/i18n";

import { downloadUrls } from "@/lib/download";
import styles from "./sticky-cta.module.css";

/**
 * The persistent mobile call to action.
 *
 * On a phone the download button scrolls out of the hero within one swipe and
 * never comes back until the very bottom of the page — this keeps the one thing
 * the page is for within thumb reach the whole way down. Hidden on desktop,
 * where the top bar already carries a permanent Download button.
 */
export function StickyCta() {
  const t = useTranslations("landing");
  return (
    <a href={downloadUrls.macArm64} className={`${styles.cta} kl-float-card`}>
      <KaipuLogo use="product" size={28} />
      {t("homeStickyCta")}
      <span className={styles.arrow} aria-hidden>
        <ArrowRight size={16} />
      </span>
    </a>
  );
}
