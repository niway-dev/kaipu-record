import React from "react";
import { Check, Pencil, X } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { useRenameRecording } from "@renderer/features/library/hooks/use-rename-recording";
import styles from "./recording-title.module.css";

interface RecordingTitleProps {
  title: string;
  onRename: (title: string) => void;
}

/** Recording title with inline rename. The rename rules live in `useRenameRecording`. */
export function RecordingTitle({ title, onRename }: RecordingTitleProps): React.JSX.Element {
  const t = useTranslations("library");
  const { editing, draft, setDraft, startEdit, commitEdit, cancelEdit } = useRenameRecording(
    title,
    onRename,
  );

  if (editing) {
    return (
      <div className={styles.titleEdit}>
        <input
          className={styles.titleInput}
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitEdit();
            if (e.key === "Escape") cancelEdit();
          }}
        />
        <button type="button" className={styles.iconButton} onClick={commitEdit} title={t("save")}>
          <Check size={16} strokeWidth={2} />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          onClick={cancelEdit}
          title={t("cancel")}
        >
          <X size={16} strokeWidth={2} />
        </button>
      </div>
    );
  }

  return (
    <div className={styles.titleRow}>
      <h1 className={styles.title}>{title || t("untitled")}</h1>
      <button type="button" className={styles.iconButton} onClick={startEdit} title={t("rename")}>
        <Pencil size={15} strokeWidth={1.8} />
      </button>
    </div>
  );
}
