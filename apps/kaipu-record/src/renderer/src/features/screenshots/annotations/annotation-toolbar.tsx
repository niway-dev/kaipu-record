import React from "react";
import { ArrowUpRight, MousePointer2, Square, Type } from "lucide-react";
import {
  ANNOTATION_COLORS,
  ANNOTATION_TOOLS,
  STROKE_WIDTHS,
  TEXT_SIZES,
  type AnnotationTool,
} from "./tools";
import type { Annotation } from "./scene";
import type { EditorScene } from "./use-editor-scene";
import type { AnnotationToolsController } from "./use-annotation-tools";
import styles from "./annotation-toolbar.module.css";

const TOOL_META: Record<AnnotationTool, { label: string; Icon: typeof Square }> = {
  select: { label: "Seleccionar", Icon: MousePointer2 },
  box: { label: "Caja", Icon: Square },
  arrow: { label: "Flecha", Icon: ArrowUpRight },
  text: { label: "Texto", Icon: Type },
};

/**
 * The contextual controls (colour + stroke/size) are normalized to one shape so
 * the same UI drives two cases: editing the *selected* annotation, or setting the
 * *next-draw* defaults on the active tool.
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

/** The annotation tool group + the tool's contextual controls (colour/stroke/size). */
export function AnnotationToolbar({
  tools,
  scene,
}: {
  tools: AnnotationToolsController;
  scene: EditorScene;
}): React.JSX.Element {
  const selected = scene.annotations.find((a) => a.id === scene.selectedId) ?? null;

  return (
    <div className={styles.bar}>
      <div className={styles.toolGroup}>
        {ANNOTATION_TOOLS.map((t) => {
          const { label, Icon } = TOOL_META[t];
          return (
            <button
              key={t}
              type="button"
              title={label}
              aria-label={label}
              className={`${styles.tool} ${tools.tool === t ? styles.toolActive : ""}`}
              onClick={() => tools.setTool(t)}
            >
              <Icon size={19} />
            </button>
          );
        })}
      </div>
      <span className={styles.divider} />
      <Contextual tools={tools} scene={scene} selected={selected} />
    </div>
  );
}

function Contextual({
  tools,
  scene,
  selected,
}: {
  tools: AnnotationToolsController;
  scene: EditorScene;
  selected: Annotation | null;
}): React.JSX.Element {
  // Selected annotation → edit it (single undoable change per click).
  if (selected) {
    const controls: ContextualControls =
      selected.kind === "text"
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
    return <ContextualControlsRow controls={controls} />;
  }

  // No selection + the select tool → nothing to edit yet.
  if (tools.tool === "select") {
    return <span className={styles.hint}>Selecciona una anotación para moverla o editarla.</span>;
  }

  // A drawing tool is active → set the defaults for the next shape.
  const controls: ContextualControls =
    tools.tool === "text"
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
  return <ContextualControlsRow controls={controls} />;
}

function ContextualControlsRow({ controls }: { controls: ContextualControls }): React.JSX.Element {
  return (
    <div className={styles.contextual}>
      <span className={styles.ctxLabel}>COLOR</span>
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
      <span className={styles.miniDivider} />
      {controls.mode === "size" ? (
        <>
          <span className={styles.ctxLabel}>TAMAÑO</span>
          <div className={styles.picker}>
            {TEXT_SIZES.map((label, i) => (
              <button
                key={label}
                type="button"
                aria-label={`Tamaño ${label}`}
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
          <span className={styles.ctxLabel}>TRAZO</span>
          <div className={styles.picker}>
            {STROKE_WIDTHS.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Trazo ${i + 1}`}
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
