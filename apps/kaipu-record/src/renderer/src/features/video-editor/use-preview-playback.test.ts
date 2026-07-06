import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrackItem } from "./scene";
import { toLayout } from "./timeline";
import { usePreviewPlayback } from "./use-preview-playback";

const clip = (id: string, sourceStart: number, sourceEnd: number): TrackItem => ({
  id,
  kind: "clip",
  sourceStart,
  sourceEnd,
});

const slide = (id: string, duration: number): TrackItem => ({
  id,
  kind: "slide",
  assetId: `asset-${id}`,
  duration,
  naturalWidth: 800,
  naturalHeight: 600,
});

// clip 0-5 (source 0-5), a 3s slide, then clip 20-25 — a deleted middle (5..20 in
// source time) sits between the two clips, independent of the slide on the timeline.
// toLayout: a: timeline 0-5, s1: timeline 5-8, b: timeline 8-13 (source 20-25).
const ITEMS: TrackItem[] = [clip("a", 0, 5), slide("s1", 3), clip("b", 20, 25)];
const layout = toLayout(ITEMS);

/** Minimal stand-in for the <video> element the hook drives — a plain object (not a
 *  real HTMLVideoElement) with just the members use-preview-playback.ts touches. */
function makeVideo(): HTMLVideoElement {
  return {
    currentTime: 0,
    paused: true,
    muted: false,
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
  } as unknown as HTMLVideoElement;
}

/** A fake <video> whose play()/pause() actually flip `paused`, so tests can assert
 *  the real "is it playing?" state after a seek (makeVideo's play/pause don't). */
function makePlayableVideo(): HTMLVideoElement {
  const video = {
    currentTime: 0,
    paused: true,
    muted: false,
    play: vi.fn(() => {
      video.paused = false;
      return Promise.resolve();
    }),
    pause: vi.fn(() => {
      video.paused = true;
    }),
  };
  return video as unknown as HTMLVideoElement;
}

// A controllable wall clock: `now` stands in for performance.now() (ms). `advance`
// moves it forward and flushes vitest's fake timers, which drive both the rAF loop
// and the slide's low-frequency setInterval — so both read the same, final `now`
// for every callback invoked during the flush (no incremental drift).
let now = 0;

