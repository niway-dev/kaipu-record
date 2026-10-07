import React, { useMemo } from "react";
import { PenLine } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { useLocalLibrary } from "@renderer/features/library/hooks/use-local-library";
import { KindBadge } from "@renderer/features/library/components/kind-badge";
import { EditBadge } from "@renderer/features/library/components/edit-badge";
import { buildLineage, editBadge } from "@renderer/features/library/lineage";
import { canOpenInEditor, useOpenInEditor } from "@renderer/features/editor/open-in-editor";
import styles from "./editor-page.module.css";

/** How many recent items the empty workspace offers. */
export const RECENT_EDITABLE_COUNT = 5;

/**
 * `/editor` with nothing open: the five most recent items that can be edited
 * (videos and images), each with an Edit action that lands in its editor.
 */
export function EditorHomePage(): React.JSX.Element {
  const t = useTranslations("editor");
  const { videos, isLoading } = useLocalLibrary();
  const { openItem } = useOpenInEditor();

  const recent = useMemo(
    () =>
      videos
        .filter(canOpenInEditor)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, RECENT_EDITABLE_COUNT),
    [videos],
  );
  // The same export-state signal the library shows: this list is "what you are
  // working on", and whether those edits are in any file yet is the one fact a
  // visitor of this page needs before picking an item.
  const lineage = useMemo(() => buildLineage(videos), [videos]);

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t("title")}</h1>
      <p className={styles.subtitle}>{t("subtitle")}</p>

      <h2 className={styles.sectionTitle}>{t("recentTitle")}</h2>
      {!isLoading && recent.length === 0 ? (
        <p className={styles.empty}>{t("empty")}</p>
      ) : (
        <ul className={styles.list}>
          {recent.map((item) => (
            <li key={item.assetId} className={styles.row}>
              {item.thumbnailUrl ? (
                <img src={item.thumbnailUrl} alt="" className={styles.thumb} />
              ) : (
                <span className={styles.thumb} aria-hidden />
              )}
              <span className={styles.rowTitle}>{item.title}</span>
              <KindBadge kind={item.kind} />
              <EditBadge state={editBadge(item, lineage)} />
              <button
                type="button"
                className={styles.edit}
                onClick={() => openItem(item)}
                aria-label={t("editItem", { title: item.title })}
              >
                <PenLine size={14} strokeWidth={1.8} />
                {t("edit")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
