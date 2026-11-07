import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAudible, type AudioEdits } from "./audio-edits";
import { DEFAULT_SPEED } from "./playback-speed";
import {
  clipAtSource,
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
  /** Preview playback rate (0.5, 1, 1.5, 2). View state: never saved, never exported. */
  speed: number;
  duration: number;
  timelineTime: number;
  /** Slide entry under the playhead, else null — the page maps this to the image URL. */
  activeSlideId: string | null;
  play(): void;
  pause(): void;
  toggle(): void;
  /** Toggle preview audio mute — does NOT affect the exported file. */
  toggleMute(): void;
  /** Set the preview rate. Preview only — the exported file is always at 1x. */
  setSpeed(speed: number): void;
  seek(t: number): void;
  onVideoTimeUpdate(): void;
  onVideoEnded(): void;
  /** Wire to the <video>'s `loadedmetadata` event: a new `src` resets the element's rate,
   *  so the chosen speed is applied again once the new source is ready. */
  onVideoLoadedMetadata(): void;
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
 * time at 1x). At another preview speed the wall time scales: `consumed` and the running
 * part are timeline seconds, `running = wall seconds × speed`, and a speed change
 * re-anchors (folds the running part into `consumed`) so the time never jumps. `timelineStart`/`timelineEnd` mirror the slide's layout bounds and are refreshed
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

/** Timeline seconds a slide has played: the frozen part plus the running part, which is
 *  wall time scaled by the preview speed. */
function slideElapsed(slide: ActiveSlide, speed: number): number {
  const running = slide.anchorAt !== null ? (performance.now() - slide.anchorAt) / 1000 : 0;
  return slide.consumed + running * speed;
}

/**
 * `audio` is the scene's muting — the whole-video flag and the muted ranges. The
 * preview reads it per frame so what you hear while scrubbing is what the export
 * will write; without this the editor would show a muted range and play sound
 * straight through it, which is what happened before this existed.
 */
