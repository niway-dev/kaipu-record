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
import { useEffect, useRef, useState } from "react";
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
  /** The pointer that owns the drag: any other pointer is ignored until it ends. */
  pointerId: number;
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

/** Which items are drawn and at what opacity: two frames with the same key look the same. */
function drawKey(list: VisibleMedia[]): string {
  return list.map((v) => `${v.item.id}:${v.opacity.toFixed(3)}`).join("|");
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
  playing = false,
  readTime,
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
  /** Timeline seconds under the playhead, as the page state has it: exact when paused or
   *  scrubbing, but sparse while playing (a few `timeupdate`s a second). */
  time: number;
  /** While true the layer reads `readTime` every frame instead, so a 200 ms fade is a ramp and
   *  an image appears on its frame, like the export, which samples at frame timestamps. */
  playing?: boolean;
  /** The clock the moving playhead reads (`playback.readTimelineTime`). */
  readTime?: () => number;
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
  // The time the frame is drawn at while playing: sampled per animation frame, and committed to
  // state only when what is drawn changed, so a still stretch costs no re-render.
  const [liveTime, setLiveTime] = useState<number | null>(null);
  const latestDraw = useRef({ media, layout, selectedId });
  latestDraw.current = { media, layout, selectedId };
  const shownKey = useRef("");
  useEffect(() => {
    if (!playing || !readTime) {
      setLiveTime(null);
      return;
    }
    let raf = 0;
    const tick = (): void => {
      const now = readTime();
      const d = latestDraw.current;
      const key = drawKey(drawList(d.media, d.layout, now, d.selectedId));
      if (key !== shownKey.current) {
        shownKey.current = key;
        setLiveTime(now);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, readTime]);
  const list = drawList(media, layout, playing && liveTime !== null ? liveTime : time, selectedId);
  shownKey.current = drawKey(list);
  const selected = list.find((v) => v.item.id === selectedId)?.item ?? null;

  // The latest `onEnd`, for the unmount cleanup below (it must not re-run on a re-render).
  const latestEnd = useRef(onEnd);
  latestEnd.current = onEnd;

  // A captured pointer is not released by its element going away (the playhead moved off the
  // image, the item was deleted, the layer unmounted mid-drag), so `finish` never runs: end the
  // interaction by hand, or every later commit, undo and redo is ignored.
  useEffect(
    () => () => {
      const d = drag.current;
      drag.current = null;
      if (d?.began) latestEnd.current();
    },
    [],
  );

  const finish = (): void => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (d.began) onEnd();
  };

  // The dragged image or its handle is gone while the layer stays (the playhead left its span,
  // it was deleted, a drawing tool was armed mid-drag): the element took the pointer capture
  // with it, so end the drag here.
  const dragging = drag.current;
  const draggedStillDrawn =
    dragging === null ||
    (interactive &&
      list.some((v) => v.item.id === dragging.id) &&
      // A corner handle exists only while its item is the selection (Escape clears that).
      (dragging.mode === "move" || selectedId === dragging.id));
  useEffect(() => {
    if (!draggedStillDrawn) finish();
    // `finish` only reads refs and the latest `onEnd` through the render that scheduled it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggedStillDrawn]);

  const press = (
    event: React.PointerEvent<HTMLElement>,
    mode: DragMode,
    item: ImageMediaItem,
  ): void => {
    // Left button only: a context click must not arm a drag whose pointerup may never arrive.
    if (event.button !== 0) return;
    event.stopPropagation();
    // A second finger must not replace a live drag: the first would lose its `onEnd`.
    if (drag.current) return;
    if (mode === "move" && item.id !== selectedId) onSelect(item.id);
    const slot = slotRef.current?.getBoundingClientRect();
    if (!slot || slot.width === 0 || slot.height === 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = {
      mode,
      id: item.id,
      pointerId: event.pointerId,
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
    if (!d || d.pointerId !== event.pointerId) return;
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

  // Cancel and lost capture arrive per pointer: only the owner's ends the drag.
  const abort = (event: React.PointerEvent<HTMLElement>): void => {
    if (drag.current?.pointerId === event.pointerId) finish();
  };

  const release = (event: React.PointerEvent<HTMLElement>): void => {
    if (drag.current?.pointerId !== event.pointerId) return;
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
            onClick={(event) => {
              event.stopPropagation();
              // A press already selected it; a click with no press (assistive technology) did not.
              if (item.id !== selectedId) onSelect(item.id);
            }}
            onPointerDown={(event) => press(event, "move", item)}
            onPointerMove={move}
            onPointerUp={release}
            onPointerCancel={abort}
            onLostPointerCapture={abort}
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
          {/* While a drawing tool is armed the handles are gone too: they take pointers, and a
              stroke that starts over one must reach the layer below. */}
          {(interactive ? CORNERS : []).map((corner) => (
            <span
              key={corner}
              className={styles.handle}
              data-corner={corner}
              data-testid={`media-handle-${corner}`}
              aria-label={t("mediaResizeHandleAria")}
              onPointerDown={(event) => press(event, corner, selected)}
              onPointerMove={move}
              onPointerUp={release}
              onPointerCancel={abort}
              onLostPointerCapture={abort}
            />
          ))}
        </div>
      )}
    </div>
  );
}
