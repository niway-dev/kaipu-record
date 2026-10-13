import React from "react";
import { useTranslations } from "@kaipu/i18n";
import type { CaptureTitle } from "./use-capture-title";
import styles from "./capture-title-input.module.css";

/**
 * The capture's name, editable in place. Enter or blur commits; Esc reverts to
 * the last committed title. The rules live in `useCaptureTitle`.
 */
export function CaptureTitleInput({ title }: { title: CaptureTitle }): React.JSX.Element {
  const t = useTranslations("screenshots");
  return (
    <div className={styles.field}>
      <input
        type="text"
        className={styles.input}
        aria-label={t("titleLabel")}
        title={t("titleHint")}
        placeholder={title.autoTitle}
        value={title.draft}
        spellCheck={false}
        onChange={(e) => title.setDraft(e.target.value)}
        onBlur={title.commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            // Blur is the single commit path: committing here too would run the
            // blur handler's stale closure and rename a second time.
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            title.revert();
            // Keep the editor's own Esc handling (dialogs, tool deselect) out of it.
            e.stopPropagation();
          }
        }}
      />
    </div>
  );
}
