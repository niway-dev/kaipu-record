import React from "react";
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
}

function resolveControls(
  tools: AnnotationToolsController,
  scene: EditorScene,
  selected: Annotation | null,
): ContextualControls | null {
  // A selected annotation → edit it (single undoable change per click).
  if (selected) {
    return selected.kind === "text"
      ? {
          mode: "size",
          color: selected.color,
          setColor: (color) => scene.commitAnnotation(selected.id, { color }),
          level: selected.size,
          setLevel: (size) => scene.commitAnnotation(selected.id, { size }),
        }
      : {
          mode: "stroke",
          color: selected.color,
          setColor: (color) => scene.commitAnnotation(selected.id, { color }),
          level: selected.stroke,
          setLevel: (stroke) => scene.commitAnnotation(selected.id, { stroke }),
        };
  }
  // Nothing selected + the select tool → nothing to edit, hide the panel.
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
  const selected = scene.annotations.find((a) => a.id === scene.selectedId) ?? null;
  const controls = resolveControls(tools, scene, selected);
  if (!controls) return null;

  return (
    <div className={styles.panel}>
      <span className={styles.label}>Color</span>
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
          <span className={styles.label}>Size</span>
          <div className={styles.picker}>
            {TEXT_SIZES.map((label, i) => (
              <button
                key={label}
                type="button"
                aria-label={`Size ${label}`}
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
          <span className={styles.label}>Stroke</span>
          <div className={styles.picker}>
            {STROKE_WIDTHS.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Stroke ${i + 1}`}
                className={`${styles.pickerItem} ${controls.level === i ? styles.pickerOn : ""}`}
                onClick={() => controls.setLevel(i)}
              >
                <span className={styles.strokeBar} style={{ height: `${(i + 1) * 1.6 + 1}px` }} />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
