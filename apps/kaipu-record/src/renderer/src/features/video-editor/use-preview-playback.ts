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

  const currentTimelineTime = useCallback((): number => {
    const video = videoRef.current;
    if (!video) return 0;
    return sourceToTimeline(layoutRef.current, video.currentTime) ?? 0;
  }, []);

  const emitTime = useCallback((t: number) => {
    for (const listener of listenersRef.current) listener(t);
  }, []);

  // rAF loop feeds high-frequency listeners (playhead) without re-rendering React.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      emitTime(currentTimelineTime());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, currentTimelineTime, emitTime]);

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
    const t = sourceToTimeline(layoutNow, video.currentTime);
    if (t === null) {
      // Inside deleted footage — plan 03 advances to the next entry here. With a
      // single full clip this cannot happen; snap to the nearest kept position.
      const entry = entryAt(layoutNow, timelineTime);
      if (entry) seekVideoToSource(entry.sourceStart);
      return;
    }
    const entry = entryAt(layoutNow, t);
    if (entry && video.currentTime >= entry.sourceEnd - END_EPSILON) {
      // Reached the end of this entry: plan 03 jumps to the next one. Single-clip
      // case: stop at the end.
      if (entry.timelineEnd >= layoutDuration(layoutNow) - END_EPSILON) pause();
    }
    setTimelineTime(t);
  }, [pause, seekVideoToSource, timelineTime]);

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
