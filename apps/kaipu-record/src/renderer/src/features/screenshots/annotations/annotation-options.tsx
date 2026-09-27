import React from "react";
import { Trash2 } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { ANNOTATION_COLORS, STROKE_WIDTHS, TEXT_SIZES } from "./tools";
import type { Annotation } from "./scene";
import type { EditorScene } from "./use-editor-scene";
import type { AnnotationToolsController } from "./use-annotation-tools";
import styles from "./annotation-options.module.css";

/**
 * Normalized contextual controls, so one panel drives two cases: editing the
 * *selected* annotation, or setting the *next-draw* defaults on the active tool.
 */
interface ContextualControls {
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

function resolveControls(
  tools: AnnotationToolsController,
  scene: EditorScene,
  selected: Annotation | null,
): ContextualControls | null {
  // A selected annotation → edit it (single undoable change per click). A blur box
  // has no colour/stroke, so there's nothing to edit. Picking a value also updates
  // the *current* tool default, so the choice "sticks" for the next annotation too
  // (change colour on a selection → keep drawing in that colour, across tools).
  if (selected) {
    if (selected.kind === "blur") return null;
    return selected.kind === "text"
      ? {
          mode: "size",
          color: selected.color,
          setColor: (color) => {
            scene.commitAnnotation(selected.id, { color });
            tools.setColor(color);
          },
          // -1 highlights no preset: a label sized by dragging a corner is not any of
          // them, and lighting one up would claim a size the text does not have.
          level: selected.fontPx === undefined ? selected.size : -1,
          custom: selected.fontPx !== undefined,
          setLevel: (size) => {
            // Clearing `fontPx` is the point, not tidy-up: it wins over the preset, so
            // writing only `size` lit the control while the label stayed put.
            scene.commitAnnotation(selected.id, { size, fontPx: undefined });
            tools.setTextSize(size);
          },
        }
      : {
          mode: "stroke",
          color: selected.color,
          setColor: (color) => {
            scene.commitAnnotation(selected.id, { color });
            tools.setColor(color);
          },
          level: selected.stroke,
          setLevel: (stroke) => {
            scene.commitAnnotation(selected.id, { stroke });
            tools.setStroke(stroke);
          },
        };
  }
  // Nothing selected + select/blur/crop tool → nothing to set for colour/stroke.
  if (tools.tool === "select" || tools.tool === "blur" || tools.tool === "crop") return null;
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

/**
 * Floating options panel over the canvas (Excalidraw-style). Renders `null` when
 * there's nothing to edit (select tool, no selection) so the canvas stays clean.
 */
export function AnnotationOptions({
  tools,
  scene,
}: {
  tools: AnnotationToolsController;
  scene: EditorScene;
}): React.JSX.Element | null {
  const t = useTranslations("screenshots");
  const selected = scene.annotations.find((a) => a.id === scene.selectedId) ?? null;
  const controls = resolveControls(tools, scene, selected);
  const isCrop = tools.tool === "crop";
  // A selected blur has no colour/stroke controls, but should still be deletable —
  // so the panel shows whenever there are controls OR something is selected OR crop is active.
  if (!controls && !selected && !isCrop) return null;

  return (
    <div className={styles.panel}>
      {isCrop && (
        <>
          <span className={styles.label}>{t("cropLabel")}</span>
          <button
            type="button"
            title={t("cropResetTitle")}
            className={styles.reset}
            disabled={!scene.crop}
            onClick={() => scene.setCrop(undefined)}
          >
            {t("reset")}
          </button>
        </>
      )}

      {controls && (
        <>
          <span className={styles.label}>{t("colorLabel")}</span>
          <div className={styles.palette}>
            {ANNOTATION_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                title={t(c.nameKey)}
                aria-label={t(c.nameKey)}
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
                {/* Only while a corner drag is in force; a permanent chip nobody can
                    press would be a dead control. */}
                {controls.custom ? (
                  <button
                    type="button"
                    aria-label={t("sizeCustomAria")}
                    className={`${styles.pickerItem} ${styles.sizeItem} ${styles.pickerOn}`}
                    disabled
                  >
                    {t("sizeCustom")}
                  </button>
                ) : null}
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
                    <span
                      className={styles.strokeBar}
                      style={{ height: `${(i + 1) * 1.6 + 1}px` }}
                    />
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {selected && (
        <button
          type="button"
          aria-label={t("deleteAria")}
          title={t("deleteTitle")}
          className={styles.delete}
          onClick={() => scene.removeSelected()}
        >
          <Trash2 size={16} />
        </button>
      )}
    </div>
  );
}
