/**
 * The marks around the camera bubble while the editor is PAUSED (camera parts, drag-first): a
 * label that says what a drag would edit, and for a part where its camera comes from (a ghost
 * bubble at the start place, the dotted route with its arrowhead, a chip naming the slide), or
 * a dashed outline where a hidden range would show the camera.
 *
 * Never while playing and never in an export: this is editor chrome. The export composer must
 * not import this file or `webcam-marks.ts` (a test reads the export folder's imports). No mark
 * takes a pointer, so the bubble under them stays grabbable.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, EyeOff } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { uiArea } from "@renderer/lib/ui-area";
import type { FrameSize } from "../webcam/webcam-layout";
import { webcamMarks, type WebcamMarkLabel } from "../webcam/webcam-marks";
import type { WebcamScene } from "../webcam/webcam-model";
import { WebcamRouteOverlay } from "./webcam-route-overlay";
import styles from "./webcam-marks.module.css";

/** "0:24": minutes and whole seconds. */
function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds + 1e-6));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** 0.7, 1.2, 0.35: the seconds as short as they can be written. */
const seconds = (value: number): string => String(Number(value.toFixed(2)));

/** A bubble this far up the preview (a share of its height) takes its label below it. */
const LABEL_BELOW_SHARE = 0.31;

export interface WebcamMarksProps {
  webcam: WebcamScene;
  /** The playhead in SOURCE seconds; null over a slide clip. */
  sourceTime: number | null;
  /** The selected segment (a part or a hidden range), if any. */
  selectedId: string | null;
  /** The output frame the layout is relative to. */
  frame: FrameSize;
  /** The camera path's scale at the playhead: the bubble's size follows it. */
  cameraScale: number;
  endSeconds?: number;
  playing: boolean;
  /** The bubble is held (dragged, or a card is asking): the scene's marks would be stale. */
  suppressed: boolean;
}

export function WebcamMarks(props: WebcamMarksProps): React.JSX.Element | null {
  if (props.playing || props.suppressed) return null;
  return <PausedMarks {...props} />;
}

function PausedMarks({
  webcam,
  sourceTime,
  selectedId,
  frame,
  cameraScale,
  endSeconds,
}: WebcamMarksProps): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // The preview's size in CSS px, before paint and on resize: the marks sit in it, while the
  // bubble's own numbers are in frame pixels.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = (): void => {
      const rect = root.getBoundingClientRect();
      setSize((previous) =>
        previous.w === rect.width && previous.h === rect.height
          ? previous
          : { w: rect.width, h: rect.height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const marks = webcamMarks({ webcam, sourceTime, selectedId, frame, cameraScale, endSeconds });
  const scale = frame.width > 0 ? size.w / frame.width : 0;

  const labelText = (label: WebcamMarkLabel): string =>
    label.kind === "sliding"
      ? t("webcamMarkSliding")
      : label.kind === "part"
        ? t("webcamMarkPart", { from: clock(label.start), to: clock(label.end) })
        : t("webcamMarkOriginal");

  return (
    <div
      ref={rootRef}
      {...uiArea("editorVideo.webcamMarks")}
      className={styles.root}
      data-testid="webcam-marks"
    >
      {marks?.from && (
        <WebcamRouteOverlay
          route={marks.from.route}
          frame={frame}
          size={size}
          boxHeight={marks.from.box.height}
          fromTag={
            marks.from.ghost === "before" ? t("webcamMarkBefore") : t("webcamMarkOriginalTag")
          }
          chip={
            <>
              <ArrowRight size={12} strokeWidth={2.2} />
              {marks.from.chip.kind === "cut"
                ? t("webcamMarkCut")
                : t("webcamMarkSlide", { seconds: seconds(marks.from.chip.seconds) })}
            </>
          }
          ghost={{ box: marks.from.box, clipPath: marks.from.clipPath }}
          testId="webcam-mark"
        />
      )}
      {marks?.bubble && marks.label && scale > 0 && (
        <span
          className={styles.label}
          data-tone={marks.label.kind === "part" ? "part" : "plain"}
          data-testid="webcam-mark-label"
          style={{
            left: marks.bubble.center.x * scale,
            top:
              marks.bubble.center.y / frame.height < LABEL_BELOW_SHARE
                ? (marks.bubble.center.y + marks.bubble.box.height / 2) * scale + 10
                : (marks.bubble.center.y - marks.bubble.box.height / 2) * scale - 32,
          }}
        >
          {labelText(marks.label)}
        </span>
      )}
      {marks?.hidden && scale > 0 && (
        <span
          className={styles.hidden}
          data-testid="webcam-mark-hidden"
          style={{
            left: (marks.hidden.center.x - marks.hidden.box.width / 2) * scale,
            top: (marks.hidden.center.y - marks.hidden.box.height / 2) * scale,
            width: marks.hidden.box.width * scale,
            height: marks.hidden.box.height * scale,
            borderRadius:
              marks.hidden.shape === "circle"
                ? "50%"
                : `${marks.hidden.cornerRadius * Math.min(marks.hidden.box.width, marks.hidden.box.height) * scale}px`,
          }}
        >
          <EyeOff size={20} />
          <span className={styles.hiddenText}>{t("webcamMarkHidden")}</span>
        </span>
      )}
    </div>
  );
}
