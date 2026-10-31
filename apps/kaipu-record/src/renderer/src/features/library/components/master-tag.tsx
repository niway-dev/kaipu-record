import { Shield } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import styles from "./master-tag.module.css";

/**
 * "MASTER · FULL QUALITY" (NIW2-585): marks an original recording over its player and on its
 * Library card, so the file copies are made from reads as such everywhere. Callers decide
 * when it shows (`isMaster`).
 */
export function MasterTag({ size = "md" }: { size?: "sm" | "md" }): React.JSX.Element {
  const t = useTranslations("library");
  return (
    <span className={styles.tag} data-size={size} title={t("masterTagHint")}>
      <Shield size={size === "sm" ? 10 : 11} strokeWidth={2} aria-hidden />
      {t("masterTag")}
    </span>
  );
}
