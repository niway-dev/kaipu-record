import type { VideoOverlay } from "../scene";
import type { VideoToolsController } from "../annotations/video-tools";

/**
 * Normalized contextual controls, so one function drives two cases: editing the
 * *selected* overlay, or setting the *next-draw* defaults on the active tool. Mirrors
 * the screenshot editor's annotation-options.tsx (see resolveControls there) — reduced
 * to this feature's tools (select/box/arrow/text, no pen/blur/crop), so unlike the
 * screenshot version every overlay kind has color + either stroke or size.
 *
 * The floating popover that used to live in this file is gone (UI spec § 7.4): its
 * controls moved into the properties column as AnnotationInspector / AnnotationDefaultsPanel
 * (components/inspector/annotation-inspector.tsx), which import `resolveControls` from
 * here — this file is now just the shared resolver, plus overlay-options.module.css
 * (still imported by annotation-inspector.tsx for the palette/picker styles).
 */
export interface ContextualControls {
  /** "size" for text, "stroke" for box/arrow. */
  mode: "stroke" | "size";
  color: string;
  setColor(color: string): void;
  /** Index into STROKE_WIDTHS or TEXT_SIZES. */
  level: number;
  setLevel(level: number): void;
  /** True while a corner drag is in force, so no preset matches. */
  custom?: boolean;
}

export function resolveControls(
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
          // -1 highlights no preset: a label sized by dragging a corner is not any of
          // them, and lighting one up would claim a size the text does not have.
          level: selected.fontPx === undefined ? selected.size : -1,
          custom: selected.fontPx !== undefined,
          setLevel: (size) => {
            // Clearing `fontPx` is the point, not a detail. It wins over the preset,
            // so writing only `size` left the label untouched: you clicked L and
            // nothing happened.
            onCommitOverlay(selected.id, { size, fontPx: undefined });
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
