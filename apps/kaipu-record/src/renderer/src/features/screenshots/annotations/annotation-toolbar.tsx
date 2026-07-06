import React from "react";
import { ArrowUpRight, Crop, Droplet, MousePointer2, Pencil, Square, Type } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { ANNOTATION_TOOLS, type AnnotationTool } from "./tools";
import type { AnnotationToolsController } from "./use-annotation-tools";
import styles from "./annotation-toolbar.module.css";

type ToolLabelKey =
  | "toolSelect"
  | "toolPen"
  | "toolBox"
  | "toolArrow"
  | "toolText"
  | "toolBlur"
  | "toolCrop";

const TOOL_META: Record<AnnotationTool, { labelKey: ToolLabelKey; Icon: typeof Square }> = {
  select: { labelKey: "toolSelect", Icon: MousePointer2 },
  pen: { labelKey: "toolPen", Icon: Pencil },
  box: { labelKey: "toolBox", Icon: Square },
  arrow: { labelKey: "toolArrow", Icon: ArrowUpRight },
  text: { labelKey: "toolText", Icon: Type },
  blur: { labelKey: "toolBlur", Icon: Droplet },
  crop: { labelKey: "toolCrop", Icon: Crop },
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
  const t = useTranslations("screenshots");
  return (
    <div className={styles.toolGroup}>
      {ANNOTATION_TOOLS.map((tool) => {
        const { labelKey, Icon } = TOOL_META[tool];
        const label = t(labelKey);
        return (
          <button
            key={tool}
            type="button"
            title={label}
            aria-label={label}
            className={`${styles.tool} ${tools.tool === tool ? styles.toolActive : ""}`}
            onClick={() => {
              tools.setTool(tool);
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
