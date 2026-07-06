import { useRef } from "react";
import {
  ArrowUpRight,
  Download,
  ImagePlus,
  MousePointer2,
  Redo2,
  Scissors,
  Square,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { VIDEO_TOOLS, type VideoTool } from "../annotations/video-tools";
import styles from "./editor-toolbar.module.css";

/** Accepted image types for the "Add image" tool — matches SlideAssetStore's decode path. */
const SLIDE_IMAGE_TYPES = "image/png,image/jpeg,image/webp";

type ToolLabelKey = "toolSelect" | "toolBox" | "toolArrow" | "toolText";

const TOOL_META: Record<VideoTool, { labelKey: ToolLabelKey; Icon: typeof Square }> = {
  select: { labelKey: "toolSelect", Icon: MousePointer2 },
  box: { labelKey: "toolBox", Icon: Square },
  arrow: { labelKey: "toolArrow", Icon: ArrowUpRight },
  text: { labelKey: "toolText", Icon: Type },
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
  /** Insert an image slide at the playhead's nearest item boundary. */
  onAddImage(file: File): void;
  /** Current annotation tool. */
  tool: VideoTool;
  onToolChange(tool: VideoTool): void;
  /** Run the export pipeline. Disabled while exporting or when the timeline is empty. */
  onExport(): void;
  exportDisabled: boolean;
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
  onAddImage,
  tool,
  onToolChange,
  onExport,
  exportDisabled,
}: EditorToolbarProps): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className={styles.toolbar}>
      <div className={styles.toolGroup}>
        {VIDEO_TOOLS.map((toolKey) => {
          const { labelKey, Icon } = TOOL_META[toolKey];
          const label = t(labelKey);
          return (
            <button
              key={toolKey}
              type="button"
              title={label}
              aria-label={label}
              className={`${styles.tool} ${tool === toolKey ? styles.toolActive : ""}`}
              onClick={() => onToolChange(toolKey)}
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
          title={t("undo")}
          aria-label={t("undo")}
          disabled={!canUndo}
          onClick={onUndo}
        >
          <Undo2 size={18} />
        </button>
        <button
          type="button"
          className={styles.iconBtn}
          title={t("redo")}
          aria-label={t("redo")}
          disabled={!canRedo}
          onClick={onRedo}
        >
          <Redo2 size={18} />
        </button>
        <span className={styles.divider} />
        <input
          ref={fileInputRef}
          type="file"
          data-testid="slide-image-input"
          accept={SLIDE_IMAGE_TYPES}
          className={styles.hiddenInput}
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Reset so choosing the same file again still fires a change event.
            event.target.value = "";
            if (file) onAddImage(file);
          }}
        />
        <button
          type="button"
          className={styles.iconBtn}
          title={t("addImage")}
          aria-label={t("addImage")}
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlus size={18} />
        </button>
        <button
          type="button"
          className={styles.iconBtn}
          title={t("splitHere")}
          aria-label={t("splitHere")}
          disabled={splitDisabled}
          onClick={onSplit}
        >
          <Scissors size={18} />
        </button>
        <button
          type="button"
          className={styles.iconBtn}
          title={t("deleteSegment")}
          aria-label={t("deleteSegment")}
          disabled={deleteDisabled}
          onClick={onDeleteSelected}
        >
          <Trash2 size={18} />
        </button>
        <span className={styles.divider} />
        <button
          type="button"
          className={styles.exportBtn}
          disabled={exportDisabled}
          onClick={onExport}
        >
          <Download size={16} />
          {t("export")}
        </button>
      </div>
    </div>
  );
}
