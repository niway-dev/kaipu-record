import React from "react";
import { ArrowUpRight, Droplet, MousePointer2, Pencil, Square, Type } from "lucide-react";
import { ANNOTATION_TOOLS, type AnnotationTool } from "./tools";
import type { AnnotationToolsController } from "./use-annotation-tools";
import styles from "./annotation-toolbar.module.css";

const TOOL_META: Record<AnnotationTool, { label: string; Icon: typeof Square }> = {
  select: { label: "Select", Icon: MousePointer2 },
  pen: { label: "Pen", Icon: Pencil },
  box: { label: "Box", Icon: Square },
  arrow: { label: "Arrow", Icon: ArrowUpRight },
  text: { label: "Text", Icon: Type },
  blur: { label: "Blur", Icon: Droplet },
};

/**
 * Just the tool group (select / box / arrow / text). The per-tool controls
 * (colour, stroke, size) live in the floating `AnnotationOptions` panel over the
 * canvas — Excalidraw-style — so the top bar stays compact.
 */
export function AnnotationToolbar({
  tools,
  onPick,
}: {
  tools: AnnotationToolsController;
  /** Fired when the user manually picks a tool — used to deselect the current shape
   *  so the freshly-picked tool starts clean (auto-select otherwise leaves one selected). */
  onPick?: () => void;
}): React.JSX.Element {
  return (
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
            onClick={() => {
              tools.setTool(t);
              onPick?.();
            }}
          >
            <Icon size={19} />
          </button>
        );
      })}
    </div>
  );
}
