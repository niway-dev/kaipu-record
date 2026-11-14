/**
 * The Audio lane's waveform (NIW2-775): one canvas as wide as the VISIBLE part of the lane.
 *
 * The lane is as wide as the whole zoomed content (at 2000% that is 20 viewports), far past
 * what a canvas can be, so the canvas follows the scroll (`left: scroll`) and redraws the
 * bars that fall in the window. Bars sit on a fixed pixel pitch anchored to the content
 * (see `waveform-bars.ts`), so they do not shimmer while scrolling.
 */
import { useLayoutEffect, useRef } from "react";
import { levelToHeight } from "../audio-peaks";
import type { MutedRange } from "../audio-edits";
import { layoutDuration, type LayoutEntry } from "../timeline";
import type { AudioPeaks } from "../use-audio-peaks";
import { useTimelineViewContext } from "./timeline-pointer";
import { scaleOf } from "./timeline-view";
import { waveformBars } from "./waveform-bars";
import styles from "./audio-lane.module.css";

/** Distance between two bars' left edges, and the bar's width within it (px). */
const PITCH = 5;
const BAR_WIDTH = 3;
/** The lane's height when the canvas has not been laid out (a test). */
const FALLBACK_HEIGHT = 29;
/** Room kept above and below the tallest bar, and the shortest bar (a quiet stub). */
const VERTICAL_MARGIN = 4;
const MIN_BAR_HEIGHT = 2;
/** Bars under a muted range, or under the whole-recording mute, draw at this opacity. */
const MUTED_ALPHA = 0.3;

export interface AudioWaveformProps {
  waveform: AudioPeaks;
  layout: LayoutEntry[];
  mutedRanges: MutedRange[];
  audioMuted: boolean;
}

export function AudioWaveform({
  waveform,
  layout,
  mutedRanges,
  audioMuted,
}: AudioWaveformProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Under a strip the scale and the window come from its view; alone (a test) from the
  // lane's own box, like the webcam lane's filmstrip.
  const view = useTimelineViewContext();
  const scroll = view?.scroll ?? 0;
  const viewWidth = view?.laneWidth ?? 0;
  const viewZoom = view?.zoom ?? 1;
  const viewDuration = view?.duration ?? 0;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d"); // null in jsdom: nothing to draw on
    if (!ctx) return;

    const duration = layoutDuration(layout);
    const width = view ? view.laneWidth : (canvas.parentElement?.clientWidth ?? 0);
    const height = canvas.clientHeight || FALLBACK_HEIGHT;
    const scale = view ? scaleOf(view) : duration > 0 ? width / duration : 0;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const bars = waveformBars({
      peaks: waveform.peaks,
      filled: waveform.filled,
      layout,
      scale,
      scroll: view ? view.scroll : 0,
      laneWidth: width,
      pitch: PITCH,
      mutedRanges,
      audioMuted,
    });
    // The colour comes from the CSS module so the waveform follows the theme.
    ctx.fillStyle = getComputedStyle(canvas).color;
    const tallest = height - 2 * VERTICAL_MARGIN;
    const inset = (PITCH - BAR_WIDTH) / 2;
    for (const bar of bars) {
      const barHeight =
        MIN_BAR_HEIGHT + levelToHeight(bar.peak, waveform.reference) * (tallest - MIN_BAR_HEIGHT);
      const y = (height - barHeight) / 2;
      ctx.globalAlpha = bar.muted ? MUTED_ALPHA : 1;
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(bar.x + inset, y, BAR_WIDTH, barHeight, BAR_WIDTH / 2);
      } else {
        ctx.rect(bar.x + inset, y, BAR_WIDTH, barHeight);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // `view` is read through its four fields so the effect does not re-run on an unrelated
    // change of the object's identity.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [waveform, layout, mutedRanges, audioMuted, scroll, viewWidth, viewZoom, viewDuration]);

  return (
    <canvas
      ref={canvasRef}
      className={styles.waveform}
      style={view ? { left: scroll, width: viewWidth } : undefined}
      // "complete" once the whole recording is decoded: the UI catalog waits for it.
      data-audio-waveform={waveform.complete ? "complete" : "partial"}
      aria-hidden="true"
    />
  );
}
