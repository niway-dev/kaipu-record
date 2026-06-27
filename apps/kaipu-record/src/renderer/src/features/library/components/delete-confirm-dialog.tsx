import { useEffect, useRef } from "react";
import { Trash2 } from "lucide-react";
import styles from "./delete-confirm-dialog.module.css";

interface DeleteConfirmDialogProps {
  title: string;
  isDeleting?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteConfirmDialog({
  title,
  isDeleting,
  onCancel,
  onConfirm,
}: DeleteConfirmDialogProps): React.JSX.Element {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    overlayRef.current?.focus();
  }, []);

  return (
    <div
      ref={overlayRef}
      className={styles.overlay}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="delete-dialog-title"
      aria-describedby="delete-dialog-desc"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
      onClick={onCancel}
    >
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <span className={styles.icon} aria-hidden>
          <Trash2 size={20} strokeWidth={1.8} />
        </span>
        <h3 id="delete-dialog-title" className={styles.title}>
          Delete recording?
        </h3>
        <p id="delete-dialog-desc" className={styles.desc}>
          <strong className={styles.name}>{title || "Untitled recording"}</strong> will be
          permanently removed from your vault. This can&apos;t be undone.
        </p>
        <div className={styles.footer}>
          <button className={styles.cancel} onClick={onCancel}>
            Cancel
          </button>
          <button className={styles.confirm} onClick={onConfirm} disabled={isDeleting}>
            {isDeleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
