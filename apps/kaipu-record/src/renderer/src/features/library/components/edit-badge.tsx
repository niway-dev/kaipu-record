import { useTranslations } from "@kaipu/i18n";
import type { EditBadge as EditBadgeState } from "../lineage";
import styles from "./edit-badge.module.css";

/**
 * "Edited · not exported" (accent) or "Edited" (muted) on cards, rows and the detail
 * page — the library-side signal that the file on disk is still the original.
 */
export function EditBadge({ state }: { state: EditBadgeState }): React.JSX.Element | null {
  const t = useTranslations("library");
  if (state === null) return null;
  return state === "not-exported" ? (
    <span className={styles.notExported} title={t("editedNotExportedHint")}>
      {t("editedNotExported")}
    </span>
  ) : (
    <span className={styles.edited}>{t("edited")}</span>
  );
}
