import { useEffect, useRef, useState, type PointerEvent } from "react";
import { MoveUpRight, Pause, Pencil, Play, RotateCcw, Type, Undo2 } from "lucide-react";

import { cssVars } from "./css-vars";
import {
  CLIP_SECONDS,
  INITIAL_CLIP,
  clamp,
  cropClip,
  cropTransform,
  formatTime,
  keepMark,
  keptSeconds,
  moveEnd,
  movePlayhead,
  moveStart,
  regionPixels,
  type Clip,
  type Mark,
  type Pt,
  type Region,
} from "./hero-stage-model";
import styles from "./hero-stage.module.css";
import { SampleScreen, Segmented, type T } from "./stage-parts";
import { useHold } from "./use-auto-demo";

export type EditKind = "image" | "video";
type Tool = "pencil" | "arrow" | "text";

const TOOLS = [
  { id: "pencil", icon: Pencil, label: "homeStagePencil" },
  { id: "arrow", icon: MoveUpRight, label: "homeStageArrow" },
  { id: "text", icon: Type, label: "homeStageText" },
] as const;

type EditProps = {
  t: T;
  kind: EditKind;
  onKind: (kind: EditKind) => void;
  capture: Region;
  fresh: boolean;
  onFreshDone: () => void;
  marks: Mark[];
  onMarks: (marks: Mark[]) => void;
  clip: Clip;
  onClip: (update: (clip: Clip) => Clip) => void;
  onHold: (id: string, active: boolean) => void;
};

/**
 * Edit: an Image / Video switch over one canvas. Image shows what Screenshot
 * captured and lets the visitor draw on it; Video shows the same page with a
 * timeline below, a movable playhead and a trim range that changes the status.
 */
export function EditStage(props: EditProps) {
  const { t, kind, onKind } = props;
  const [tool, setTool] = useState<Tool>("pencil");
  // Marks on the image, or a trim on the clip, are work the demo must not take away.
  const trimmed = props.clip.start !== INITIAL_CLIP.start || props.clip.end !== INITIAL_CLIP.end;
  useHold(props.onHold, "edit", kind === "image" ? props.marks.length > 0 : trimmed);
  return (
    <>
      <div className={styles.toolbar}>
        <Segmented<EditKind>
          label={t("homeStageEdit")}
          value={kind}
          onChange={onKind}
          options={[
            { value: "image", label: t("homeStageImage") },
            { value: "video", label: t("homeStageVideo") },
          ]}
        />
        {kind === "image" && <ImageTools {...props} tool={tool} onTool={setTool} />}
      </div>
      {kind === "image" ? <ImageCanvas {...props} tool={tool} /> : <VideoView {...props} />}
    </>
  );
}

/* ---- Image ----------------------------------------------------------------- */

function ImageTools({
  t,
  marks,
  onMarks,
  tool,
  onTool,
}: EditProps & { tool: Tool; onTool: (tool: Tool) => void }) {
  return (
    <>
      <div className={styles.tools} role="group" aria-label={t("homeStageTools")}>
        {TOOLS.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            type="button"
            className={`${styles.tool} ${tool === id ? styles.toolOn : ""}`}
            aria-pressed={tool === id}
            aria-label={t(label)}
            data-tool={id}
            onClick={() => onTool(id)}
          >
            <Icon size={15} aria-hidden />
            <span className={styles.toolLabel}>{t(label)}</span>
          </button>
        ))}
      </div>
      <div className={styles.tools}>
        <button
          type="button"
          className={styles.tool}
          aria-label={t("homeStageUndo")}
          disabled={marks.length === 0}
          onClick={() => onMarks(marks.slice(0, -1))}
        >
          <Undo2 size={15} aria-hidden />
          <span className={styles.toolLabel}>{t("homeStageUndo")}</span>
        </button>
        <button
          type="button"
          className={styles.tool}
          aria-label={t("homeStageReset")}
          disabled={marks.length === 0}
          onClick={() => onMarks([])}
        >
          <RotateCcw size={15} aria-hidden />
          <span className={styles.toolLabel}>{t("homeStageReset")}</span>
        </button>
      </div>
    </>
  );
}

