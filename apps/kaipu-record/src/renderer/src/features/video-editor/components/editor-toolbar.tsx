import { useRef } from "react";
import {
  ArrowUpRight,
  Download,
  Droplet,
  ImagePlus,
  MousePointer2,
  Redo2,
  Scissors,
  Square,
  RectangleHorizontal,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
} from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import {
  type EditorTool,
  PRIVACY_TOOLS,
  type PrivacyTool,
  VIDEO_TOOLS,
  type VideoTool,
} from "../annotations/video-tools";
import styles from "./editor-toolbar.module.css";

/** Accepted image types for the "Add image" tool — matches SlideAssetStore's decode path. */
const SLIDE_IMAGE_TYPES = "image/png,image/jpeg,image/webp";

type ToolLabelKey = "toolSelect" | "toolBox" | "toolArrow" | "toolText";

type HintKey = "hintSelect" | "hintBox" | "hintArrow" | "hintText" | "hintBlur" | "hintCover";

/** Contextual one-line hint per active tool (UI spec § 3.2). Exhaustive on purpose:
 *  when PR 8 adds "blur" and "cover" to VideoTool this stops compiling until their
 *  hints exist. Zoom is an ACTION, not a tool, so it is absent here by design — its
 *  `hintZoom` copy lives on the button's title (see the camera group below). */
const TOOL_HINT: Record<EditorTool, HintKey> = {
  select: "hintSelect",
  box: "hintBox",
  arrow: "hintArrow",
  text: "hintText",
  blur: "hintBlur",
  cover: "hintCover",
};

/** Blur uses the screenshot editor's Droplet on purpose (UI spec § 3.1: same icon, same behavior). */
const PRIVACY_META: Record<
  PrivacyTool,
  { labelKey: "toolBlur" | "toolCover"; Icon: typeof Square }
> = {
  blur: { labelKey: "toolBlur", Icon: Droplet },
  cover: { labelKey: "toolCover", Icon: RectangleHorizontal },
};

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
  /** Current tool (annotation or privacy). */
  tool: EditorTool;
  onToolChange(tool: EditorTool): void;
  /** Add a zoom at the playhead, or select the one already there (video-editor v2). */
  onAddZoom(): void;
  /** Blur/Cover need footage: disabled while the playhead is on a slide. */
  privacyDisabled: boolean;
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
  onAddZoom,
  privacyDisabled,
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
      {/* Camera group (UI spec § 3.1 group 2). Zoom is an ACTION, not a drawing mode:
          it adds a zoom at the playhead (or selects the one there) and the camera box
          on the preview is how it gets re-aimed. */}
      <div className={styles.toolGroup}>
        <button
          type="button"
          title={t("hintZoom")}
          aria-label={t("toolZoom")}
          className={styles.tool}
          onClick={onAddZoom}
        >
          <ZoomIn size={19} />
        </button>
        {PRIVACY_TOOLS.map((toolKey) => {
          const { labelKey, Icon } = PRIVACY_META[toolKey];
          const label = t(labelKey);
          return (
            <button
              key={toolKey}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={tool === toolKey}
              disabled={privacyDisabled}
              className={`${styles.tool} ${tool === toolKey ? styles.toolActive : ""}`}
              onClick={() => onToolChange(toolKey)}
            >
              <Icon size={19} />
            </button>
          );
        })}
      </div>
      <span className={styles.hint}>{t(TOOL_HINT[tool])}</span>
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