function advance(ms: number): void {
  now += ms;
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  now = 0;
  vi.useFakeTimers();
  vi.spyOn(performance, "now").mockImplementation(() => now);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("usePreviewPlayback — slide clock", () => {
  it("seeking into a slide sets activeSlideId and pauses the video without seeking it", () => {
    const { result } = renderHook(() => usePreviewPlayback(layout));
    const video = makeVideo();
    result.current.videoRef.current = video;

    act(() => result.current.seek(6)); // 1s into the 3s slide (timeline 5..8)

    expect(result.current.activeSlideId).toBe("s1");
    expect(video.pause).toHaveBeenCalledTimes(1);
    // A slide holds whatever frame the video already has — it is never sought.
    expect(video.currentTime).toBe(0);
  });

  it("playing across a slide advances the timeline by wall-clock time", () => {
    const { result } = renderHook(() => usePreviewPlayback(layout));
    const video = makeVideo();
    result.current.videoRef.current = video;
    const times: number[] = [];
    result.current.subscribeTime((t) => times.push(t));

    act(() => result.current.seek(5)); // land exactly at the slide's start
    act(() => result.current.play());

    advance(1000); // 1 real second

    expect(result.current.timelineTime).toBeCloseTo(6, 1);
    expect(times.at(-1)).toBeCloseTo(6, 1);
  });

  it("pausing during a slide freezes consumed time; resuming does not burn the paused interval", () => {
    const { result } = renderHook(() => usePreviewPlayback(layout));
    const video = makeVideo();
    result.current.videoRef.current = video;

    act(() => result.current.seek(5));
    act(() => result.current.play());
    advance(1000); // 1s of the slide played
    act(() => result.current.pause());

    advance(2000); // 2 real seconds pass while paused — must not count toward the slide

    act(() => result.current.play()); // resume
    advance(500); // 0.5s more played

    // Total slide time actually played: 1s + 0.5s = 1.5s → timeline sits at 5 + 1.5,
    // NOT 5 + 1 + 2 + 0.5 (which would mean the pause burned slide time).
    expect(result.current.timelineTime).toBeCloseTo(6.5, 1);
  });

  it("advances past the slide once its playing duration elapses, seeking the next clip", () => {
    const { result } = renderHook(() => usePreviewPlayback(layout));
    const video = makeVideo();
    result.current.videoRef.current = video;

    act(() => result.current.seek(7.9)); // 0.1s left of the 3s slide
    act(() => result.current.play());

    advance(200); // enough to cross the slide's end (7.9 + 0.2 > 8)

    expect(result.current.activeSlideId).toBeNull();
    expect(video.currentTime).toBe(20); // sought to clip b's sourceStart
    expect(video.play).toHaveBeenCalled();
  });

  it("running a clip to its cut boundary chains directly into the following slide", () => {
    const { result } = renderHook(() => usePreviewPlayback(layout));
    const video = makeVideo();
    result.current.videoRef.current = video;

    act(() => result.current.play()); // starts on clip "a" at t=0
    video.currentTime = 4.99; // a realistic near-cut timeupdate, just short of a's sourceEnd (5)
    act(() => result.current.onVideoTimeUpdate());

    expect(result.current.activeSlideId).toBe("s1");
    expect(video.pause).toHaveBeenCalled(); // entering the slide pauses the video
  });

  it("reseeks correctly when native playback drifts into deleted footage between two clips (gap-skip)", () => {
    const { result } = renderHook(() => usePreviewPlayback(layout));
    const video = makeVideo();
    result.current.videoRef.current = video;
    // 10s of source sits in the deleted middle: past clip a's end (5), before clip
    // b's start (20). No slide is active, so onVideoTimeUpdate must own this case.
    video.currentTime = 10;

    act(() => result.current.onVideoTimeUpdate());

    expect(video.currentTime).toBe(20); // snapped forward to clip b's sourceStart
    expect(result.current.timelineTime).toBe(8); // clip b's timelineStart
  });
});

describe("usePreviewPlayback — mute", () => {
  it("starts unmuted by default", () => {
    const { result } = renderHook(() => usePreviewPlayback(layout));
    expect(result.current.muted).toBe(false);
  });

  it("toggleMute flips muted state", () => {
    const { result } = renderHook(() => usePreviewPlayback(layout));

    act(() => result.current.toggleMute());
    expect(result.current.muted).toBe(true);

    act(() => result.current.toggleMute());
    expect(result.current.muted).toBe(false);
  });

  it("toggleMute sets video.muted imperatively via the videoRef", () => {
    const { result } = renderHook(() => usePreviewPlayback(layout));
    const video = makeVideo();
    // Attach the mock video element before toggling so the effect can write to it.
    result.current.videoRef.current = video;

    act(() => result.current.toggleMute());
    expect(video.muted).toBe(true);

    act(() => result.current.toggleMute());
    expect(video.muted).toBe(false);
  });
});

describe("usePreviewPlayback — scrubbing keeps playback alive", () => {
  it("seeking within a clip while playing keeps it playing WITHOUT re-invoking play()", () => {
    const { result } = renderHook(() => usePreviewPlayback(layout));
    const video = makePlayableVideo();
    result.current.videoRef.current = video;

    act(() => result.current.play()); // playing clip a (paused -> false)
    expect(video.paused).toBe(false);
    (video.play as ReturnType<typeof vi.fn>).mockClear();

    act(() => result.current.seek(3)); // scrub within clip a while playing

    // Setting currentTime on an already-playing <video> keeps it playing; calling
    // play() again here is what spammed interrupted (AbortError) plays during a ruler
    // drag and froze playback. So: no play() call, still playing, at the new position.
    expect(video.currentTime).toBe(3);
    expect(video.paused).toBe(false);
    expect(video.play).not.toHaveBeenCalled();
  });

  it("play() reliably resumes after scrubbing far while playing (the reported freeze)", () => {
    const { result } = renderHook(() => usePreviewPlayback(layout));
    const video = makePlayableVideo();
    result.current.videoRef.current = video;

    act(() => result.current.play());
    act(() => result.current.seek(4)); // scrub while playing
    expect(video.paused).toBe(false); // still playing, not frozen
    act(() => result.current.pause());
    expect(video.paused).toBe(true);
    act(() => result.current.play()); // resume
    expect(video.paused).toBe(false); // recovers — pause/play works after a scrub
  });

  it("seeking while paused does not start playback", () => {
    const { result } = renderHook(() => usePreviewPlayback(layout));
    const video = makePlayableVideo();
    result.current.videoRef.current = video;

    act(() => result.current.seek(3)); // paused the whole time
    expect(video.currentTime).toBe(3);
    expect(video.paused).toBe(true);
    expect(video.play).not.toHaveBeenCalled();
  });

  it("seeking from a slide to a clip while playing resumes the paused video", () => {
    const { result } = renderHook(() => usePreviewPlayback(layout));
    const video = makePlayableVideo();
    result.current.videoRef.current = video;

    act(() => result.current.seek(6)); // into slide s1 (timeline 5..8) — video paused
    act(() => result.current.play()); // slide plays on its own clock; video stays paused
    expect(video.paused).toBe(true);
    (video.play as ReturnType<typeof vi.fn>).mockClear();

    act(() => result.current.seek(2)); // scrub back onto clip a while playing

    expect(video.currentTime).toBe(2);
    expect(video.play).toHaveBeenCalled(); // came off a slide (paused) → explicit resume
    expect(video.paused).toBe(false);
  });
});

describe("usePreviewPlayback — play/pause stays in sync with the element", () => {
  it("resets to paused when the element rejects play(), so the button can retry", async () => {
    const { result } = renderHook(() => usePreviewPlayback(layout));
    // A <video> that refuses to start (e.g. a play() interrupted by an in-flight seek).
    const video = {
      currentTime: 0,
      paused: true,
      muted: false,
      play: vi.fn(() => Promise.reject(new DOMException("interrupted", "AbortError"))),
      pause: vi.fn(),
    } as unknown as HTMLVideoElement;
    result.current.videoRef.current = video;

    await act(async () => {
      result.current.play();
      await Promise.resolve(); // flush the play() promise rejection
    });

    // The reported freeze: a rejected play() must NOT leave a stuck playing=true state —
    // it resets so the transport shows "play" and the next click cleanly retries.
    expect(result.current.playing).toBe(false);
  });

  it("onVideoPlay / onVideoPause mirror the element's real state", () => {
    const { result } = renderHook(() => usePreviewPlayback(layout));
    const video = makePlayableVideo();
    result.current.videoRef.current = video;

    act(() => result.current.onVideoPlay());
    expect(result.current.playing).toBe(true);

    act(() => result.current.onVideoPause()); // element paused on its own
    expect(result.current.playing).toBe(false);
  });

  it("ignores video pause events while a slide owns the clock", () => {
    const { result } = renderHook(() => usePreviewPlayback(layout));
    const video = makePlayableVideo();
    result.current.videoRef.current = video;

    act(() => result.current.seek(5)); // land at the slide start
    act(() => result.current.play()); // slide playing; the video is paused underneath
    expect(result.current.playing).toBe(true);

    // enterSlide paused the <video>, which fires 'pause' — it must NOT stop the slide.
    act(() => result.current.onVideoPause());
    expect(result.current.playing).toBe(true);
  });
});
