import React, { useEffect, useRef, useState } from "react";
import { STROKE_WIDTHS } from "./tools";
import { roughArrow, roughRect } from "./rough";
import { nextAnnotationId, type Annotation } from "./scene";
import type { EditorScene } from "./use-editor-scene";
import type { AnnotationToolsController } from "./use-annotation-tools";
import styles from "./annotation-layer.module.css";

const TEXT_PX = [20, 28, 38];
const HAND_FONT = '"Caveat", "Comic Sans MS", "Segoe Print", cursive';

interface Size {
  w: number;
  h: number;
}
interface Pt {
  x: number;
  y: number;
}
type Drag =
  | { mode: "draw-box" | "draw-arrow"; start: Pt }
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
}: {
  scene: EditorScene;
  tools: AnnotationToolsController;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [draft, setDraft] = useState<Annotation | null>(null);
  const drag = useRef<Drag | null>(null);

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
      if ((e.key === "Delete" || e.key === "Backspace") && scene.selectedId) {
        e.preventDefault();
        scene.removeSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scene]);

  const toNorm = (e: React.PointerEvent): Pt => {
    const r = ref.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const onPointerDown = (e: React.PointerEvent): void => {
    const p = toNorm(e);
    if (tools.tool === "select") {
      const hit = hitTest(scene.annotations, p);
      scene.select(hit?.id ?? null);
      if (hit) {
        scene.beginInteract();
        drag.current = { mode: "move", id: hit.id, start: p, orig: hit };
        (e.target as Element).setPointerCapture?.(e.pointerId);
      }
      return;
    }
    if (tools.tool === "text") {
      const text = window.prompt("Texto de la anotación");
      if (text) {
        const { id } = nextAnnotationId();
        scene.addAnnotation({
          id,
          kind: "text",
          x: p.x,
          y: p.y,
          text,
          color: tools.color,
          size: tools.textSize,
        });
        scene.select(id);
        tools.setTool("select");
      }
      return;
    }
    drag.current = { mode: tools.tool === "box" ? "draw-box" : "draw-arrow", start: p };
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
      scene.addAnnotation({ ...draft, id, seed } as Annotation);
      scene.select(id);
      tools.setTool("select");
    }
    setDraft(null);
  };

  return (
    <div
      ref={ref}
      className={styles.layer}
      style={{ cursor: tools.tool === "select" ? "default" : "crosshair" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <svg className={styles.svg} width={size.w} height={size.h}>
        {scene.annotations.map((a) => (
          <Shape key={a.id} a={a} size={size} selected={scene.selectedId === a.id} />
        ))}
        {draft && <Shape a={draft} size={size} selected={false} />}
      </svg>
    </div>
  );
}

function Shape({
  a,
  size,
  selected,
}: {
  a: Annotation;
  size: Size;
  selected: boolean;
}): React.JSX.Element {
  const { w: W, h: H } = size;

  if (a.kind === "box") {
    const bw = a.w * W;
    const bh = a.h * H;
    const sw = STROKE_WIDTHS[a.stroke];
    const path = roughRect(bw, bh, 14, a.seed);
    return (
      <g transform={`translate(${a.x * W},${a.y * H})`}>
        <path d={path} fill={`${a.color}2e`} stroke="none" />
        <path d={path} fill="none" stroke={a.color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
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
        <path d={roughArrow(x1, y1, x2, y2, a.seed)} fill="none" stroke={a.color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
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

function isBigEnough(a: Annotation): boolean {
  if (a.kind === "box") return a.w > 0.01 && a.h > 0.01;
  if (a.kind === "arrow") return Math.hypot(a.x2 - a.x1, a.y2 - a.y1) > 0.02;
  return true;
}

function moveBy(a: Annotation, dx: number, dy: number): Partial<Annotation> {
  if (a.kind === "arrow") {
    return { x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy } as Partial<Annotation>;
  }
  return { x: a.x + dx, y: a.y + dy } as Partial<Annotation>;
}

function hitTest(annotations: Annotation[], p: Pt): Annotation | null {
  for (let i = annotations.length - 1; i >= 0; i -= 1) {
    const a = annotations[i];
    if (a.kind === "box") {
      if (p.x >= a.x - 0.01 && p.x <= a.x + a.w + 0.01 && p.y >= a.y - 0.01 && p.y <= a.y + a.h + 0.01) {
        return a;
      }
    } else if (a.kind === "text") {
      const w = a.text.length * 0.012 + 0.04;
      if (p.x >= a.x - 0.01 && p.x <= a.x + w && p.y >= a.y - 0.01 && p.y <= a.y + 0.06) return a;
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
