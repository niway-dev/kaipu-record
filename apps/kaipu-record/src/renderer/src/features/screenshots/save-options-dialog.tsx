import { useEffect, useRef } from "react";
import { Copy, Save } from "lucide-react";
import styles from "./save-options-dialog.module.css";

interface SaveOptionsDialogProps {
  title: string;
  onOverwrite(): void;
  onSaveCopy(): void;
  onCancel(): void;
}

/** Shown when saving a screenshot that already exists in the vault: overwrite it
 *  in place, or keep the original and store a new copy. */
export function SaveOptionsDialog({
  title,
  onOverwrite,
  onSaveCopy,
  onCancel,
}: SaveOptionsDialogProps): React.JSX.Element {
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
      aria-labelledby="save-dialog-title"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
      onClick={onCancel}
    >
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <span className={styles.icon} aria-hidden>
          <Save size={20} strokeWidth={1.8} />
        </span>
        <h3 id="save-dialog-title" className={styles.title}>
          Save changes
        </h3>
        <p className={styles.desc}>
          <strong className={styles.name}>{title}</strong> already exists. Overwrite it, or keep it
          and save a copy?
        </p>
        <div className={styles.footer}>
          <button className={styles.cancel} onClick={onCancel}>
            Cancel
          </button>
          <button className={styles.secondary} onClick={onSaveCopy}>
            <Copy size={15} strokeWidth={1.8} />
            Save copy
          </button>
          <button className={styles.confirm} onClick={onOverwrite}>
            <Save size={15} strokeWidth={1.8} />
            Overwrite
          </button>
        </div>
      </div>
    </div>
  );
}
