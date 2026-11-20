import React, { useEffect, useRef, useState } from "react";
import { uiArea } from "@renderer/lib/ui-area";
import { ImageActions, type ImageActionsProps } from "./image-actions";
import type { LayerRect } from "./image-selection";
import styles from "./image-action-bar.module.css";

/** The bar's height on screen plus its 8 px gap to the image, in screen px. */
const BAR_HEIGHT_PX = 34;
const BAR_GAP_PX = 8;

/** The canvas area that clips the stage: the bar must stay inside it. */
const STAGE_SELECTOR = '[data-ui-area="editorImage.canvas"]';

/**
 * The floating action bar of a selected image (NIW2-876): Crop, Corners and Reset, centred
 * above the image at a fixed size on screen (the layer is scaled by the canvas zoom, so the
 * bar undoes it through `--canvas-zoom`, like the handles and the size tag).
 *
 * It sits above the image. With no room above (the image touches or leaves the top of the
 * stage) it moves inside the image's top edge instead, so the stage never clips it. Which of
 * the two is decided by the browser, not by arithmetic: an `IntersectionObserver` watches an
 * invisible probe where the bar would be above the image, so pan and zoom, which never
 * re-render this layer, still move the bar to the right side.
 *
 * Presses and double-clicks on the bar stop here: the layer under it would otherwise read
 * them as a click on the stage (a deselect, or the Export frame's double-click).
 */
export function ImageActionBar({
  rect,
  actions,
}: {
  rect: LayerRect;
  actions: Omit<ImageActionsProps, "variant">;
}): React.JSX.Element {
  const probeRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<"above" | "inside">("above");

  useEffect(() => {
    const probe = probeRef.current;
    if (!probe || typeof IntersectionObserver === "undefined") return;
    const root = probe.closest(STAGE_SELECTOR);
    const observer = new IntersectionObserver(
      (entries) => {
        const last = entries[entries.length - 1];
        if (last) setPlacement(last.intersectionRatio >= 0.99 ? "above" : "inside");
      },
      { root, threshold: [0, 0.5, 0.99, 1] },
    );
    observer.observe(probe);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className={styles.anchor}
      style={{ left: rect.x + rect.w / 2, top: rect.y }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div
        ref={probeRef}
        className={styles.probe}
        style={{ height: BAR_HEIGHT_PX, bottom: BAR_GAP_PX }}
        aria-hidden
      />
      <div
        className={styles.bar}
        data-testid="image-action-bar"
        data-placement={placement}
        style={placement === "above" ? { bottom: BAR_GAP_PX } : { top: BAR_GAP_PX }}
        {...uiArea("editorImage.imageActionBar")}
      >
        <ImageActions variant="bar" {...actions} />
      </div>
    </div>
  );
}
