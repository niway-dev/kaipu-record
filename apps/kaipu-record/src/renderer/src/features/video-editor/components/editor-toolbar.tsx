import { Redo2, Scissors, Trash2, Undo2 } from "lucide-react";
import styles from "./editor-toolbar.module.css";

export interface EditorToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  /** Split the clip under the playhead. Disabled when the playhead isn't inside a clip. */
  onSplit(): void;
  splitDisabled: boolean;
  /** Delete the selected segment. Disabled when nothing is selected. */
  onDeleteSelected(): void;
  deleteDisabled: boolean;
}

/**
 * Undo/redo + split/delete actions for the video editor. Structure mirrors the
 * screenshot editor's toolbar (AnnotationToolbar on the left, action icons on the
 * right) — see screenshot-editor-page.tsx. The left side is intentionally empty: plan
 * 04 adds an annotation tool group there.
 */
export function EditorToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSplit,
  splitDisabled,
  onDeleteSelected,
  deleteDisabled,
}: EditorToolbarProps): React.JSX.Element {
  return (
    <div className={styles.toolbar}>
      <div className={styles.toolGroup} />
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.iconBtn}
          title="Deshacer"
          aria-label="Deshacer"
          disabled={!canUndo}
          onClick={onUndo}
        >
          <Undo2 size={18} />
        </button>
        <button
          type="button"
          className={styles.iconBtn}
          title="Rehacer"
          aria-label="Rehacer"
          disabled={!canRedo}
          onClick={onRedo}
        >
          <Redo2 size={18} />
        </button>
        <span className={styles.divider} />
        <button
          type="button"
          className={styles.iconBtn}
          title="Cortar aquí"
          aria-label="Cortar aquí"
          disabled={splitDisabled}
          onClick={onSplit}
        >
          <Scissors size={18} />
        </button>
        <button
          type="button"
          className={styles.iconBtn}
          title="Eliminar segmento"
          aria-label="Eliminar segmento"
          disabled={deleteDisabled}
          onClick={onDeleteSelected}
        >
          <Trash2 size={18} />
        </button>
      </div>
    </div>
  );
}
