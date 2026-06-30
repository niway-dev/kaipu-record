import React from "react";
import { ArrowUpRight, MousePointer2, Square, Type } from "lucide-react";
import {
  ANNOTATION_COLORS,
  ANNOTATION_TOOLS,
  STROKE_WIDTHS,
  TEXT_SIZES,
  type AnnotationTool,
} from "./tools";
import type { AnnotationToolsController } from "./use-annotation-tools";
import styles from "./annotation-toolbar.module.css";

const TOOL_META: Record<AnnotationTool, { label: string; Icon: typeof Square }> = {
  select: { label: "Seleccionar", Icon: MousePointer2 },
  box: { label: "Caja", Icon: Square },
  arrow: { label: "Flecha", Icon: ArrowUpRight },
  text: { label: "Texto", Icon: Type },
};

/** The annotation tool group + the tool's contextual controls (colour/stroke/size). */
export function AnnotationToolbar({
  tools,
}: {
  tools: AnnotationToolsController;
}): React.JSX.Element {
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
      <Contextual tools={tools} />
    </div>
  );
}

function Contextual({ tools }: { tools: AnnotationToolsController }): React.JSX.Element {
  if (tools.tool === "select") {
    return <span className={styles.hint}>Selecciona una anotación para moverla o editarla.</span>;
  }
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
            className={`${styles.swatch} ${tools.color === c.value ? styles.swatchOn : ""}`}
            style={{ background: c.value }}
            onClick={() => tools.setColor(c.value)}
          />
        ))}
      </div>
      <span className={styles.miniDivider} />
      {tools.tool === "text" ? (
        <>
          <span className={styles.ctxLabel}>TAMAÑO</span>
          <div className={styles.picker}>
            {TEXT_SIZES.map((label, i) => (
              <button
                key={label}
                type="button"
                aria-label={`Tamaño ${label}`}
                className={`${styles.pickerItem} ${styles.sizeItem} ${tools.textSize === i ? styles.pickerOn : ""}`}
                onClick={() => tools.setTextSize(i)}
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
                className={`${styles.pickerItem} ${tools.stroke === i ? styles.pickerOn : ""}`}
                onClick={() => tools.setStroke(i)}
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