function ImageCanvas({
  t,
  capture,
  fresh,
  onFreshDone,
  marks,
  onMarks,
  tool,
}: EditProps & { tool: Tool }) {
  const layer = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Mark | null>(null);
  const px = regionPixels(capture);

  const point = (e: PointerEvent): Pt => {
    const box = layer.current!.getBoundingClientRect();
    return {
      x: clamp((e.clientX - box.left) / box.width, 0, 1),
      y: clamp((e.clientY - box.top) / box.height, 0, 1),
    };
  };

  const down = (e: PointerEvent) => {
    const at = point(e);
    if (tool === "text") {
      onMarks([...marks, { kind: "text", at }]);
      return;
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDraft(
      tool === "pencil" ? { kind: "pencil", points: [at] } : { kind: "arrow", from: at, to: at },
    );
  };
  const move = (e: PointerEvent) => {
    if (!draft) return;
    const at = point(e);
    setDraft(
      draft.kind === "pencil"
        ? { kind: "pencil", points: [...draft.points, at] }
        : draft.kind === "arrow"
          ? { ...draft, to: at }
          : draft,
    );
  };
  const up = () => {
    if (draft && keepMark(draft)) onMarks([...marks, draft]);
    setDraft(null);
  };

  const shown = draft ? [...marks, draft] : marks;
  const pct = (n: number) => `${n * 100}%`;

  return (
    <div className={styles.screen}>
      <div
        className={styles.shot}
        data-testid="captured-image"
        style={{ transform: cropTransform(capture), clipPath: cropClip(capture) }}
      >
        <SampleScreen t={t} />
      </div>

      <div
        ref={layer}
        className={styles.ink}
        data-testid="annotation-surface"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <svg className={styles.inkSvg} aria-hidden>
          <defs>
            <marker
              id="kl-stage-arrowhead"
              markerUnits="userSpaceOnUse"
              markerWidth="16"
              markerHeight="16"
              refX="13"
              refY="8"
              orient="auto"
            >
              <path d="M1 2 L14 8 L1 14 z" fill="currentColor" />
            </marker>
          </defs>
          {shown.map((m, i) =>
            m.kind === "pencil" ? (
              <g key={i} data-mark="pencil">
                {m.points.map((p, j) => {
                  const prev = m.points[j - 1] ?? p;
                  return (
                    <line
                      key={j}
                      x1={pct(prev.x)}
                      y1={pct(prev.y)}
                      x2={pct(p.x)}
                      y2={pct(p.y)}
                      className={styles.stroke}
                    />
                  );
                })}
              </g>
            ) : m.kind === "arrow" ? (
              <line
                key={i}
                data-mark="arrow"
                x1={pct(m.from.x)}
                y1={pct(m.from.y)}
                x2={pct(m.to.x)}
                y2={pct(m.to.y)}
                className={styles.stroke}
                markerEnd="url(#kl-stage-arrowhead)"
              />
            ) : null,
          )}
        </svg>
        {shown.map((m, i) =>
          m.kind === "text" ? (
            <span
              key={i}
              data-mark="text"
              className={styles.note}
              style={{ left: pct(m.at.x), top: pct(m.at.y) }}
            >
              {t("homeStageNote")}
            </span>
          ) : null,
        )}
      </div>

      <span className={styles.chip}>{t("homeStageSaved", { size: `${px.w} × ${px.h}` })}</span>
      {fresh && <span className={styles.shutter} aria-hidden onAnimationEnd={onFreshDone} />}
    </div>
  );
}

/* ---- Video ----------------------------------------------------------------- */

const TICK_SECONDS = 0.25;

function VideoView({ t, clip, onClip, onHold }: EditProps) {
  const [playing, setPlaying] = useState(false);
  useHold(onHold, "edit-playing", playing);
  const track = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(
      () => onClip((c) => movePlayhead(c, c.playhead + TICK_SECONDS)),
      TICK_SECONDS * 1000,
    );
    return () => clearInterval(id);
  }, [playing, onClip]);

  useEffect(() => {
    if (playing && clip.playhead >= clip.end) setPlaying(false);
  }, [playing, clip.playhead, clip.end]);

  const toggle = () => {
    if (playing) return setPlaying(false);
    if (clip.playhead >= clip.end) onClip((c) => movePlayhead(c, c.start));
    setPlaying(true);
  };

  /** A click anywhere on the lane seeks; the three thumbs handle their own drags. */
  const seek = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    const box = track.current!.getBoundingClientRect();
    const f = clamp((e.clientX - box.left) / box.width, 0, 1);
    onClip((c) => movePlayhead(c, f * CLIP_SECONDS));
  };

  const fraction = (s: number) => String(s / CLIP_SECONDS);
  const progress = (clip.playhead - clip.start) / keptSeconds(clip);

  return (
    <>
      <div className={styles.screen}>
        <SampleScreen t={t} download />
        <span className={styles.timecode} data-testid="timecode">
          {formatTime(clip.playhead)}
        </span>
        <span className={styles.progress} style={{ width: `${progress * 100}%` }} />
      </div>

      <div className={styles.timeline}>
        <div className={styles.timelineHead}>
          <button
            type="button"
            className={styles.play}
            aria-label={playing ? t("homeStagePause") : t("homeStagePlay")}
            onClick={toggle}
          >
            {playing ? <Pause size={15} aria-hidden /> : <Play size={15} aria-hidden />}
          </button>
          <span className={styles.mono}>
            {formatTime(clip.playhead)} / {formatTime(CLIP_SECONDS)}
          </span>
          <span className={styles.chips} role="status" data-testid="trim-status">
            <span className={styles.statusChip}>
              {t("homeStageTrimRange", { from: formatTime(clip.start), to: formatTime(clip.end) })}
            </span>
            <span className={`${styles.statusChip} ${styles.statusOn}`}>
              {t("homeStageKept", { duration: formatTime(keptSeconds(clip)) })}
            </span>
          </span>
        </div>

        <div ref={track} className={styles.track} onPointerDown={seek}>
          <span className={styles.lane} />
          <span
            className={styles.keptBar}
            style={cssVars({ "--from": fraction(clip.start), "--to": fraction(clip.end) })}
          />
          <input
            type="range"
            className={`${styles.range} ${styles.rangePlayhead}`}
            min={0}
            max={CLIP_SECONDS}
            step={TICK_SECONDS}
            value={clip.playhead}
            aria-label={t("homeStagePlayhead")}
            onChange={(e) => onClip((c) => movePlayhead(c, Number(e.target.value)))}
          />
          <input
            type="range"
            className={`${styles.range} ${styles.rangeTrim}`}
            min={0}
            max={CLIP_SECONDS}
            step={1}
            value={clip.start}
            aria-label={t("homeStageTrimStart")}
            onChange={(e) => onClip((c) => moveStart(c, Number(e.target.value)))}
          />
          <input
            type="range"
            className={`${styles.range} ${styles.rangeTrim}`}
            min={0}
            max={CLIP_SECONDS}
            step={1}
            value={clip.end}
            aria-label={t("homeStageTrimEnd")}
            onChange={(e) => onClip((c) => moveEnd(c, Number(e.target.value)))}
          />
        </div>
      </div>
    </>
  );
}
