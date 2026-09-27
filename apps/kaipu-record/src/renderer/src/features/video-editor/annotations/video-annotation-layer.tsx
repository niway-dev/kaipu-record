/**
 * Interactive annotation overlay drawn over the video preview — the video-editor
 * sibling of the screenshot editor's AnnotationLayer (see
 * screenshots/annotations/annotation-layer.tsx). Ports its pointer-event state
 * machine, hit-testing, draft->commit flow, inline text input (armed-rAF blur
 * trick) and resize handles, reduced to this feature's tools: select/box/arrow/text
 * (no pen/blur/crop).
 *
 * Coordinate space: this component is rendered as a sibling of the <video> element
 * inside PreviewStage's content layer (see preview-stage.tsx) and fills it
 * (inset: 0), measuring itself via ResizeObserver — same pattern as the screenshot
 * layer. That layer is sized from the decoded frame's aspect ratio, so it IS the
 * video's displayed box with no letterbox to account for, and overlay geometry is
 * normalized 0-1 of it (see scene.ts).
 *
 * Since video-editor v2 the content layer also carries the camera transform. Nothing
 * here changes: `toNorm` normalizes against this element's own
 * getBoundingClientRect(), which is the TRANSFORMED rect, so a point under the
 * pointer still maps to the right place in the original frame while zoomed. `size`
 * comes from clientWidth/clientHeight (untransformed), and is used only for handle
 * geometry and hit tolerance — those stay constant in normalized units and simply
 * read bigger on screen as the camera zooms in.
 *
 * Deviation from the screenshot layer (see plan brief): a draw gesture's live draft
 * is kept in local component state only (never routed through onDraft/onInteractStart)
 * and finalized with a single onCommit call. Routing draws through
 * onInteractStart/onDraft/onInteractEnd like moves/resizes would require a second
 * onCommit afterward to swap the draft's placeholder id for a real one (onInteractEnd
 * alone can't change the committed data) — that second commit would push an extra,
 * visually-identical undo step (undoing once would look like nothing happened). Moves
 * and resizes DON'T have this problem: the last live update already holds the correct
 * final geometry under the overlay's real, unchanged id, so onInteractEnd alone
 * finalizes them as one undo step. This mirrors what the screenshot layer already
 * does: scene.beginInteract() is called for move/resize, never for draw-box/draw-arrow.
 */

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import {
  HAND_FONT,
  TEXT_PX,
  TEXT_LINE_HEIGHT,
  handlesFor,
  hitHandle,
  resizeAnnotation,
  type HandleId,
} from "@renderer/features/screenshots/annotations";
import { newId, type VideoOverlay } from "../scene";
import { DEFAULT_OVERLAY_SECONDS, type VideoTool } from "./video-tools";
import { OverlayHandles, OverlayShape, type Size } from "./overlay-shapes";
import styles from "./video-annotation-layer.module.css";

interface Pt {
  x: number;
  y: number;
}

type Drag =
  | {
      mode: "draw-box" | "draw-arrow";
      start: Pt;
      seed: number;
      window: { start: number; end: number };
    }
  | { mode: "move"; id: string; start: Pt; orig: VideoOverlay }
  | { mode: "resize"; id: string; handle: HandleId; orig: VideoOverlay };

/** Click tolerance around a resize handle, in px (see HANDLE_PX in overlay-shapes.tsx
 *  for the smaller VISUAL handle size). */
const HANDLE_HIT_PX = 12;

/** Movement tolerance (px) for telling a plain click on empty space apart from a
 *  drag that merely didn't land on a shape (e.g. an aborted rubber-band-like drag).
 *  Only a click within this tolerance forwards to onBackgroundClick. */
const CLICK_MOVE_TOL_PX = 4;

export interface VideoAnnotationLayerProps {
  overlays: VideoOverlay[];
  /** Overlay ids whose visibility window currently contains the playhead. */
  visibleIds: Set<string>;
  selectedId: string | null;
  onSelect(id: string | null): void;
  tool: VideoTool;
  toolState: { color: string; stroke: number; textSize: number };
  /** Current playhead position (timeline seconds) — a new overlay's window starts here. */
  playheadTime: number;
  timelineDuration: number;
  /** Live geometry update while dragging an EXISTING overlay (move/resize). */
  onDraft(overlay: VideoOverlay): void;
  /** Final overlays array for a finished draw/text commit, or a move/resize end. */
  onCommit(overlays: VideoOverlay[]): void;
  onInteractStart(): void;
  onInteractEnd(): void;
  /** Fired when the SELECT tool is active and a plain click (no drag) lands on empty
   *  space — no shape and no resize handle hit. Lets the video underneath still
   *  toggle play/pause even though this layer sits on top of it and swallows the
   *  click (see preview-stage.tsx: the layer is a full-cover sibling of <video>). */
  onBackgroundClick?(): void;
}

