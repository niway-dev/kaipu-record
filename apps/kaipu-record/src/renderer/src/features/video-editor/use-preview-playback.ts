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
  /** Whether the preview audio is silenced (preview-only; export always includes audio). */
  muted: boolean;
  duration: number;
  timelineTime: number;
  /** Slide entry under the playhead, else null — the page maps this to the image URL. */
  activeSlideId: string | null;
  play(): void;
  pause(): void;
  toggle(): void;
  /** Toggle preview audio mute — does NOT affect the exported file. */
  toggleMute(): void;
  seek(t: number): void;
  onVideoTimeUpdate(): void;
  onVideoEnded(): void;
  /** Wire to the <video>'s `play` event — keeps `playing` honest with the real element. */
  onVideoPlay(): void;
  /** Wire to the <video>'s `pause` event — so an element that pauses on its own (or a
   *  rejected play() that never started) can't leave the transport stuck showing "pause". */
  onVideoPause(): void;
  subscribeTime(listener: (t: number) => void): () => void;
}

const END_EPSILON = 0.02;

/**
 * A slide has no media element, so its clock is wall time. We freeze the played offset
 * in `consumed` and, while playing, add the time since `anchorAt` — so pause/resume
 * never burns slide time (total on-screen time equals the slide's `duration` of PLAYING
 * time). `timelineStart`/`timelineEnd` mirror the slide's layout bounds and are refreshed
 * when the layout changes (e.g. a duration edit) so the boundary check stays correct.
 */
interface ActiveSlide {
  itemId: string;
  timelineStart: number;
  timelineEnd: number;
  /** Seconds of the slide already played, frozen at the last (re)anchor. */
  consumed: number;
  /** performance.now() when the current playing run started; null while paused. */
  anchorAt: number | null;
}

