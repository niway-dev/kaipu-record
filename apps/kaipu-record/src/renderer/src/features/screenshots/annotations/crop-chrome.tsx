import React from "react";
import { uiArea } from "@renderer/lib/ui-area";
import { CROP_HANDLES } from "./image-crop";
import { handleCursor, type HandleId, type Size } from "./handles";
import type { NormalizedRect } from "./scene";
import styles from "./crop-chrome.module.css";

const CORNERS: ReadonlySet<HandleId> = new Set(["nw", "ne", "se", "sw"]);

/**
 * What crop mode wears over the window (NIW2-876), drawn so it cannot be mistaken for a
 * selection: thick accent-pink L brackets at the corners, short bars at the middle of each edge
 * and a rule-of-thirds grid inside. A selected image keeps its thin accent frame and small square
 * handles; only cropping gets these.
 *
 * It is HTML over the layer, not SVG in it, so the brackets stay one size on screen at any zoom
 * (`--canvas-zoom`, as the handles and the size tag do). It takes no pointer input of its own:
 * the layer hit-tests the window's handles geometrically. Each handle only carries the resize
 * cursor, with a larger invisible target around it, and lets the press bubble to the layer.
 */
export function CropChrome({ win, size }: { win: NormalizedRect; size: Size }): React.JSX.Element {
  return (
    <div
      className={styles.window}
      data-testid="crop-chrome"
      style={{
        left: win.x * size.w,
        top: win.y * size.h,
        width: win.w * size.w,
        height: win.h * size.h,
      }}
      {...uiArea("editorImage.imageCropMode")}
    >
      <div className={styles.grid} aria-hidden>
        {[1, 2].map((i) => (
          <div
            key={`v${i}`}
            className={`${styles.line} ${styles.lineV}`}
            data-testid="crop-grid-line"
            style={{ left: `${(i * 100) / 3}%` }}
          />
        ))}
        {[1, 2].map((i) => (
          <div
            key={`h${i}`}
            className={`${styles.line} ${styles.lineH}`}
            data-testid="crop-grid-line"
            style={{ top: `${(i * 100) / 3}%` }}
          />
        ))}
      </div>
      {CROP_HANDLES.map((h) => (
        <div
          key={h}
          className={`${styles.handle} ${CORNERS.has(h) ? styles.corner : styles.edge} ${styles[h]}`}
          data-testid="crop-handle"
          data-handle={h}
          data-kind={CORNERS.has(h) ? "corner" : "edge"}
          style={{ cursor: handleCursor(h) }}
        />
      ))}
    </div>
  );
}