/** The visibility window for a freshly created overlay — clamped so a 0-length
 *  window never lands exactly on (or past) the timeline's end. */
function overlayWindow(playheadTime: number, duration: number): { start: number; end: number } {
  const start = Math.max(0, Math.min(playheadTime, Math.max(0, duration - 0.1)));
  const end = Math.min(start + DEFAULT_OVERLAY_SECONDS, duration);
  return { start, end };
}

export function VideoAnnotationLayer({
  overlays,
  visibleIds,
  selectedId,
  onSelect,
  tool,
  toolState,
  playheadTime,
  timelineDuration,
  onDraft,
  onCommit,
  onInteractStart,
  onInteractEnd,
  onBackgroundClick,
}: VideoAnnotationLayerProps): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [draft, setDraft] = useState<VideoOverlay | null>(null);
  // `id` present means we are re-editing an existing label rather than placing a new
  // one; `initialText` prefills the box. A label used to be write-once, so fixing a
  // typo meant deleting the overlay and losing its timeline window.
  const [editingText, setEditingText] = useState<{
    x: number;
    y: number;
    id?: string;
    initialText?: string;
  } | null>(null);
  const drag = useRef<Drag | null>(null);
  // Armed on a select-tool pointerdown that hit neither a handle nor a shape; cleared
  // the moment the pointer moves past CLICK_MOVE_TOL_PX so a drag from empty space
  // (which does nothing here, but still isn't a "click") never fires onBackgroundClick.
  const clickCandidate = useRef<Pt | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  // Same arming trick as the screenshot layer: blur-to-commit only fires once the
  // input has settled, so the click that opened it can't immediately cancel it.
  const textArmed = useRef(false);
  // Set once a text edit is resolved (commit or cancel) so a trailing unmount-blur
  // can't re-commit (duplicate label after Enter, or save a cancelled one after Escape).
  const editDone = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => setSize({ w: el.clientWidth, h: el.clientHeight });
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    measure();
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!editingText) {
      textArmed.current = false;
      return;
    }
    textInputRef.current?.focus();
    const raf = requestAnimationFrame(() => {
      textArmed.current = true;
    });
    return () => cancelAnimationFrame(raf);
  }, [editingText]);

  const toNorm = (e: { clientX: number; clientY: number }): Pt => {
    const r = ref.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  // Double-clicking a label reopens it in place, the same gesture the screenshot
  // editor uses. Select tool only, so it never collides with a drawing tool's click.
  const onDoubleClick = (e: React.MouseEvent): void => {
    if (tool !== "select") return;
    const candidates = overlays.filter((o) => visibleIds.has(o.id) || o.id === selectedId);
    const hit = hitTest(candidates, toNorm(e), size);
    if (hit?.kind !== "text") return;
    onSelect(hit.id);
    editDone.current = false;
    setEditingText({ x: hit.x, y: hit.y, id: hit.id, initialText: hit.text });
  };

  const onPointerDown = (e: React.PointerEvent): void => {
    const p = toNorm(e);
    if (tool === "select") {
      // A selected overlay's resize handles take priority over the shape hit-test —
      // grabbing a corner resizes instead of moving.
      const sel = selectedId ? (overlays.find((o) => o.id === selectedId) ?? null) : null;
      if (sel) {
        const tol = { x: HANDLE_HIT_PX / (size.w || 1), y: HANDLE_HIT_PX / (size.h || 1) };
        const handle = hitHandle(handlesFor(sel, size), p, tol);
        if (handle) {
          onInteractStart();
          drag.current = { mode: "resize", id: sel.id, handle, orig: sel };
          // Optional call (not just optional access): jsdom has no
          // setPointerCapture implementation at all, so tests would throw
          // without this — real Electron/Chromium always has it.
          ref.current?.setPointerCapture?.(e.pointerId);
          return;
        }
      }
      // Only hit-test what's actually rendered: overlays inside their window, plus
      // the selected one (rendered dimmed even off-window — see the SVG below).
      const candidates = overlays.filter((o) => visibleIds.has(o.id) || o.id === selectedId);
      const hit = hitTest(candidates, p, size);
      onSelect(hit?.id ?? null);
      if (hit) {
        onInteractStart();
        drag.current = { mode: "move", id: hit.id, start: p, orig: hit };
        (e.target as Element).setPointerCapture?.(e.pointerId);
      } else {
        // Empty space, select tool: arm a background-click candidate — confirmed on
        // pointerup unless the pointer drifts past CLICK_MOVE_TOL_PX first.
        clickCandidate.current = p;
      }
      return;
    }
    if (tool === "text") {
      // window.prompt() is disabled in Electron — show an inline input instead.
      onSelect(null); // editing a fresh label, not the previously selected one
      editDone.current = false;
      setEditingText({ x: p.x, y: p.y });
      return;
    }
    // box / arrow — the window and jitter seed are fixed for the whole gesture so the
    // draft and the final commit render identically.
    drag.current = {
      mode: tool === "box" ? "draw-box" : "draw-arrow",
      start: p,
      seed: Math.floor(Math.random() * 100000),
      window: overlayWindow(playheadTime, timelineDuration),
    };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    const p = toNorm(e);
    if (clickCandidate.current) {
      const tol = { x: CLICK_MOVE_TOL_PX / (size.w || 1), y: CLICK_MOVE_TOL_PX / (size.h || 1) };
      if (
        Math.abs(p.x - clickCandidate.current.x) > tol.x ||
        Math.abs(p.y - clickCandidate.current.y) > tol.y
      ) {
        clickCandidate.current = null;
      }
    }
    const d = drag.current;
    if (!d) return;
    if (d.mode === "move") {
      const patch = moveBy(d.orig, p.x - d.start.x, p.y - d.start.y);
      onDraft({ ...d.orig, ...patch } as VideoOverlay);
      return;
    }
    if (d.mode === "resize") {
      // Resize from the ORIGINAL geometry each frame (fixed edges stay put, no drift).
      const patch = resizeAnnotation(d.orig, d.handle, p, size);
      onDraft({ ...d.orig, ...patch } as VideoOverlay);
      return;
    }
    const { start, end } = d.window;
    if (d.mode === "draw-box") {
      setDraft({
        id: "draft",
        kind: "box",
        x: Math.min(d.start.x, p.x),
        y: Math.min(d.start.y, p.y),
        w: Math.abs(p.x - d.start.x),
        h: Math.abs(p.y - d.start.y),
        color: toolState.color,
        stroke: toolState.stroke,
        seed: d.seed,
        start,
        end,
      });
    } else {
      setDraft({
        id: "draft",
        kind: "arrow",
        x1: d.start.x,
        y1: d.start.y,
        x2: p.x,
        y2: p.y,
        color: toolState.color,
        stroke: toolState.stroke,
        seed: d.seed,
        start,
        end,
      });
    }
  };

  const onPointerUp = (): void => {
    const d = drag.current;
    drag.current = null;
    const wasBackgroundClick = clickCandidate.current !== null;
    clickCandidate.current = null;
    if (!d) {
      // Confirmed empty-space click in select mode: nothing was hit and the pointer
      // never drifted past tolerance — forward it as the play/pause toggle the video
      // underneath would otherwise have handled (see onBackgroundClick prop doc).
      if (wasBackgroundClick && tool === "select") onBackgroundClick?.();
      return;
    }
    if (d.mode === "move" || d.mode === "resize") {
      onInteractEnd();
      return;
    }
    if (draft && isBigEnough(draft)) {
      const committed = { ...draft, id: newId() } as VideoOverlay;
      onCommit([...overlays, committed]);
      onSelect(committed.id);
    }
    setDraft(null);
  };

  // A pointer gesture can end without a pointerup (system gesture, capture stolen).
  // Abort cleanly so a half-drawn draft or an open move/resize isn't stranded.
  const onPointerAbort = (): void => {
    const d = drag.current;
    drag.current = null;
    clickCandidate.current = null; // an aborted gesture is never a completed click
    if (d?.mode === "move" || d?.mode === "resize") onInteractEnd();
    setDraft(null);
  };

  const commitText = (value: string): void => {
    if (editDone.current) return; // a trailing unmount-blur after Enter/Escape
    editDone.current = true;
    // Only the ends are trimmed: the user's own newlines are content.
    const text = value.trim();
    if (editingText && text) {
      if (editingText.id) {
        // Re-edit: replace the text and keep everything else, above all the timeline
        // window — retyping a label must not move when it appears.
        onCommit(
          overlays.map((o) => (o.id === editingText.id && o.kind === "text" ? { ...o, text } : o)),
        );
        onSelect(editingText.id);
      } else {
        const { start, end } = overlayWindow(playheadTime, timelineDuration);
        const overlay: VideoOverlay = {
          id: newId(),
          kind: "text",
          x: editingText.x,
          y: editingText.y,
          text,
          color: toolState.color,
          size: toolState.textSize,
          start,
          end,
        };
        onCommit([...overlays, overlay]);
        onSelect(overlay.id);
      }
    }
    setEditingText(null);
  };

  // Resize handles show for the selected overlay while the select tool is active.
  const selectedOverlay =
    tool === "select" ? (overlays.find((o) => o.id === selectedId) ?? null) : null;

  return (
    <div
      ref={ref}
      className={styles.layer}
      style={{ cursor: tool === "select" ? "default" : "crosshair" }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerAbort}
      onLostPointerCapture={onPointerAbort}
    >
      <svg className={styles.svg} width={size.w} height={size.h}>
        {overlays.map((o) => {
          const visible = visibleIds.has(o.id);
          const isSelected = selectedId === o.id;
          // Not visible and not selected: not rendered at all. The selected overlay
          // stays visible (dimmed) outside its window so it can still be adjusted.
          if (!visible && !isSelected) return null;
          return (
            <OverlayShape
              key={o.id}
              o={o}
              size={size}
              selected={isSelected}
              opacity={visible ? 1 : 0.35}
            />
          );
        })}
        {draft && <OverlayShape o={draft} size={size} selected={false} />}
        {selectedOverlay && <OverlayHandles o={selectedOverlay} size={size} />}
      </svg>
      {editingText && (
        <textarea
          ref={textInputRef}
          className={styles.textInput}
          placeholder={t("typePlaceholder")}
          rows={1}
          // Prefilled when reopening an existing label; empty for a fresh one.
          defaultValue={editingText.initialText}
          // `off` so the only breaks are the ones the user typed — the label itself
          // does not wrap, so soft-wrapping here would not match what it renders.
          wrap="off"
          style={{
            left: editingText.x * size.w,
            top: editingText.y * size.h,
            color: toolState.color,
            fontFamily: HAND_FONT,
            fontSize: TEXT_PX[toolState.textSize],
            lineHeight: TEXT_LINE_HEIGHT,
            whiteSpace: "pre",
            resize: "none",
            overflow: "hidden",
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onInput={(e) => {
            // Grow with the content so every line stays visible while typing.
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight}px`;
          }}
          onKeyDown={(e) => {
            // Plain Enter commits; Shift/Alt+Enter fall through to the textarea's own
            // newline, the way a spreadsheet cell behaves.
            if (e.key === "Enter" && !e.altKey && !e.shiftKey) {
              e.preventDefault();
              commitText(e.currentTarget.value);
            } else if (e.key === "Escape") {
              e.preventDefault();
              editDone.current = true; // cancel — the unmount blur must not commit
              setEditingText(null);
            }
          }}
          onBlur={(e) => {
            // Ignore the opening click's spurious blur — refocus and keep typing.
            if (!textArmed.current) {
              e.currentTarget.focus();
              return;
            }
            commitText(e.target.value);
          }}
        />
      )}
    </div>
  );
}

function isBigEnough(o: VideoOverlay): boolean {
  if (o.kind === "box") return o.w > 0.01 && o.h > 0.01;
  if (o.kind === "arrow") return Math.hypot(o.x2 - o.x1, o.y2 - o.y1) > 0.02;
  return true;
}

function moveBy(o: VideoOverlay, dx: number, dy: number): Partial<VideoOverlay> {
  if (o.kind === "arrow") {
    return { x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy };
  }
  return { x: o.x + dx, y: o.y + dy };
}

function hitTest(overlays: VideoOverlay[], p: Pt, size: Size): VideoOverlay | null {
  for (let i = overlays.length - 1; i >= 0; i -= 1) {
    const o = overlays[i];
    if (o.kind === "box") {
      if (
        p.x >= o.x - 0.01 &&
        p.x <= o.x + o.w + 0.01 &&
        p.y >= o.y - 0.01 &&
        p.y <= o.y + o.h + 0.01
      ) {
        return o;
      }
    } else if (o.kind === "text") {
      // The text renders in px (TEXT_PX[size]) but lives in normalized space, so the
      // hit box must derive from the font size AND the layer's pixel size (matches the
      // rendered bounds in overlay-shapes.tsx) plus an 8px click margin.
      const fs = TEXT_PX[o.size];
      const padX = 8 / (size.w || 1);
      const padY = 8 / (size.h || 1);
      const w = (o.text.length * fs * 0.55) / (size.w || 1);
      const h = (fs * 1.3) / (size.h || 1);
      if (
        p.x >= o.x - padX &&
        p.x <= o.x + w + padX &&
        p.y >= o.y - padY &&
        p.y <= o.y + h + padY
      ) {
        return o;
      }
    } else if (distToSegment(p, { x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 }) < 0.02) {
      return o;
    }
  }
  return null;
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