export function usePreviewPlayback(layout: LayoutEntry[]): PreviewPlayback {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const internalSeekRef = useRef(false);
  const listenersRef = useRef(new Set<(t: number) => void>());
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [timelineTime, setTimelineTime] = useState(0);
  const [activeSlideId, setActiveSlideId] = useState<string | null>(null);
  const duration = useMemo(() => layoutDuration(layout), [layout]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // `playing` mirrored as a ref: play/pause/seek/advance run in event handlers and the
  // rAF loop, which must read the current value synchronously (state would be stale).
  const playingRef = useRef(false);
  // The active slide's wall-clock state (null when the playhead is on a clip). A ref so
  // the rAF loop and pointer handlers share one source of truth without re-rendering.
  const slideRef = useRef<ActiveSlide | null>(null);
  // Latest committed timeline time, read synchronously by play() to decide whether the
  // entry under the playhead is a slide that should start on its own clock.
  const timelineTimeRef = useRef(0);
  timelineTimeRef.current = timelineTime;

  const emitTime = useCallback((t: number) => {
    for (const listener of listenersRef.current) listener(t);
  }, []);

  // Between the video crossing a cut boundary and onVideoTimeUpdate reseeking it,
  // sourceToTimeline briefly returns null. Hold the last valid time instead of emitting
  // a garbage value, or the playhead visibly jumps to 100% for a frame.
  const lastValidTimeRef = useRef(0);

  const seekVideoToSource = useCallback((sourceTime: number) => {
    const video = videoRef.current;
    if (!video) return;
    internalSeekRef.current = true;
    video.currentTime = sourceTime;
  }, []);

  // Enter a slide: pause+hide the video (the page renders the image on top) and start
  // the slide clock at `offset` seconds in. The video is NOT sought — a slide holds
  // whatever it is, independent of source time.
  const enterSlide = useCallback((entry: LayoutEntry, offset: number) => {
    videoRef.current?.pause();
    slideRef.current = {
      itemId: entry.itemId,
      timelineStart: entry.timelineStart,
      timelineEnd: entry.timelineEnd,
      consumed: Math.max(0, offset),
      anchorAt: playingRef.current ? performance.now() : null,
    };
    setActiveSlideId(entry.itemId);
  }, []);

  const exitSlide = useCallback(() => {
    if (slideRef.current === null) return;
    slideRef.current = null;
    setActiveSlideId(null);
  }, []);

  // Shared boundary advance for both playback clocks: the video's `timeupdate` (a clip
  // ran to its cut) and the rAF slide clock (a slide held its full duration). Chains the
  // next entry — reseek+resume the video for a clip, start the clock for a slide, or
  // stop at the end of the timeline.
  const advanceFrom = useCallback(
    (timelineEnd: number) => {
      const layoutNow = layoutRef.current;
      const next = entryAt(layoutNow, timelineEnd + END_EPSILON);
      if (!next || next.timelineEnd <= timelineEnd + END_EPSILON) {
        exitSlide();
        playingRef.current = false;
        setPlaying(false);
        videoRef.current?.pause();
        const end = layoutDuration(layoutNow);
        setTimelineTime(end);
        emitTime(end);
        return;
      }
      if (next.kind === "slide") {
        enterSlide(next, 0);
      } else {
        exitSlide();
        seekVideoToSource(next.sourceStart);
        // Coming off a slide the video was paused — resume it if we're still playing.
        if (playingRef.current) void videoRef.current?.play().catch(() => {});
      }
      setTimelineTime(next.timelineStart);
    },
    [enterSlide, exitSlide, seekVideoToSource, emitTime],
  );

  // rAF loop feeds high-frequency listeners (playhead) without re-rendering React. On a
  // clip it tracks the video's currentTime; on a slide it derives time from the wall
  // clock and advances at the slide's end (the video emits no timeupdate while paused).
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const slide = slideRef.current;
      if (slide) {
        const running = slide.anchorAt !== null ? (performance.now() - slide.anchorAt) / 1000 : 0;
        const t = slide.timelineStart + slide.consumed + running;
        if (t >= slide.timelineEnd - END_EPSILON) {
          advanceFrom(slide.timelineEnd);
        } else {
          lastValidTimeRef.current = t;
          emitTime(t);
        }
      } else {
        const video = videoRef.current;
        const mapped = video ? sourceToTimeline(layoutRef.current, video.currentTime) : null;
        if (mapped !== null) lastValidTimeRef.current = mapped;
        emitTime(lastValidTimeRef.current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, emitTime, advanceFrom]);

  // The video's `timeupdate` drives `timelineTime` state on clips; slides get no such
  // event, so update the state on a low-frequency interval while one is active (the rAF
  // loop already handles the smooth playhead via emitTime).
  useEffect(() => {
    if (activeSlideId === null || !playing) return;
    const id = setInterval(() => {
      const slide = slideRef.current;
      if (!slide) return;
      const running = slide.anchorAt !== null ? (performance.now() - slide.anchorAt) / 1000 : 0;
      const t = slide.timelineStart + slide.consumed + running;
      setTimelineTime(Math.min(t, slide.timelineEnd));
    }, 250);
    return () => clearInterval(id);
  }, [activeSlideId, playing]);

  // Keep the active slide's bounds in sync with the layout (a duration edit moves its
  // end); if the slide item was removed, drop the slide clock.
  useEffect(() => {
    const slide = slideRef.current;
    if (!slide) return;
    const entry = layout.find((e) => e.itemId === slide.itemId);
    if (!entry) {
      slideRef.current = null;
      setActiveSlideId(null);
      return;
    }
    slide.timelineStart = entry.timelineStart;
    slide.timelineEnd = entry.timelineEnd;
  }, [layout]);

  const seek = useCallback(
    (t: number) => {
      const layoutNow = layoutRef.current;
      const hit = timelineToSource(layoutNow, t);
      if (!hit) return;
      const clamped = Math.max(0, Math.min(t, layoutDuration(layoutNow)));
      if (hit.entry.kind === "slide") {
        // Seeking into a slide sets the consumed offset without seeking the <video>.
        enterSlide(hit.entry, clamped - hit.entry.timelineStart);
      } else {
        if (slideRef.current) exitSlide();
        seekVideoToSource(hit.sourceTime);
        // Setting currentTime on an already-playing <video> keeps it playing at the new
        // position, so a normal scrub needs no play() call. The ruler scrubber fires
        // seek() on every pointermove; calling play() each time interrupts the previous
        // play() promise (AbortError) and can leave the element paused while `playing`
        // stays true — the freeze the user hit. Only resume when the element is actually
        // paused (coming off a slide, or self-healing a desync).
        if (playingRef.current && videoRef.current?.paused) {
          void videoRef.current.play().catch(() => {});
        }
      }
      setTimelineTime(clamped);
      emitTime(clamped);
    },
    [enterSlide, exitSlide, seekVideoToSource, emitTime],
  );

  const play = useCallback(() => {
    playingRef.current = true;
    const entry = entryAt(layoutRef.current, timelineTimeRef.current);
    if (entry?.kind === "slide") {
      // Start (or resume) the slide clock. Re-anchor without losing consumed time when
      // resuming the same slide; otherwise enter it fresh from the current offset.
      if (slideRef.current?.itemId === entry.itemId) {
        slideRef.current.anchorAt = performance.now();
      } else {
        enterSlide(entry, timelineTimeRef.current - entry.timelineStart);
      }
    } else {
      if (slideRef.current) exitSlide();
      const video = videoRef.current;
      if (video) {
        void video.play().catch(() => {
          // The element refused to play (commonly an in-flight seek interrupting the
          // request). Never leave a stuck playing=true over a paused element — reset so
          // the transport shows "play" and the next click cleanly retries. onVideoPlay
          // flips it back to true once playback actually starts.
          playingRef.current = false;
          setPlaying(false);
        });
      }
    }
    setPlaying(true);
  }, [enterSlide, exitSlide]);

  const pause = useCallback(() => {
    playingRef.current = false;
    const slide = slideRef.current;
    if (slide && slide.anchorAt !== null) {
      // Freeze the consumed offset so resuming does not burn slide time.
      slide.consumed += (performance.now() - slide.anchorAt) / 1000;
      slide.anchorAt = null;
    } else if (!slide) {
      videoRef.current?.pause();
    }
    setPlaying(false);
  }, []);

  const toggle = useCallback(() => {
    playingRef.current ? pause() : play();
  }, [play, pause]);

  const toggleMute = useCallback(() => {
    setMuted((prev) => !prev);
  }, []);

  // Apply muted state imperatively: React's JSX `muted` attribute is only read during
  // initial mount and is not reflected back to the DOM property on updates. Setting
  // `video.muted` directly via the ref ensures the audio state stays consistent with
  // the UI toggle across re-renders and source changes.
  useEffect(() => {
    const video = videoRef.current;
    if (video) video.muted = muted;
  }, [muted]);

  const onVideoTimeUpdate = useCallback(() => {
    // While a slide owns the clock the video is paused; ignore any trailing timeupdate.
    if (slideRef.current !== null) return;
    const video = videoRef.current;
    if (!video) return;
    if (internalSeekRef.current) {
      internalSeekRef.current = false;
      return;
    }
    const layoutNow = layoutRef.current;
    const sourceT = video.currentTime;
    const t = sourceToTimeline(layoutNow, sourceT);

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
  }, [pause, seekVideoToSource, advanceFrom]);

  const onVideoEnded = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    setTimelineTime(layoutDuration(layoutRef.current));
  }, []);

  // The <video>'s own play/pause events are the source of truth for clip playback. If a
  // play() request is rejected the element stays paused; syncing from these events keeps
  // `playing` matching reality, so the transport button can never get stuck showing
  // "pause" while nothing plays. A slide intentionally pauses the video while its wall
  // clock runs, so video events are ignored whenever a slide owns the clock.
  const onVideoPlay = useCallback(() => {
    if (slideRef.current !== null) return;
    playingRef.current = true;
    setPlaying(true);
  }, []);

  const onVideoPause = useCallback(() => {
    if (slideRef.current !== null) return;
    playingRef.current = false;
    setPlaying(false);
  }, []);

  const subscribeTime = useCallback((listener: (t: number) => void) => {
    listenersRef.current.add(listener);
    return () => listenersRef.current.delete(listener);
  }, []);

  return {
    videoRef,
    playing,
    muted,
    duration,
    timelineTime,
    activeSlideId,
    play,
    pause,
    toggle,
    toggleMute,
    seek,
    onVideoTimeUpdate,
    onVideoEnded,
    onVideoPlay,
    onVideoPause,
    subscribeTime,
  };
}
