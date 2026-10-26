import type { CaptureRect } from "@shared/types/screenshot-capture";
import styles from "./recording-shade.module.css";

/** `rect=x,y,w,h` (display-relative DIP) from the window's query; null when unusable. */
export function parseShadeRect(search: string): CaptureRect | null {
  const value = new URLSearchParams(search).get("rect");
  if (!value) return null;
  const parts = value.split(",").map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return null;
  const [x, y, width, height] = parts as [number, number, number, number];
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

/**
 * The shade over the recorded display while an area records (`?window=recording-shade`):
 * the area is clear with a thin accent outline, everything around it is dimmed by the
 * box's spread shadow (the Frame box's technique). Main makes the window click-through and
 * content-protected, so this paints and does nothing else.
 */
export function RecordingShade({ rect }: { rect: CaptureRect }): React.JSX.Element {
  return (
    <div
      className={styles.area}
      data-testid="recording-shade-area"
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
    />
  );
}
