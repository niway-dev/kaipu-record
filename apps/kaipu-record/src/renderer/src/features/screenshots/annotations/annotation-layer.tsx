import React, { useEffect, useRef, useState } from "react";
import { BLUR_STD, HAND_FONT, STROKE_WIDTHS, TEXT_PX } from "./tools";
import { roughArrow, roughRect } from "./rough";
import { smoothPath } from "./smooth";
import { nextAnnotationId, type Annotation } from "./scene";
import type { EditorScene } from "./use-editor-scene";
import type { AnnotationToolsController } from "./use-annotation-tools";
import styles from "./annotation-layer.module.css";

interface Size {
  w: number;
  h: number;
}
interface Pt {
  x: number;
  y: number;
}
type Drag =
  | { mode: "draw-box" | "draw-arrow" | "draw-pen" | "draw-blur"; start: Pt }
  | { mode: "move"; id: string; start: Pt; orig: Annotation };

/**
 * Interactive annotation overlay. Annotations are stored in normalized (0–1)
 * coordinates so they survive resize; this layer measures its displayed pixel
 * size and renders in px (so stroke/text sizes match the design regardless of
 * the image's natural resolution).
 */
export function AnnotationLayer({
  scene,
  tools,
  src,
}: {
  scene: EditorScene;
  tools: AnnotationToolsController;
  /** The shot's display URL — a blur box re-draws a blurred copy of it under the rect. */
  src: string;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [draft, setDraft] = useState<Annotation | null>(null);
  const [editing, setEditing] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  // Blur-to-commit is "armed" only after the input has settled, so the click
  // that opened it can't immediately blur-cancel it before the user can type.
  const textArmed = useRef(false);
  // Set once a text edit is resolved (commit or cancel), so the trailing blur
  // fired when the input unmounts can't re-commit — which would duplicate the
  // label (after Enter) or save a cancelled one (after Escape).
  const editDone = useRef(false);
  // Latest scene for the window keydown handler, so it reads fresh state without
  // re-subscribing on every render (scene is a new object each render).
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

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
    const onKey = (e: KeyboardEvent): void => {
      // Don't hijack Delete/Backspace while the user is typing in a field or a
      // modal is open — only when the canvas owns the key.
      if (isEditingText(e.target) || document.querySelector('[aria-modal="true"]')) return;
      const scn = sceneRef.current;
      if ((e.key === "Delete" || e.key === "Backspace") && scn.selectedId) {
        e.preventDefault();
        scn.removeSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Focus the text input when it opens and arm blur-to-commit on the next frame.
  useEffect(() => {
    if (!editing) {
      textArmed.current = false;
      return;
    }
    textInputRef.current?.focus();
    const raf = requestAnimationFrame(() => {
      textArmed.current = true;
    });
    return () => cancelAnimationFrame(raf);
  }, [editing]);

  const toNorm = (e: React.PointerEvent): Pt => {
    const r = ref.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const onPointerDown = (e: React.PointerEvent): void => {
    const p = toNorm(e);
    if (tools.tool === "select") {
      const hit = hitTest(scene.annotations, p, size);
      scene.select(hit?.id ?? null);
      if (hit) {
        scene.beginInteract();
        drag.current = { mode: "move", id: hit.id, start: p, orig: hit };
        (e.target as Element).setPointerCapture?.(e.pointerId);
      }
      return;
    }
    if (tools.tool === "text") {
      // window.prompt() is disabled in Electron — show an inline input instead.
      scene.select(null); // editing a fresh label, not the previously selected one
      editDone.current = false;
      setEditing({ x: p.x, y: p.y });
      return;
    }
    if (tools.tool === "pen") {
      drag.current = { mode: "draw-pen", start: p };
      setDraft({
        id: "draft",
        kind: "path",
        points: [p],
        color: tools.color,
        stroke: tools.stroke,
      });
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    const mode =
      tools.tool === "box" ? "draw-box" : tools.tool === "blur" ? "draw-blur" : "draw-arrow";
    drag.current = { mode, start: p };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    const d = drag.current;
    if (!d) return;
    const p = toNorm(e);
    if (d.mode === "move") {
      scene.updateAnnotation(d.id, moveBy(d.orig, p.x - d.start.x, p.y - d.start.y));
      return;
    }
    if (d.mode === "draw-pen") {
      setDraft((prev) => {
        if (!prev || prev.kind !== "path") return prev;
        const last = prev.points[prev.points.length - 1];
        // Throttle: drop points too close to the last so the path stays light + smooth.
        if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.004) return prev;
        return { ...prev, points: [...prev.points, p] };
      });
      return;
    }
    if (d.mode === "draw-blur") {
      setDraft({
        id: "draft",
        kind: "blur",
        x: Math.min(d.start.x, p.x),
        y: Math.min(d.start.y, p.y),
        w: Math.abs(p.x - d.start.x),
        h: Math.abs(p.y - d.start.y),
      });
      return;
    }
    if (d.mode === "draw-box") {
      setDraft({
        id: "draft",
        kind: "box",
        x: Math.min(d.start.x, p.x),
        y: Math.min(d.start.y, p.y),
        w: Math.abs(p.x - d.start.x),
        h: Math.abs(p.y - d.start.y),
        color: tools.color,
        stroke: tools.stroke,
        seed: 7,
      });
    } else {
      setDraft({
        id: "draft",
        kind: "arrow",
        x1: d.start.x,
        y1: d.start.y,
        x2: p.x,
        y2: p.y,
        color: tools.color,
        stroke: tools.stroke,
        seed: 7,
      });
    }
  };

  const onPointerUp = (): void => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.mode === "move") {
      scene.endInteract();
      return;
    }
    if (draft && isBigEnough(draft)) {
      const { id, seed } = nextAnnotationId();
      // Paths/blurs carry no rough jitter, so they need no seed.
      const seedless = draft.kind === "path" || draft.kind === "blur";
      const committed = seedless ? { ...draft, id } : { ...draft, id, seed };
      scene.addAnnotation(committed as Annotation);
      // Auto-select the finished shape (Excalidraw-style) so it can be moved/resized
      // right away — except the pen, which stays active for scribbling several strokes.
      if (draft.kind !== "path") {
        tools.setTool("select");
        scene.select(id);
      }
    }
    setDraft(null);
  };

  // A pointer gesture can end without a pointerup (system gesture, capture stolen).
  // Abort cleanly so a half-drawn draft or an open move-interaction isn't stranded.
  const onPointerAbort = (): void => {
    const d = drag.current;
    drag.current = null;
    if (d?.mode === "move") scene.endInteract();
    setDraft(null);
  };

  const commitText = (value: string): void => {
    if (editDone.current) return; // a trailing unmount-blur after Enter/Escape
    editDone.current = true;
    const text = value.trim();
    if (editing && text) {
      const { id } = nextAnnotationId();
      scene.addAnnotation({
        id,
        kind: "text",
        x: editing.x,
        y: editing.y,
        text,
        color: tools.color,
        size: tools.textSize,
      });
      scene.select(id);
      tools.setTool("select"); // auto-select the new label so it can be moved right away
    }
    setEditing(null);
  };

  return (
    <div
      ref={ref}
      className={styles.layer}
      style={{ cursor: tools.tool === "select" ? "default" : "crosshair" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerAbort}
      onLostPointerCapture={onPointerAbort}
    >
      <svg className={styles.svg} width={size.w} height={size.h}>
        {scene.annotations.map((a) => (
          <Shape key={a.id} a={a} size={size} selected={scene.selectedId === a.id} src={src} />
        ))}
        {draft && <Shape a={draft} size={size} selected={false} src={src} />}
      </svg>
      {editing && (
        <input
          ref={textInputRef}
          className={styles.textInput}
          placeholder="Type…"
          style={{
            left: editing.x * size.w,
            top: editing.y * size.h,
            color: tools.color,
            fontFamily: HAND_FONT,
            fontSize: TEXT_PX[tools.textSize],
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitText((e.target as HTMLInputElement).value);
            } else if (e.key === "Escape") {
              e.preventDefault();
              editDone.current = true; // cancel — the unmount blur must not commit
              setEditing(null);
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

function Shape({
  a,
  size,
  selected,
  src,
}: {
  a: Annotation;
  size: Size;
  selected: boolean;
  src: string;
}): React.JSX.Element {
  const { w: W, h: H } = size;

  if (a.kind === "blur") {
    const bx = a.x * W;
    const by = a.y * H;
    const bw = a.w * W;
    const bh = a.h * H;
    // Re-draw a blurred copy of the shot, clipped to the rect — sits over the sharp
    // image so the region reads as blurred. Baked into the export (see compositor).
    // The filter region is bounded to the rect + margin, so the blur only processes
    // those pixels (not the whole shot) and doesn't fade at the rect's edge.
    const m = BLUR_STD * 3;
    return (
      <g>
        <defs>
          <clipPath id={`bclip-${a.id}`}>
            <rect x={bx} y={by} width={bw} height={bh} />
          </clipPath>
          <filter
            id={`bfilter-${a.id}`}
            filterUnits="userSpaceOnUse"
            x={bx - m}
            y={by - m}
            width={bw + 2 * m}
            height={bh + 2 * m}
          >
            <feGaussianBlur stdDeviation={BLUR_STD} />
          </filter>
        </defs>
        <image
          href={src}
          x={0}
          y={0}
          width={W}
          height={H}
          preserveAspectRatio="none"
          clipPath={`url(#bclip-${a.id})`}
          filter={`url(#bfilter-${a.id})`}
        />
        {selected && <rect className={styles.selOutline} x={bx} y={by} width={bw} height={bh} />}
      </g>
    );
  }

  if (a.kind === "box") {
    const bw = a.w * W;
    const bh = a.h * H;
    const sw = STROKE_WIDTHS[a.stroke];
    const path = roughRect(bw, bh, 14, a.seed);
    return (
      <g transform={`translate(${a.x * W},${a.y * H})`}>
        <path d={path} fill={`${a.color}2e`} stroke="none" />
        <path
          d={path}
          fill="none"
          stroke={a.color}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={roughRect(bw, bh, 14, a.seed + 19)}
          fill="none"
          stroke={a.color}
          strokeWidth={sw * 0.7}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.55}
        />
        {selected && (
          <rect className={styles.selOutline} x={-4} y={-4} width={bw + 8} height={bh + 8} />
        )}
      </g>
    );
  }

  if (a.kind === "arrow") {
    const x1 = a.x1 * W;
    const y1 = a.y1 * H;
    const x2 = a.x2 * W;
    const y2 = a.y2 * H;
    const sw = STROKE_WIDTHS[a.stroke];
    return (
      <g>
        <path
          d={roughArrow(x1, y1, x2, y2, a.seed)}
          fill="none"
          stroke={a.color}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={roughArrow(x1, y1, x2, y2, a.seed + 19)}
          fill="none"
          stroke={a.color}
          strokeWidth={sw * 0.7}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.5}
        />
        {selected && <line className={styles.selOutline} x1={x1} y1={y1} x2={x2} y2={y2} />}
      </g>
    );
  }

  if (a.kind === "path") {
    const sw = STROKE_WIDTHS[a.stroke];
    const d = smoothPath(a.points.map((pt) => ({ x: pt.x * W, y: pt.y * H })));
    return (
      <g>
        <path
          d={d}
          fill="none"
          stroke={a.color}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {selected && <path className={styles.selOutline} d={d} fill="none" />}
      </g>
    );
  }

  const tx = a.x * W;
  const ty = a.y * H;
  const fs = TEXT_PX[a.size];
  return (
    <g>
      <text
        x={tx}
        y={ty}
        fill={a.color}
        fontFamily={HAND_FONT}
        fontSize={fs}
        fontWeight={600}
        dominantBaseline="hanging"
        style={{ userSelect: "none" }}
      >
        {a.text}
      </text>
      {selected && (
        <rect
          className={styles.selOutline}
          x={tx - 4}
          y={ty - 4}
          width={a.text.length * fs * 0.55 + 8}
          height={fs * 1.3 + 8}
        />
      )}
    </g>
  );
}

/** True when the keyboard event originated in a text field (so the canvas shouldn't grab it). */
function isEditingText(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

function isBigEnough(a: Annotation): boolean {
  if (a.kind === "box" || a.kind === "blur") return a.w > 0.01 && a.h > 0.01;
  if (a.kind === "arrow") return Math.hypot(a.x2 - a.x1, a.y2 - a.y1) > 0.02;
  if (a.kind === "path") return a.points.length >= 1;
  return true;
}

function moveBy(a: Annotation, dx: number, dy: number): Partial<Annotation> {
  if (a.kind === "arrow") {
    return { x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy } as Partial<Annotation>;
  }
  if (a.kind === "path") {
    return {
      points: a.points.map((pt) => ({ x: pt.x + dx, y: pt.y + dy })),
    } as Partial<Annotation>;
  }
  return { x: a.x + dx, y: a.y + dy } as Partial<Annotation>;
}

function hitTest(annotations: Annotation[], p: Pt, size: Size): Annotation | null {
  for (let i = annotations.length - 1; i >= 0; i -= 1) {
    const a = annotations[i];
    if (a.kind === "box" || a.kind === "blur") {
      if (
        p.x >= a.x - 0.01 &&
        p.x <= a.x + a.w + 0.01 &&
        p.y >= a.y - 0.01 &&
        p.y <= a.y + a.h + 0.01
      ) {
        return a;
      }
    } else if (a.kind === "text") {
      // The text renders in px (TEXT_PX[size]) but lives in normalized space, so the
      // hit box must derive from the font size AND the layer's pixel size — a fixed
      // normalized height broke on short/wide shots (the box was shorter than the
      // glyphs). Match the rendered bounds (see Shape) plus an 8px click margin.
      const fs = TEXT_PX[a.size];
      const padX = 8 / (size.w || 1);
      const padY = 8 / (size.h || 1);
      const w = (a.text.length * fs * 0.55) / (size.w || 1);
      const h = (fs * 1.3) / (size.h || 1);
      if (
        p.x >= a.x - padX &&
        p.x <= a.x + w + padX &&
        p.y >= a.y - padY &&
        p.y <= a.y + h + padY
      ) {
        return a;
      }
    } else if (a.kind === "path") {
      for (let j = 0; j < a.points.length - 1; j += 1) {
        if (distToSegment(p, a.points[j], a.points[j + 1]) < 0.02) return a;
      }
    } else if (distToSegment(p, { x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 }) < 0.02) {
      return a;
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
