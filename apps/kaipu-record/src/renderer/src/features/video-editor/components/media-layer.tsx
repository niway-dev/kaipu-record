/**
 * Floating images in the preview (ADR 0057, NIW2-771), drawn in PreviewStage's `media` slot:
 * above the footage and below the webcam, and like the webcam never transformed by the camera
 * path, so a zoom does not move or crop an image.
 *
 * What is drawn comes ONLY from `mediaAt` (which items, back to front, with which opacity) and
 * `mediaBoxPx` (where), the very functions the export draws with, so the preview cannot show
 * what the export does not. `picture` is the picture's pixel size (the decoded frame): only its
 * aspect matters, because the box is stored as shares of the picture.
 *
 * The SELECTED item stays grabbable while the playhead is inside its span even when its fade has
 * it at opacity 0 (it is then drawn at 0 and still takes the pointer). It shows an outline with
 * four corner handles; dragging the body moves it, dragging a corner resizes it with the aspect
 * locked (media-box-drag.ts). A drag is one undo step: `onBegin` on the first movement,
 * `onBoxChange` live, `onEnd` on release, abort included (the same contract as the webcam layer).
 */
import { useRef } from "react";
import { useTranslations } from "@kaipu/i18n";
import { uiArea } from "@renderer/lib/ui-area";
import { mediaAt, mediaBoxPx, placeMedia, type PictureSize, type VisibleMedia } from "../media";
import { CORNERS, dragBoxBody, dragBoxCorner, type Corner } from "../media-box-drag";
import type { ImageMediaItem, MediaBox } from "../scene";
import type { LayoutEntry } from "../timeline";
import styles from "./media-layer.module.css";

/** Pointer travel, in client px, before a press becomes a drag (a click only selects). */
const DRAG_THRESHOLD = 2;

type DragMode = "move" | Corner;

interface Drag {
  mode: DragMode;
  id: string;
  /** The item as it was when the press landed: every delta is applied to this. */
  start: ImageMediaItem;
  x: number;
  y: number;
  width: number;
  height: number;
  began: boolean;
}

/** What to draw: `mediaAt`, plus the selected item at opacity 0 while the playhead is in its span. */
function drawList(
  media: ImageMediaItem[] | undefined,
  layout: LayoutEntry[],
  time: number,
  selectedId: string | null,
): VisibleMedia[] {
  const visible = mediaAt({ media }, layout, time);
  if (!selectedId || visible.some((v) => v.item.id === selectedId)) return visible;
  const placed = placeMedia(media, layout).find((p) => p.item.id === selectedId);
  if (!placed || time < placed.start || time >= placed.end) return visible;
  return [...visible, { item: placed.item, opacity: 0 }].sort((a, b) => a.item.z - b.item.z);
}

function percentStyle(item: ImageMediaItem, picture: PictureSize): React.CSSProperties {
  const rect = mediaBoxPx(item, picture);
  return {
    left: `${(rect.x / picture.width) * 100}%`,
    top: `${(rect.y / picture.height) * 100}%`,
    width: `${(rect.width / picture.width) * 100}%`,
    height: `${(rect.height / picture.height) * 100}%`,
  };
}

export function MediaLayer({
  media,
  layout,
  time,
  picture,
  selectedId,
  interactive,
  imageUrl,
  onSelect,
  onBegin,
  onBoxChange,
  onEnd,
}: {
  media: ImageMediaItem[] | undefined;
  layout: LayoutEntry[];
  /** Timeline seconds under the playhead. */
  time: number;
  picture: PictureSize;
  selectedId: string | null;
  /** False while a drawing tool is armed, so a stroke can start over an image. */
  interactive: boolean;
  /** Object URL of an item's image; null while it is not loaded. */
  imageUrl(assetId: string): string | null;
  onSelect(id: string): void;
  onBegin(): void;
  onBoxChange(id: string, box: MediaBox): void;
  onEnd(): void;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const slotRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const list = drawList(media, layout, time, selectedId);
  const selected = list.find((v) => v.item.id === selectedId)?.item ?? null;

  const finish = (): void => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (d.began) onEnd();
  };

  const press = (
    event: React.PointerEvent<HTMLElement>,
    mode: DragMode,
    item: ImageMediaItem,
  ): void => {
    event.stopPropagation();
    if (mode === "move" && item.id !== selectedId) onSelect(item.id);
    const slot = slotRef.current?.getBoundingClientRect();
    if (!slot || slot.width === 0 || slot.height === 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = {
      mode,
      id: item.id,
      start: item,
      x: event.clientX,
      y: event.clientY,
      width: slot.width,
      height: slot.height,
      began: false,
    };
  };

  const move = (event: React.PointerEvent<HTMLElement>): void => {
    const d = drag.current;
    if (!d) return;
    const dx = event.clientX - d.x;
    const dy = event.clientY - d.y;
    if (!d.began) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      d.began = true;
      onBegin();
    }
    // Client px to picture px: the slot fills the picture, whatever size it is drawn at.
    const deltaX = (dx / d.width) * picture.width;
    const deltaY = (dy / d.height) * picture.height;
    onBoxChange(
      d.id,
      d.mode === "move"
        ? dragBoxBody(d.start.box, deltaX, deltaY, picture)
        : dragBoxCorner(d.start, d.mode, deltaX, deltaY, picture),
    );
  };

  const release = (event: React.PointerEvent<HTMLElement>): void => {
    if (!drag.current) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    finish();
  };

  return (
    <div
      {...uiArea("editorVideo.mediaLayer")}
      ref={slotRef}
      className={styles.slot}
      data-testid="media-layer"
    >
      {list.map(({ item, opacity }) => {
        const url = imageUrl(item.assetId);
        return (
          <div
            key={item.id}
            className={styles.item}
            style={percentStyle(item, picture)}
            data-testid="media-item"
            data-media-id={item.id}
            data-selected={String(item.id === selectedId)}
            data-interactive={String(interactive)}
            role="button"
            tabIndex={interactive ? 0 : -1}
            aria-label={t("mediaItemAria")}
            aria-pressed={item.id === selectedId}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              event.stopPropagation();
              onSelect(item.id);
            }}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => press(event, "move", item)}
            onPointerMove={move}
            onPointerUp={release}
            onPointerCancel={finish}
            onLostPointerCapture={finish}
          >
            {url && (
              <img
                className={styles.image}
                src={url}
                alt=""
                draggable={false}
                style={{ opacity }}
              />
            )}
          </div>
        );
      })}
      {selected && (
        <div
          className={styles.selection}
          style={percentStyle(selected, picture)}
          data-testid="media-selection"
        >
          {CORNERS.map((corner) => (
            <span
              key={corner}
              className={styles.handle}
              data-corner={corner}
              data-testid={`media-handle-${corner}`}
              aria-label={t("mediaResizeHandleAria")}
              onPointerDown={(event) => press(event, corner, selected)}
              onPointerMove={move}
              onPointerUp={release}
              onPointerCancel={finish}
              onLostPointerCapture={finish}
            />
          ))}
        </div>
      )}
    </div>
  );
}