export function usePreviewPlayback(layout: LayoutEntry[], audio?: AudioEdits): PreviewPlayback {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Kept in a ref so the rAF loop reads the latest edits without re-subscribing
  // on every drag of a range handle.
  const audioRef = useRef<AudioEdits | undefined>(audio);
  audioRef.current = audio;
  const internalSeekRef = useRef(false);
  const listenersRef = useRef(new Set<(t: number) => void>());
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  mutedRef.current = muted;
  // Preview speed. State for the button label, a ref for the rAF loop and the handlers.
  const [speed, setSpeedState] = useState<number>(DEFAULT_SPEED);
  const speedRef = useRef<number>(DEFAULT_SPEED);

  /**
   * Put the chosen rate on the element. Loading a new `src` resets `playbackRate` to
   * `defaultPlaybackRate`, so both are set; `preservesPitch` keeps 2x from chipmunking.
   * Cheap and idempotent: called on speed changes, on loadedmetadata, when a slide hands
   * back to a clip, and per frame (writes only when the element disagrees).
   */
  const applyRate = useCallback((video: HTMLVideoElement) => {
    const rate = speedRef.current;
    if (video.defaultPlaybackRate !== rate) video.defaultPlaybackRate = rate;
    if (video.playbackRate !== rate) video.playbackRate = rate;
    if (video.preservesPitch !== true) video.preservesPitch = true;
  }, []);

  /**
   * The element is muted when EITHER the user muted the preview OR the scene
   * mutes this instant. `video.currentTime` is source time (the element plays
   * the original file), which is what the ranges are anchored to.
   */
  const applyMute = useCallback((video: HTMLVideoElement, userMuted: boolean) => {
    const edits = audioRef.current;
    const silenced = edits ? !isAudible(video.currentTime, edits) : false;
    video.muted = userMuted || silenced;
  }, []);

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

  // The clip entry the <video> is playing (null on a slide, at the end, or before the
  // first frame). Set by every transition that moves the video — seek, hand-off, drift
  // snap — and refreshed by each frame/timeupdate. A playhead that jumped over a cut can
  // no longer be traced back to its clip by source time (it may map into the next clip,
  // or into deleted footage), so the clip it was in is remembered here.
  const activeClipIdRef = useRef<string | null>(null);

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
    activeClipIdRef.current = null;
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
        activeClipIdRef.current = null;
        playingRef.current = false;
        setPlaying(false);
        videoRef.current?.pause();
        const end = layoutDuration(layoutNow);
        lastValidTimeRef.current = end;
        setTimelineTime(end);
        emitTime(end);
        return;
      }
      if (next.kind === "slide") {
        enterSlide(next, 0);
      } else {
        exitSlide();
        activeClipIdRef.current = next.itemId;
        seekVideoToSource(next.sourceStart);
        // Coming off a slide the video was paused — resume it if we're still playing.
        const video = videoRef.current;
        if (video) applyRate(video);
        if (playingRef.current) void video?.play().catch(() => {});
      }
      lastValidTimeRef.current = next.timelineStart;
      setTimelineTime(next.timelineStart);
      emitTime(next.timelineStart);
    },
    [enterSlide, exitSlide, seekVideoToSource, emitTime, applyRate],
  );

  /**
   * The clip the <video> is playing, remembered in `activeClipIdRef`. Normally the
   * remembered one: a time past its cut maps to deleted footage or straight into a later
   * clip, so the position alone cannot name the clip it just left. Only a video sitting
   * before the remembered clip (or with nothing remembered) is resolved by position.
   */
  const resolveActiveClip = useCallback((video: HTMLVideoElement): LayoutEntry | undefined => {
    const layoutNow = layoutRef.current;
    const sourceT = video.currentTime;
    const tracked = layoutNow.find(
      (e) => e.kind === "clip" && e.itemId === activeClipIdRef.current,
    );
    const entry =
      tracked && sourceT >= tracked.sourceStart - END_EPSILON
        ? tracked
        : clipAtSource(layoutNow, sourceT);
    activeClipIdRef.current = entry?.itemId ?? null;
    return entry;
  }, []);

  /**
   * Hand off to the next entry once the <video> reaches the cut of the clip it is playing.
   * Both clip clocks call this — the rAF loop every frame, `timeupdate` as the fallback
   * (it keeps firing in a hidden window, where rAF stops). `timeupdate` alone fires only
   * about every 250 ms, so playback ran past a cut by that long (500 ms at 2x): deleted
   * footage played, and a slide or a short gap could be jumped over entirely.
   *
   * A next clip that continues the same footage (a plain split: X [0..5], Y [5..10]) needs
   * no seek — the element is already playing Y's first frame. Seeking there would stall
   * the video and drop the audio for a few milliseconds at every split, so the hand-off
   * only moves the bookkeeping on. A gap in source (deleted footage between) or a slide
   * still goes through `advanceFrom`.
   *
   * Idempotent: the hand-off moves the ref on (next clip, or null for a slide / the end),
   * and it only fires while playing, so a second caller for the same cut finds nothing
   * left to do. Returns true when it advanced; the caller must then leave the playhead
   * to this function (it has already reported the new time).
   */
  const handOffAtCut = useCallback(
    (video: HTMLVideoElement): boolean => {
      const entry = resolveActiveClip(video);
      if (!entry || !playingRef.current || video.currentTime < entry.sourceEnd - END_EPSILON) {
        return false;
      }
      const layoutNow = layoutRef.current;
      const next = layoutNow[layoutNow.findIndex((e) => e.itemId === entry.itemId) + 1];
      if (
        next &&
        next.kind === "clip" &&
        Math.abs(next.sourceStart - entry.sourceEnd) < END_EPSILON
      ) {
        activeClipIdRef.current = next.itemId;
        // Where the element is inside the next clip, never behind what was last reported
        // (a clip starting a few ms after the cut would otherwise step the playhead back).
        const t = Math.min(
          next.timelineEnd,
          Math.max(
            lastValidTimeRef.current,
            next.timelineStart + (video.currentTime - next.sourceStart),
          ),
        );
        lastValidTimeRef.current = t;
        setTimelineTime(t);
        emitTime(t);
        return true;
      }
      advanceFrom(entry.timelineEnd);
      return true;
    },
    [resolveActiveClip, advanceFrom, emitTime],
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
        const t = slide.timelineStart + slideElapsed(slide, speedRef.current);
        if (t >= slide.timelineEnd - END_EPSILON) {
          advanceFrom(slide.timelineEnd);
        } else {
          lastValidTimeRef.current = t;
          emitTime(t);
        }
      } else {
        const video = videoRef.current;
        if (video) {
          applyMute(video, mutedRef.current);
          applyRate(video);
        }
        // A frame that finds the clip at its cut hands off right here (the hand-off reports
        // the new playhead itself); otherwise it just reports where the video is.
        if (!(video && handOffAtCut(video))) {
          const mapped = video ? sourceToTimeline(layoutRef.current, video.currentTime) : null;
          if (mapped !== null) lastValidTimeRef.current = mapped;
          emitTime(lastValidTimeRef.current);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, emitTime, advanceFrom, handOffAtCut, applyMute, applyRate]);

  // The video's `timeupdate` drives `timelineTime` state on clips; slides get no such
  // event, so update the state on a low-frequency interval while one is active (the rAF
  // loop already handles the smooth playhead via emitTime).
  useEffect(() => {
    if (activeSlideId === null || !playing) return;
    const id = setInterval(() => {
      const slide = slideRef.current;
      if (!slide) return;
      const t = slide.timelineStart + slideElapsed(slide, speedRef.current);
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
        if (videoRef.current) applyRate(videoRef.current);
        activeClipIdRef.current = hit.entry.itemId;
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
    [enterSlide, exitSlide, seekVideoToSource, emitTime, applyRate],
  );

  const play = useCallback(() => {
    // Playing from the layout end restarts, like a native `ended` element does. The
    // hand-off stops the element up to END_EPSILON before its own end (so `ended` never
    // fires) and the playhead rests at the end; resuming from there would hand off again
    // on the first frame and the button would flicker. Done before `playingRef` flips so
    // the seek only positions the element and play() below is the one that starts it.
    let from = timelineTimeRef.current;
    const layoutNow = layoutRef.current;
    if (layoutNow.length > 0 && from >= layoutDuration(layoutNow) - END_EPSILON) {
      seek(0);
      from = 0;
    }
    playingRef.current = true;
    const entry = entryAt(layoutRef.current, from);
    if (entry?.kind === "slide") {
      // Start (or resume) the slide clock. Re-anchor without losing consumed time when
      // resuming the same slide; otherwise enter it fresh from the current offset.
      if (slideRef.current?.itemId === entry.itemId) {
        slideRef.current.anchorAt = performance.now();
      } else {
        enterSlide(entry, from - entry.timelineStart);
      }
    } else {
      if (slideRef.current) exitSlide();
      const video = videoRef.current;
      if (video) {
        applyRate(video);
        resolveActiveClip(video); // know the clip from the first frame on, not the second
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
  }, [enterSlide, exitSlide, applyRate, resolveActiveClip, seek]);

  const pause = useCallback(() => {
    playingRef.current = false;
    const slide = slideRef.current;
    if (slide && slide.anchorAt !== null) {
      // Freeze the consumed offset so resuming does not burn slide time.
      slide.consumed = slideElapsed(slide, speedRef.current);
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

  const setSpeed = useCallback(
    (next: number) => {
      // Re-anchor a running slide at the old speed first, so the time already played is
      // kept and only what follows runs at the new one.
      const slide = slideRef.current;
      if (slide && slide.anchorAt !== null) {
        slide.consumed = slideElapsed(slide, speedRef.current);
        slide.anchorAt = performance.now();
      }
      speedRef.current = next;
      setSpeedState(next);
      if (videoRef.current) applyRate(videoRef.current);
    },
    [applyRate],
  );

  const onVideoLoadedMetadata = useCallback(() => {
    if (videoRef.current) applyRate(videoRef.current);
  }, [applyRate]);

  // Apply muted state imperatively: React's JSX `muted` attribute is only read during
  // initial mount and is not reflected back to the DOM property on updates. Setting
  // `video.muted` directly via the ref ensures the audio state stays consistent with
  // the UI toggle across re-renders and source changes. Re-run when the edits
  // change too, so toggling "mute all" or dragging a range over the paused
  // playhead is heard immediately rather than at the next tick.
  useEffect(() => {
    const video = videoRef.current;
    if (video) applyMute(video, muted);
  }, [muted, audio, applyMute]);

  const onVideoTimeUpdate = useCallback(() => {
    // While a slide owns the clock the video is paused; ignore any trailing timeupdate.
    if (slideRef.current !== null) return;
    const video = videoRef.current;
    if (!video) return;
    applyMute(video, mutedRef.current);
    if (internalSeekRef.current) {
      internalSeekRef.current = false;
      return;
    }
    // The fallback for a frame that never came (hidden window) or lost the race.
    if (handOffAtCut(video)) return;
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
        activeClipIdRef.current = target.itemId;
        seekVideoToSource(target.sourceStart);
        setTimelineTime(target.timelineStart);
      } else {
        pause();
        setTimelineTime(layoutDuration(layoutNow));
      }
      return;
    }

    setTimelineTime(t);
  }, [pause, seekVideoToSource, handOffAtCut, applyMute]);

  const onVideoEnded = useCallback(() => {
    // A slide owns the clock: an `ended` queued by the clip before it (the hand-off beat
    // the event) must not stop playback or snap the time to the end under the slide.
    if (slideRef.current !== null) return;
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

  return useMemo(
    () => ({
      videoRef,
      playing,
      muted,
      speed,
      duration,
      timelineTime,
      activeSlideId,
      play,
      pause,
      toggle,
      toggleMute,
      setSpeed,
      seek,
      onVideoTimeUpdate,
      onVideoEnded,
      onVideoLoadedMetadata,
      onVideoPlay,
      onVideoPause,
      subscribeTime,
    }),
    [
      videoRef,
      playing,
      muted,
      speed,
      duration,
      timelineTime,
      activeSlideId,
      play,
      pause,
      toggle,
      toggleMute,
      setSpeed,
      seek,
      onVideoTimeUpdate,
      onVideoEnded,
      onVideoLoadedMetadata,
      onVideoPlay,
      onVideoPause,
      subscribeTime,
    ],
  );
}
