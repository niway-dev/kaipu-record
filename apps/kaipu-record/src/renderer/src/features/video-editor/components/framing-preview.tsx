import type { ExportFraming } from "../export/export-presets";
import styles from "./framing-preview.module.css";

export interface FramingPreviewProps {
  /** The output canvas (1080×1920 for Vertical, 1080×1080 for Feeds). */
  canvas: { width: number; height: number };
  /** The recording's own size, for its aspect inside the canvas. */
  source: { width: number; height: number };
  framing: ExportFraming;
  /** A frame of the recording; a neutral stand-in when there is none. */
  thumbnailUrl: string | null;
}

/**
 * What stays inside a Vertical or Feeds canvas (NIW2-218 export redesign): Fill crops the
 * sides, Fit shows the whole frame over the blurred padding the export draws. A still
 * frame — the real Fill also follows the zooms, which the hint under the control says.
 */
export function FramingPreview({
  canvas,
  source,
  framing,
  thumbnailUrl,
}: FramingPreviewProps): React.JSX.Element {
  const sourceAspect =
    source.width > 0 && source.height > 0 ? source.width / source.height : 16 / 9;
  const frame = (className: string): React.JSX.Element =>
    thumbnailUrl ? (
      <img src={thumbnailUrl} alt="" className={className} draggable={false} />
    ) : (
      <span className={`${className} ${styles.placeholder}`} />
    );
  return (
    <div
      className={styles.canvas}
      style={{ aspectRatio: `${canvas.width} / ${canvas.height}` }}
      data-framing={framing}
      data-testid="framing-preview"
      aria-hidden
    >
      {framing === "fit" && frame(styles.blur)}
      <span className={styles.frame} style={{ aspectRatio: String(sourceAspect) }}>
        {frame(styles.image)}
      </span>
    </div>
  );
}
