import { Trash2 } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import {
  ANNOTATION_COLORS,
  STROKE_WIDTHS,
  TEXT_SIZES,
} from "@renderer/features/screenshots/annotations";
import type { VideoOverlay } from "../scene";
import type { VideoToolsController } from "../annotations/video-tools";
import styles from "./overlay-options.module.css";

/**
 * Normalized contextual controls, so one panel drives two cases: editing the
 * *selected* overlay, or setting the *next-draw* defaults on the active tool. Mirrors
 * the screenshot editor's annotation-options.tsx (see resolveControls there) — reduced
 * to this feature's tools (select/box/arrow/text, no pen/blur/crop), so unlike the
 * screenshot version every overlay kind has color + either stroke or size.
 */
interface ContextualControls {
  /** "size" for text, "stroke" for box/arrow. */
  mode: "stroke" | "size";
  color: string;
  setColor(color: string): void;
  /** Index into STROKE_WIDTHS or TEXT_SIZES. */
  level: number;
  setLevel(level: number): void;
}

function resolveControls(
  tools: VideoToolsController,
  overlays: VideoOverlay[],
  selectedId: string | null,
  onCommitOverlay: (id: string, patch: Partial<VideoOverlay>) => void,
): ContextualControls | null {
  const selected = selectedId ? (overlays.find((o) => o.id === selectedId) ?? null) : null;
  // A selected overlay → edit it (single undoable change per click). Picking a value
  // also updates the *current* tool default, so the choice "sticks" for the next
  // overlay too (change colour on a selection → keep drawing in that colour).
  if (selected) {
    return selected.kind === "text"
      ? {
          mode: "size",
          color: selected.color,
          setColor: (color) => {
            onCommitOverlay(selected.id, { color });
            tools.setColor(color);
          },
          level: selected.size,
          setLevel: (size) => {
            onCommitOverlay(selected.id, { size });
            tools.setTextSize(size);
          },
        }
      : {
          mode: "stroke",
          color: selected.color,
          setColor: (color) => {
            onCommitOverlay(selected.id, { color });
            tools.setColor(color);
          },
          level: selected.stroke,
          setLevel: (stroke) => {
            onCommitOverlay(selected.id, { stroke });
            tools.setStroke(stroke);
          },
        };
  }
  // Nothing selected + select tool → nothing to set.
  if (tools.tool === "select") return null;
  // A drawing tool is active → set the defaults for the next shape.
  return tools.tool === "text"
    ? {
        mode: "size",
        color: tools.color,
        setColor: tools.setColor,
        level: tools.textSize,
        setLevel: tools.setTextSize,
      }
    : {
        mode: "stroke",
        color: tools.color,
        setColor: tools.setColor,
        level: tools.stroke,
        setLevel: tools.setStroke,
      };
}

export interface OverlayOptionsProps {
  tools: VideoToolsController;
  overlays: VideoOverlay[];
  selectedId: string | null;
  /** One undoable commit for the selected overlay. */
  onCommitOverlay(id: string, patch: Partial<VideoOverlay>): void;
  onDeleteSelected(): void;
}

/**
 * Floating options panel over the preview stage (Excalidraw-style, same as the
 * screenshot editor's AnnotationOptions). Renders `null` when there's nothing to
 * edit (select tool, no selection) so the stage stays clean.
 */
export function OverlayOptions({
  tools,
  overlays,
  selectedId,
  onCommitOverlay,
  onDeleteSelected,
}: OverlayOptionsProps): React.JSX.Element | null {
  const t = useTranslations("videoEditor");
  const selected = selectedId ? (overlays.find((o) => o.id === selectedId) ?? null) : null;
  const controls = resolveControls(tools, overlays, selectedId, onCommitOverlay);
  if (!controls) return null;

  return (
    <div className={styles.panel}>
      <span className={styles.label}>{t("colorLabel")}</span>
      <div className={styles.palette}>
        {ANNOTATION_COLORS.map((c) => (
          <button
            key={c.value}
            type="button"
            title={c.name}
            aria-label={c.name}
            className={`${styles.swatch} ${controls.color === c.value ? styles.swatchOn : ""}`}
            style={{ background: c.value }}
            onClick={() => controls.setColor(c.value)}
          />
        ))}
      </div>

      {controls.mode === "size" ? (
        <>
          <span className={styles.label}>{t("sizeLabel")}</span>
          <div className={styles.picker}>
            {TEXT_SIZES.map((label, i) => (
              <button
                key={label}
                type="button"
                aria-label={t("sizeAria", { label })}
                className={`${styles.pickerItem} ${styles.sizeItem} ${controls.level === i ? styles.pickerOn : ""}`}
                onClick={() => controls.setLevel(i)}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <span className={styles.label}>{t("strokeLabel")}</span>
          <div className={styles.picker}>
            {STROKE_WIDTHS.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={t("strokeAria", { n: i + 1 })}
                className={`${styles.pickerItem} ${controls.level === i ? styles.pickerOn : ""}`}
                onClick={() => controls.setLevel(i)}
              >
                <span className={styles.strokeBar} style={{ height: `${(i + 1) * 1.6 + 1}px` }} />
              </button>
            ))}
          </div>
        </>
      )}

      {selected && (
        <button
          type="button"
          aria-label={t("deleteAria")}
          title={t("deleteTitle")}
          className={styles.delete}
          onClick={onDeleteSelected}
        >
          <Trash2 size={16} />
        </button>
      )}
    </div>
  );
}
