import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  entryAt,
  type LayoutEntry,
  layoutDuration,
  timelineToSource,
  sourceToTimeline,
} from "./timeline";

export interface PreviewPlayback {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  playing: boolean;
  duration: number;
  timelineTime: number;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(t: number): void;
  onVideoTimeUpdate(): void;
  onVideoEnded(): void;
  subscribeTime(listener: (t: number) => void): () => void;
}

const END_EPSILON = 0.02;

export function usePreviewPlayback(layout: LayoutEntry[]): PreviewPlayback {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const internalSeekRef = useRef(false);
  const listenersRef = useRef(new Set<(t: number) => void>());
  const [playing, setPlaying] = useState(false);
  const [timelineTime, setTimelineTime] = useState(0);
  const duration = useMemo(() => layoutDuration(layout), [layout]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const emitTime = useCallback((t: number) => {
    for (const listener of listenersRef.current) listener(t);
  }, []);

  // Between the video crossing a cut boundary and onVideoTimeUpdate reseeking it,
  // sourceToTimeline briefly returns null. Hold the last valid time instead of emitting
  // a garbage value, or the playhead visibly jumps to 100% for a frame.
  const lastValidTimeRef = useRef(0);

  // rAF loop feeds high-frequency listeners (playhead) without re-rendering React.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const video = videoRef.current;
      const mapped = video ? sourceToTimeline(layoutRef.current, video.currentTime) : null;
      if (mapped !== null) lastValidTimeRef.current = mapped;
      emitTime(lastValidTimeRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, emitTime]);

  const seekVideoToSource = useCallback((sourceTime: number) => {
    const video = videoRef.current;
    if (!video) return;
    internalSeekRef.current = true;
    video.currentTime = sourceTime;
  }, []);

  const seek = useCallback(
    (t: number) => {
      const hit = timelineToSource(layoutRef.current, t);
      if (!hit) return;
      // Slides are handled in plan 05; until then every entry is a clip.
      if (hit.entry.kind === "clip") seekVideoToSource(hit.sourceTime);
      setTimelineTime(Math.max(0, Math.min(t, layoutDuration(layoutRef.current))));
      emitTime(t);
    },
    [seekVideoToSource, emitTime],
  );

  const play = useCallback(() => {
    void videoRef.current?.play();
    setPlaying(true);
  }, []);

  const pause = useCallback(() => {
    videoRef.current?.pause();
    setPlaying(false);
  }, []);

  const toggle = useCallback(() => {
    (videoRef.current?.paused ?? true) ? play() : pause();
  }, [play, pause]);

  const onVideoTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (internalSeekRef.current) {
      internalSeekRef.current = false;
      return;
    }
    const layoutNow = layoutRef.current;
    const sourceT = video.currentTime;
    const t = sourceToTimeline(layoutNow, sourceT);

    const advanceFrom = (timelineEnd: number) => {
      const next = entryAt(layoutNow, timelineEnd + END_EPSILON);
      if (!next || next.timelineEnd <= timelineEnd + END_EPSILON) {
        pause();
        setTimelineTime(layoutDuration(layoutNow));
        return;
      }
      // Slides pause the video (plan 05 renders the image); clips reseek and keep playing.
      if (next.kind === "clip") {
        seekVideoToSource(next.sourceStart);
      }
      setTimelineTime(next.timelineStart);
    };

    if (t === null) {
      // The <video> drifted into deleted footage (native playback ran past a cut, or a
      // native control seeked). Snap forward to the first kept entry after this source
      // time, or stop at the end.
      const target = layoutNow.find(
        (e) => e.kind === "clip" && e.sourceStart >= sourceT - END_EPSILON,
      );
      if (target) {
        seekVideoToSource(target.sourceStart);
        setTimelineTime(target.timelineStart);
      } else {
        pause();
        setTimelineTime(layoutDuration(layoutNow));
      }
      return;
    }

    const entry = entryAt(layoutNow, t);
    if (entry && sourceT >= entry.sourceEnd - END_EPSILON) {
      advanceFrom(entry.timelineEnd);
      return;
    }
    setTimelineTime(t);
  }, [pause, seekVideoToSource]);

  const onVideoEnded = useCallback(() => {
    setPlaying(false);
    setTimelineTime(layoutDuration(layoutRef.current));
  }, []);

  const subscribeTime = useCallback((listener: (t: number) => void) => {
    listenersRef.current.add(listener);
    return () => listenersRef.current.delete(listener);
  }, []);

  return {
    videoRef,
    playing,
    duration,
    timelineTime,
    play,
    pause,
    toggle,
    seek,
    onVideoTimeUpdate,
    onVideoEnded,
    subscribeTime,
  };
}
