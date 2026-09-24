import { useTranslations } from "@kaipu/i18n";
import type { EditBadge as EditBadgeState } from "../lineage";
import styles from "./edit-badge.module.css";

/**
 * The library-side signal that the file on disk is still the original.
 *
 * Three states, not two: "never exported" and "exported, then edited again" look the
 * same to the file system but mean different things to the user, and showing the first
 * one's copy on a recording that visibly has an Exports section reads as a bug — it
 * says "not exported" directly above the export. Both are the accent style: in both,
 * some edit exists in no file.
 */
export function EditBadge({ state }: { state: EditBadgeState }): React.JSX.Element | null {
  const t = useTranslations("library");
  if (state === null) return null;
  if (state === "edited") return <span className={styles.edited}>{t("edited")}</span>;
  const stale = state === "stale";
  return (
    <span
      className={styles.notExported}
      title={stale ? t("editedStaleHint") : t("editedNotExportedHint")}
    >
      {stale ? t("editedStale") : t("editedNotExported")}
    </span>
  );
}
