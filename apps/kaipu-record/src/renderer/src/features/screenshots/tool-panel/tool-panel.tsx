import React from "react";
import { useTranslations } from "@kaipu/i18n";
import { uiArea } from "@renderer/lib/ui-area";
import {
  AnnotationOptions,
  annotationOptionsState,
  type AnnotationOptionsState,
  type AnnotationToolsController,
  type EditorScene,
} from "../annotations";
import { ExportFrameCard } from "../canvas/export-frame-card";
import { InspectBar, type InspectController } from "../inspect";
import type { ColorsController } from "../inspect/colors/use-colors";
import type { TextToolStatus } from "../text-selection";
import styles from "./tool-panel.module.css";

/** What the Tool tab is showing: its `data-state`, and the ui-map's `toolPanel` states. */
export type ToolPanelState = AnnotationOptionsState | "empty" | "inspect";

/**
 * The Tool tab of the side panel (NIW2-723): the active tool's options, wherever they used to
 * live. Like the video editor's inspector, what the panel shows follows the active tool and the
 * selection, and with nothing to show it says how to get something to show.
 *
 *   Inspect on          the Inspect controls (rulers, format, tolerance, copy, Colors)
 *   Export frame        what the frame is for, Fit to content, Remove
 *   any other tool or a selected annotation      colour, stroke or size, Redact style, delete, ...
 *   Select, nothing selected    "No tool selected"
 *   a tool without options      "This tool has no options"
 *
 * It only places the controls: every one is the same component, with the same state, it was
 * when it floated over the stage or sat in the toolbar.
 */
export function ToolPanel({
  tools,
  scene,
  canvasMode = false,
  textTool,
  inspect,
  colors,
  exportFrame,
}: {
  tools: AnnotationToolsController;
  /** The scene the options edit; in canvas mode the one whose `crop` is the export frame. */
  scene: EditorScene;
  /** `image-canvas`: Redact's Blur / Solid, and the Export frame tool's card. */
  canvasMode?: boolean;
  /** The "Select text" tool's recognition status and actions (`image-text`); absent = flag off. */
  textTool?: TextToolStatus;
  /** The Inspect controller while Inspect is on; null or absent otherwise. */
  inspect?: InspectController | null;
  colors?: ColorsController;
  /** The export frame card's data, in canvas mode (`image-canvas`). */
  exportFrame?: { hasFrame: boolean; onFit(): void; onRemove(): void };
}): React.JSX.Element {
  const t = useTranslations("screenshots");
  const frameCard = !inspect && canvasMode && tools.tool === "crop" && exportFrame !== undefined;
  const options = inspect ? null : annotationOptionsState(tools, scene, canvasMode, textTool);
  const state: ToolPanelState = inspect ? "inspect" : frameCard ? "crop" : (options ?? "empty");

  return (
    <div {...uiArea("editorImage.toolPanel")} className={styles.panel} data-state={state}>
      {inspect ? (
        <InspectBar inspect={inspect} {...(colors ? { colors } : {})} />
      ) : (
        <>
          {frameCard && exportFrame && (
            <ExportFrameCard
              hasFrame={exportFrame.hasFrame}
              onFit={exportFrame.onFit}
              onRemove={exportFrame.onRemove}
              onDone={() => tools.setTool("select")}
            />
          )}
          <AnnotationOptions
            tools={tools}
            scene={scene}
            canvasMode={canvasMode}
            {...(textTool ? { textTool } : {})}
          />
          {state === "empty" && (
            <div className={styles.empty} data-testid="tool-panel-empty">
              <p className={styles.emptyTitle}>
                {t(tools.tool === "select" ? "toolPanelEmptyTitle" : "toolPanelNoOptionsTitle")}
              </p>
              <p className={styles.emptyBody}>
                {t(tools.tool === "select" ? "toolPanelEmptyBody" : "toolPanelNoOptionsBody")}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
