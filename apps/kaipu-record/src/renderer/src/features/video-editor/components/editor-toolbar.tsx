import {
  ArrowUpRight,
  MousePointer2,
  Redo2,
  Scissors,
  Square,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import { VIDEO_TOOLS, type VideoTool } from "../annotations/video-tools";
import styles from "./editor-toolbar.module.css";

const TOOL_META: Record<VideoTool, { label: string; Icon: typeof Square }> = {
  select: { label: "Seleccionar", Icon: MousePointer2 },
  box: { label: "Cuadro", Icon: Square },
  arrow: { label: "Flecha", Icon: ArrowUpRight },
  text: { label: "Texto", Icon: Type },
};

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
  /** Current annotation tool. */
  tool: VideoTool;
  onToolChange(tool: VideoTool): void;
}

/**
 * Undo/redo + split/delete actions for the video editor, plus the annotation tool
 * group (select/box/arrow/text — see video-tools.ts) on the left. Structure and
 * active-tool styling mirror the screenshot editor's toolbar (AnnotationToolbar on
 * the left, action icons on the right) — see annotation-toolbar.tsx.
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
  tool,
  onToolChange,
}: EditorToolbarProps): React.JSX.Element {
  return (
    <div className={styles.toolbar}>
      <div className={styles.toolGroup}>
        {VIDEO_TOOLS.map((t) => {
          const { label, Icon } = TOOL_META[t];
          return (
            <button
              key={t}
              type="button"
              title={label}
              aria-label={label}
              className={`${styles.tool} ${tool === t ? styles.toolActive : ""}`}
              onClick={() => onToolChange(t)}
            >
              <Icon size={19} />
            </button>
          );
        })}
      </div>
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
