import { act, renderHook } from "@testing-library/react";
import { useMemo } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrackItem } from "./scene";
import { removeItem, splitClipAt, toLayout, trimClip } from "./timeline";
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

describe("edit-driven muting (the scene's muted ranges reach the preview)", () => {
  const items: TrackItem[] = [{ id: "a", kind: "clip", sourceStart: 0, sourceEnd: 30 }];
  const layout = toLayout(items);
  const range = { id: "m", sourceStart: 10, sourceEnd: 15 };

  it("mutes the element inside a muted range and not outside it", () => {
    const video = makeVideo();
    const { result } = renderHook(() =>
      usePreviewPlayback(layout, { audioMuted: false, mutedRanges: [range] }),
    );
    result.current.videoRef.current = video;

    video.currentTime = 12;
    act(() => result.current.onVideoTimeUpdate());
    expect(video.muted).toBe(true);

    video.currentTime = 20;
    act(() => result.current.onVideoTimeUpdate());
    expect(video.muted).toBe(false);
  });

  it("mutes everywhere when the whole recording is muted", () => {
    const video = makeVideo();
    const { result } = renderHook(() =>
      usePreviewPlayback(layout, { audioMuted: true, mutedRanges: [] }),
    );
    result.current.videoRef.current = video;
    for (const t of [0, 12, 29]) {
      video.currentTime = t;
      act(() => result.current.onVideoTimeUpdate());
      expect(video.muted, `at ${t}`).toBe(true);
    }
  });

  it("keeps the user's own mute independent — either one silences", () => {
    const video = makeVideo();
    const { result } = renderHook(() =>
      usePreviewPlayback(layout, { audioMuted: false, mutedRanges: [range] }),
    );
    result.current.videoRef.current = video;

    // Outside the range, the user's toggle is the only thing that can mute.
    video.currentTime = 20;
    act(() => result.current.toggleMute());
    expect(video.muted).toBe(true);
    // Un-muting outside the range unmutes…
    act(() => result.current.toggleMute());
    expect(video.muted).toBe(false);
    // …but un-muting INSIDE the range cannot override the edit.
    video.currentTime = 12;
    act(() => result.current.onVideoTimeUpdate());
    expect(video.muted).toBe(true);
  });

  it("re-applies when the edits change while paused on the spot", () => {
    const video = makeVideo();
    const { result, rerender } = renderHook(({ audio }) => usePreviewPlayback(layout, audio), {
      initialProps: { audio: { audioMuted: false, mutedRanges: [] as (typeof range)[] } },
    });
    result.current.videoRef.current = video;
    video.currentTime = 12;
    act(() => result.current.onVideoTimeUpdate());
    expect(video.muted).toBe(false);

    // A range is drawn over the paused playhead — heard at once, not at the next tick.
    rerender({ audio: { audioMuted: false, mutedRanges: [range] } });
    expect(video.muted).toBe(true);
  });

  it("stays audible with no edits at all (the old behaviour)", () => {
    const video = makeVideo();
    const { result } = renderHook(() => usePreviewPlayback(layout));
    result.current.videoRef.current = video;
    video.currentTime = 12;
    act(() => result.current.onVideoTimeUpdate());
    expect(video.muted).toBe(false);
  });
});

describe("usePreviewPlayback — playback speed (preview only)", () => {
  it("starts at 1x, and a new mount starts at 1x again (nothing is remembered)", () => {
    const first = renderHook(() => usePreviewPlayback(layout));
    expect(first.result.current.speed).toBe(1);
    act(() => first.result.current.setSpeed(2));
    expect(first.result.current.speed).toBe(2);
    first.unmount();

    const reopened = renderHook(() => usePreviewPlayback(layout));
    expect(reopened.result.current.speed).toBe(1);
  });

  it("sets the rate on the element, keeps the pitch, and makes it the rate a new source starts at", () => {
    const { result } = renderHook(() => usePreviewPlayback(layout));
    const video = makeVideo();
    result.current.videoRef.current = video;

    act(() => result.current.setSpeed(1.5));

    expect(video.playbackRate).toBe(1.5);
    // Loading a new src resets playbackRate to defaultPlaybackRate, so that follows too.
    expect(video.defaultPlaybackRate).toBe(1.5);
    expect(video.preservesPitch).toBe(true);
  });

  it("re-applies the rate when the element reports loaded metadata (the src changed)", () => {
    const { result } = renderHook(() => usePreviewPlayback(layout));
    const video = makeVideo();
    result.current.videoRef.current = video;
    act(() => result.current.setSpeed(2));

    video.playbackRate = 1; // what a src change does to the element
    act(() => result.current.onVideoLoadedMetadata());

    expect(video.playbackRate).toBe(2);
  });

  it("applies a rate chosen before the element existed once its metadata lands", () => {
    const { result } = renderHook(() => usePreviewPlayback(layout));
    act(() => result.current.setSpeed(0.5));
    const video = makeVideo();
    result.current.videoRef.current = video;

    act(() => result.current.onVideoLoadedMetadata());

    expect(video.playbackRate).toBe(0.5);
  });

  it("restores the rate on the next frame if a src change reset it mid-playback", () => {
    const { result } = renderHook(() => usePreviewPlayback(layout));
    const video = makePlayableVideo();
    result.current.videoRef.current = video;
    act(() => result.current.setSpeed(2));
    act(() => result.current.play());

    video.playbackRate = 1;
    advance(50);

    expect(video.playbackRate).toBe(2);
  });

  it("a slide at 2x holds duration / speed seconds of wall time", () => {
    const { result } = renderHook(() => usePreviewPlayback(layout));
    result.current.videoRef.current = makeVideo();
    act(() => result.current.setSpeed(2));
    act(() => result.current.seek(5)); // start of the 3 s slide
    act(() => result.current.play());

    advance(1400); // 2.8 timeline seconds: still inside the slide
    expect(result.current.activeSlideId).toBe("s1");
    expect(result.current.timelineTime).toBeCloseTo(7.8, 1);

    advance(200); // 1.6 s of wall time: the 3 s slide is over
    expect(result.current.activeSlideId).toBeNull();
  });

  it("a slide at 0.5x holds twice as long", () => {
    const { result } = renderHook(() => usePreviewPlayback(layout));
    result.current.videoRef.current = makeVideo();
    act(() => result.current.setSpeed(0.5));
    act(() => result.current.seek(5));
    act(() => result.current.play());

    advance(5000); // 2.5 timeline seconds
    expect(result.current.activeSlideId).toBe("s1");

    advance(1200); // 6.2 s of wall time
    expect(result.current.activeSlideId).toBeNull();
  });

  it("pause and resume at 2x do not burn or invent slide time", () => {
    const { result } = renderHook(() => usePreviewPlayback(layout));
    result.current.videoRef.current = makeVideo();
    act(() => result.current.setSpeed(2));
    act(() => result.current.seek(5));
    act(() => result.current.play());
    advance(500); // 1 timeline second
    act(() => result.current.pause());
    advance(2000);
    act(() => result.current.play());
    advance(250); // 0.5 timeline second

    expect(result.current.timelineTime).toBeCloseTo(6.5, 1);
  });

  it("changing speed mid-slide does not make the time jump", () => {
    const { result } = renderHook(() => usePreviewPlayback(layout));
    result.current.videoRef.current = makeVideo();
    const times: number[] = [];
    result.current.subscribeTime((t) => times.push(t));
    act(() => result.current.seek(5));
    act(() => result.current.play());
    advance(1000); // 1 timeline second at 1x
    expect(times.at(-1)).toBeCloseTo(6, 1);

    act(() => result.current.setSpeed(2));
    advance(250); // 0.5 timeline second at 2x -> 6.5, not (now - original anchor) * 2 = 7.5
    expect(times.at(-1)).toBeCloseTo(6.5, 1);
    expect(result.current.timelineTime).toBeCloseTo(6.5, 1);

    act(() => result.current.setSpeed(0.5));
    advance(500); // 0.25 timeline second at 0.5x
    expect(times.at(-1)).toBeCloseTo(6.75, 1);
  });

  it("changing speed while paused on a slide keeps the consumed time", () => {
    const { result } = renderHook(() => usePreviewPlayback(layout));
    result.current.videoRef.current = makeVideo();
    act(() => result.current.seek(6)); // 1 s into the slide, paused
    act(() => result.current.setSpeed(2));
    act(() => result.current.play());
    advance(250);

    expect(result.current.timelineTime).toBeCloseTo(6.5, 1);
  });

  it("the rate survives entering a slide and leaving it back to a clip", () => {
    const { result } = renderHook(() => usePreviewPlayback(layout));
    const video = makePlayableVideo();
    result.current.videoRef.current = video;
    act(() => result.current.setSpeed(2));
    act(() => result.current.seek(7.9)); // 0.1 s left of the slide
    act(() => result.current.play());

    video.playbackRate = 1; // the element lost it while the slide held the screen
    advance(100); // 0.2 timeline seconds: past the slide into clip b

    expect(result.current.activeSlideId).toBeNull();
    expect(video.playbackRate).toBe(2);
    expect(result.current.speed).toBe(2);
  });

  it("the rate is set again when a scrub leaves a slide for a clip", () => {
    const { result } = renderHook(() => usePreviewPlayback(layout));
    const video = makePlayableVideo();
    result.current.videoRef.current = video;
    act(() => result.current.setSpeed(1.5));
    act(() => result.current.seek(6)); // on the slide

    video.playbackRate = 1;
    act(() => result.current.seek(2)); // back onto clip a

    expect(video.playbackRate).toBe(1.5);
  });
});

/** A fake <video> that records every seek the hook makes (each assignment to `currentTime`)
 *  and lets a test move the playback position WITHOUT counting it as a seek: `playTo` stands
 *  in for the decoder advancing between two animation frames. */
function makeSeekRecordingVideo() {
  let position = 0;
  const seeks: number[] = [];
  const video = {
    get currentTime() {
      return position;
    },
    set currentTime(value: number) {
      position = value;
      seeks.push(value);
    },
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
  return {
    video: video as unknown as HTMLVideoElement,
    seeks,
    playTo(t: number) {
      position = t;
    },
  };
}

/** One animation frame of the fake rAF (it ticks every 16 ms). */
const frame = (): void => advance(17);

function setupCutRig(items: TrackItem[], speed: number) {
  const cutLayout = toLayout(items);
  const hook = renderHook(() => usePreviewPlayback(cutLayout));
  const rig = makeSeekRecordingVideo();
  hook.result.current.videoRef.current = rig.video;
  act(() => hook.result.current.setSpeed(speed));
  return { ...hook, ...rig };
}

// clip a (source 0-5) → 3 s slide → clip b. The slide sits at timeline 5-8.
const GAP_THEN_SLIDE = [clip("a", 0, 5), slide("s1", 3), clip("b", 20, 25)];
const CONTIGUOUS_THEN_SLIDE = [clip("a", 0, 5), slide("s1", 3), clip("b", 5, 10)];
// clip a, deleted footage (source 5-20), clip b — no slide between them.
const GAP_NO_SLIDE = [clip("a", 0, 5), clip("b", 20, 25)];

describe.each([0.5, 1, 1.5, 2])(
  "usePreviewPlayback — a clip's cut is caught per frame, at %sx",
  (speed) => {
    // `timeupdate` fires about every 250 ms, so playback runs past a cut by up to 250 ms
    // (500 ms at 2x) before anything reacts. The rAF loop must notice the cut itself.
    const slideWallMs = (3 / speed) * 1000;

    it("enters the slide instead of skipping it when currentTime jumps over the cut between two frames (source gap)", () => {
      const { result, video, seeks, playTo } = setupCutRig(GAP_THEN_SLIDE, speed);
      act(() => result.current.play());
      playTo(4.8);
      frame();
      expect(result.current.activeSlideId).toBeNull();

      playTo(5.3); // 0.5 s in one go, and NO timeupdate in between

      frame();
      expect(result.current.activeSlideId).toBe("s1");
      expect(video.paused).toBe(true);
      expect(result.current.timelineTime).toBe(5);
      expect(seeks).toEqual([]); // the slide holds the screen; the video is not sought

      // The slide still holds duration / speed seconds of wall time, then clip b starts.
      advance(slideWallMs - 200);
      expect(result.current.activeSlideId).toBe("s1");
      advance(400);
      expect(result.current.activeSlideId).toBeNull();
      expect(seeks).toEqual([20]);
    });

    it("enters the slide instead of skipping it when clip b is contiguous in source", () => {
      const { result, video, seeks, playTo } = setupCutRig(CONTIGUOUS_THEN_SLIDE, speed);
      act(() => result.current.play());
      playTo(4.8);
      frame();

      playTo(5.3); // sourceToTimeline maps this straight into clip b (timeline 8.3)

      frame();
      expect(result.current.activeSlideId).toBe("s1");
      expect(video.paused).toBe(true);
      expect(result.current.timelineTime).toBe(5);

      advance(slideWallMs + 200);
      expect(result.current.activeSlideId).toBeNull();
      expect(seeks).toEqual([5]);
    });

    it("snaps to the next clip within one frame of crossing a cut with deleted footage after it", () => {
      const { result, video, seeks, playTo } = setupCutRig(GAP_NO_SLIDE, speed);
      const oneFrameOfPlayback = speed / 60;
      act(() => result.current.play());
      playTo(4.9);
      frame();
      expect(seeks).toEqual([]);

      playTo(5 + oneFrameOfPlayback); // the worst case now: one frame of deleted footage played

      frame();
      expect(seeks).toEqual([20]);
      expect(video.currentTime).toBe(20);
      expect(result.current.timelineTime).toBe(5); // clip b's timelineStart

      // Further frames play clip b; the hand-off must not fire again.
      playTo(20 + oneFrameOfPlayback);
      frame();
      frame();
      expect(seeks).toEqual([20]);
    });

    it("pauses at the layout end when the last clip reaches its cut", () => {
      const { result, video, seeks, playTo } = setupCutRig(GAP_THEN_SLIDE, speed);
      act(() => result.current.seek(8)); // start of the last clip, b (source 20)
      act(() => result.current.play());
      playTo(24.5);
      frame();
      expect(result.current.playing).toBe(true);

      playTo(24.99);

      frame();
      expect(result.current.playing).toBe(false);
      expect(result.current.timelineTime).toBe(13); // the layout end, never past it
      expect(result.current.activeSlideId).toBeNull();
      expect(video.pause).toHaveBeenCalled();
      expect(seeks).toEqual([20]); // only seek(8): nothing is sought past the end
    });
  },
);

describe("usePreviewPlayback — cut detection across seeks, pauses and timeupdate", () => {
  it("catches the cut after pausing and resuming inside the clip", () => {
    const { result, playTo } = setupCutRig(GAP_THEN_SLIDE, 2);
    act(() => result.current.play());
    playTo(4.5);
    frame();
    act(() => result.current.pause());
    advance(2000);
    act(() => result.current.play());

    playTo(5.3);
    frame();

    expect(result.current.activeSlideId).toBe("s1");
  });

  it("catches the cut of a clip entered by a seek into its middle", () => {
    const { result, seeks, playTo } = setupCutRig(GAP_THEN_SLIDE, 2);
    act(() => result.current.seek(2)); // middle of clip a
    act(() => result.current.play());
    playTo(4.8);
    frame();

    playTo(5.3);
    frame();

    expect(seeks).toEqual([2]);
    expect(result.current.activeSlideId).toBe("s1");
  });

  it("does not hand off from the old clip when a seek moves playback into another clip", () => {
    const { result, seeks, playTo } = setupCutRig(GAP_THEN_SLIDE, 1);
    act(() => result.current.play());
    playTo(4.5);
    frame();

    act(() => result.current.seek(10)); // timeline 10 is 2 s into clip b: source 22
    frame();
    frame();

    expect(seeks).toEqual([22]);
    expect(result.current.activeSlideId).toBeNull();
    expect(result.current.playing).toBe(true);
  });

  it("the timeupdate fallback also enters the slide when it first sees a time past the cut", () => {
    const { result, video, playTo } = setupCutRig(GAP_THEN_SLIDE, 2);
    act(() => result.current.play());
    playTo(4.8);
    act(() => result.current.onVideoTimeUpdate());
    expect(result.current.activeSlideId).toBeNull();

    playTo(5.3); // 250 ms later, 0.5 s of source at 2x

    act(() => result.current.onVideoTimeUpdate());
    expect(result.current.activeSlideId).toBe("s1");
    expect(video.pause).toHaveBeenCalledTimes(1);
  });

  it("a timeupdate right after a frame's hand-off into a clip does not advance twice", () => {
    const { result, seeks, playTo } = setupCutRig(GAP_NO_SLIDE, 2);
    act(() => result.current.play());
    playTo(5.03);
    frame();
    expect(seeks).toEqual([20]);

    act(() => result.current.onVideoTimeUpdate()); // the seek's own timeupdate
    playTo(20.03);
    act(() => result.current.onVideoTimeUpdate()); // the next ordinary one

    expect(seeks).toEqual([20]);
    expect(result.current.timelineTime).toBeCloseTo(5.03, 2);
  });

  it("a timeupdate right after a frame's hand-off into a slide does not enter it twice", () => {
    const { result, video, playTo } = setupCutRig(GAP_THEN_SLIDE, 2);
    act(() => result.current.play());
    playTo(5.3);
    frame();
    expect(result.current.activeSlideId).toBe("s1");

    act(() => result.current.onVideoTimeUpdate()); // the video still reads 5.3, past the cut

    expect(video.pause).toHaveBeenCalledTimes(1); // enterSlide ran once
    expect(result.current.timelineTime).toBe(5);
  });

  it("a frame right after a timeupdate's hand-off does not advance twice", () => {
    const { result, video, playTo } = setupCutRig(GAP_THEN_SLIDE, 2);
    act(() => result.current.play());
    playTo(5.3);
    act(() => result.current.onVideoTimeUpdate()); // beats the frame to the cut

    frame();
    frame();

    expect(video.pause).toHaveBeenCalledTimes(1);
    expect(result.current.activeSlideId).toBe("s1");
  });

  it("does not hand off again after the last clip ended playback", () => {
    const { result, video, playTo } = setupCutRig(GAP_THEN_SLIDE, 1);
    act(() => result.current.seek(8));
    act(() => result.current.play());
    playTo(24.99);
    frame();
    expect(result.current.playing).toBe(false);
    (video.pause as ReturnType<typeof vi.fn>).mockClear();

    act(() => result.current.onVideoTimeUpdate()); // a stray timeupdate after the stop

    expect(video.pause).not.toHaveBeenCalled();
    expect(result.current.timelineTime).toBe(13);
  });
});

// A plain split leaves two clips that are contiguous in source: X [0..5], Y [5..10]. The
// <video> is already playing the right footage past that cut, so the hand-off must move
// the bookkeeping on WITHOUT seeking the element — a forced seek at every split would
// stall the video and drop the audio for a few milliseconds on each pass.
const SPLIT = [clip("x", 0, 5), clip("y", 5, 10)];
const SPLIT_THEN_SLIDE = [clip("x", 0, 5), clip("y", 5, 10), slide("s1", 3)];
// Y starts 10 ms after X ends: inside END_EPSILON, so still "the same footage".
const SPLIT_WITHIN_EPSILON = [clip("x", 0, 5), clip("y", 5.01, 10)];

/** Play the fake element across `[from, to)` one animation frame at a time (a frame is
 *  17 ms of wall time, `speed` times that much footage), recording every emitted time. */
function playFrames(playTo: (t: number) => void, speed: number, from: number, to: number): void {
  const step = speed * 0.017;
  for (let position = from; position < to; position += step) {
    playTo(position);
    frame();
  }
}

describe.each([0.5, 1, 1.5, 2])(
  "usePreviewPlayback — contiguous clips play through their cut without a seek, at %sx",
  (speed) => {
    it("crosses a plain split with no seek, no pause, and a monotonic playhead", () => {
      const { result, video, seeks, playTo } = setupCutRig(SPLIT, speed);
      const times: number[] = [];
      result.current.subscribeTime((t) => times.push(t));
      act(() => result.current.play());

      playFrames(playTo, speed, 4.8, 5.3); // frames step through, over and past the cut

      expect(seeks).toEqual([]);
      expect(video.pause).not.toHaveBeenCalled();
      expect(result.current.playing).toBe(true);
      expect(times.length).toBeGreaterThan(5);
      for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
      expect(times.at(-1)).toBeGreaterThan(5); // the playhead moved on into Y
    });

    it("a frame inside the 20 ms window before the cut does not seek", () => {
      const { result, video, seeks, playTo } = setupCutRig(SPLIT, speed);
      const times: number[] = [];
      result.current.subscribeTime((t) => times.push(t));
      act(() => result.current.play());
      playTo(4.99); // inside [cut - 0.02, cut]: the old hand-off fired a seek right here
      frame();

      expect(seeks).toEqual([]);
      expect(video.pause).not.toHaveBeenCalled();
      expect(result.current.timelineTime).toBeCloseTo(4.99, 5); // where the video is, not snapped

      playTo(5.01);
      frame();
      frame();
      expect(seeks).toEqual([]);
      expect(times.at(-1)).toBeCloseTo(5.01, 5);
    });

    it("moves on to the next clip: its own cut is the next hand-off (a slide after Y)", () => {
      const { result, seeks, playTo } = setupCutRig(SPLIT_THEN_SLIDE, speed);
      act(() => result.current.play());
      playFrames(playTo, speed, 4.8, 5.3);
      expect(result.current.activeSlideId).toBeNull();

      playTo(9.5);
      frame();
      expect(result.current.activeSlideId).toBeNull();
      playTo(10.2); // past Y's cut: the slide follows at timeline 10

      frame();
      expect(result.current.activeSlideId).toBe("s1");
      expect(result.current.timelineTime).toBe(10);
      expect(seeks).toEqual([]);
    });

    it("a split whose second half starts 10 ms later behaves the same", () => {
      const { result, video, seeks, playTo } = setupCutRig(SPLIT_WITHIN_EPSILON, speed);
      const times: number[] = [];
      result.current.subscribeTime((t) => times.push(t));
      act(() => result.current.play());

      playFrames(playTo, speed, 4.8, 5.4);

      expect(seeks).toEqual([]);
      expect(video.pause).not.toHaveBeenCalled();
      expect(result.current.playing).toBe(true);
      for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
    });

    it("the timeupdate fallback crosses the split without a seek too", () => {
      const { result, seeks, playTo } = setupCutRig(SPLIT, speed);
      act(() => result.current.play());
      playTo(4.99);
      act(() => result.current.onVideoTimeUpdate());
      expect(seeks).toEqual([]);

      playTo(5.3); // the next timeupdate, 250 ms later
      act(() => result.current.onVideoTimeUpdate());
      playTo(5.55);
      act(() => result.current.onVideoTimeUpdate());

      expect(seeks).toEqual([]);
      expect(result.current.timelineTime).toBeCloseTo(5.55, 5);
    });

    it("a real gap in source still seeks, once", () => {
      const { result, seeks, playTo } = setupCutRig(GAP_NO_SLIDE, speed);
      act(() => result.current.play());

      // Play up to the cut; the first frame at the cut seeks over the deleted footage.
      const step = speed * 0.017;
      for (let position = 4.8; seeks.length === 0 && position < 5.5; position += step) {
        playTo(position);
        frame();
      }
      expect(seeks).toEqual([20]);
      expect(result.current.timelineTime).toBeCloseTo(5, 1);

      // The element now plays clip b; further frames must not seek again.
      playFrames(playTo, speed, 20.02, 20.3);
      expect(seeks).toEqual([20]);
    });
  },
);

// The rAF hand-off stops the element up to 20 ms BEFORE its native end, so `ended` never
// fires and the playhead rests at the layout end. Pressing play there must restart from
// 0 the way a native `ended` element does; resuming at the end would hand off again on
// the first frame and the button would flicker.
const ONE_CLIP = [clip("a", 0, 10)];
const CLIP_THEN_SLIDE_END = [clip("a", 0, 5), slide("s1", 3)];

describe.each([1, 2])("usePreviewPlayback — play at the layout end restarts, at %sx", (speed) => {
  it("restarts from 0 after the last clip ended playback, and keeps playing", () => {
    const { result, video, seeks, playTo } = setupCutRig(ONE_CLIP, speed);
    const times: number[] = [];
    result.current.subscribeTime((t) => times.push(t));
    act(() => result.current.play());
    playTo(9.99);
    frame();
    expect(result.current.playing).toBe(false);
    expect(result.current.timelineTime).toBe(10);
    expect(video.pause).toHaveBeenCalledTimes(1);
    times.length = 0;

    act(() => result.current.play());

    expect(seeks).toEqual([0]); // the restart
    expect(result.current.playing).toBe(true);
    expect(result.current.timelineTime).toBe(0);
    expect(video.paused).toBe(false);
    // Continuous advance, no immediate re-hand-off, no flicker.
    playFrames(playTo, speed, 0.02, 0.5);
    expect(result.current.playing).toBe(true);
    expect(video.pause).toHaveBeenCalledTimes(1); // still only the one from the end
    expect(seeks).toEqual([0]);
    expect(times.length).toBeGreaterThan(5);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
    expect(times.at(-1)).toBeGreaterThan(0.3);
  });

  it("the transport toggle restarts too", () => {
    const { result, seeks, playTo } = setupCutRig(ONE_CLIP, speed);
    act(() => result.current.play());
    playTo(9.99);
    frame();
    expect(result.current.playing).toBe(false);

    act(() => result.current.toggle());

    expect(seeks).toEqual([0]);
    expect(result.current.playing).toBe(true);
    expect(result.current.timelineTime).toBe(0);
  });

  it("restarts from 0 after a trailing slide finished", () => {
    const { result, video, seeks, playTo } = setupCutRig(CLIP_THEN_SLIDE_END, speed);
    act(() => result.current.play());
    playTo(5.1); // past clip a's cut: the slide follows
    frame();
    expect(result.current.activeSlideId).toBe("s1");
    advance((3 / speed) * 1000 + 100); // the slide holds its duration, then playback ends
    expect(result.current.playing).toBe(false);
    expect(result.current.timelineTime).toBe(8);
    expect(result.current.activeSlideId).toBeNull();
    const pausesAtEnd = (video.pause as ReturnType<typeof vi.fn>).mock.calls.length;
    const times: number[] = [];
    result.current.subscribeTime((t) => times.push(t));

    act(() => result.current.play());

    expect(seeks).toEqual([0]);
    expect(result.current.playing).toBe(true);
    expect(result.current.activeSlideId).toBeNull();
    expect(result.current.timelineTime).toBe(0);
    playFrames(playTo, speed, 0.02, 0.5);
    expect(result.current.playing).toBe(true);
    expect((video.pause as ReturnType<typeof vi.fn>).mock.calls.length).toBe(pausesAtEnd);
    expect(times.at(-1)).toBeGreaterThan(0.3);
  });

  it("restarts when the layout starts with a slide: the slide clock runs from its start", () => {
    const { result, seeks } = setupCutRig([slide("s0", 3), clip("a", 0, 5)], speed);
    act(() => result.current.seek(8)); // the layout end, in clip a
    expect(result.current.timelineTime).toBe(8);

    act(() => result.current.play());

    expect(result.current.activeSlideId).toBe("s0");
    expect(result.current.timelineTime).toBe(0);
    expect(seeks).toEqual([5]); // only the earlier seek(8): the slide is not sought
    advance(1000);
    expect(result.current.playing).toBe(true);
    expect(result.current.activeSlideId).toBe("s0");
  });

  it("resumes in place when the playhead is not at the end", () => {
    const { result, seeks, playTo } = setupCutRig(ONE_CLIP, speed);
    act(() => result.current.play());
    playTo(9.5);
    frame();
    act(() => result.current.pause());
    act(() => result.current.seek(9.5)); // 0.5 s from the end: well outside the epsilon

    act(() => result.current.play());

    expect(seeks).toEqual([9.5]); // no restart
    expect(result.current.timelineTime).toBe(9.5);
  });
});

describe("usePreviewPlayback — the native ended path", () => {
  it("is ignored while a slide owns the clock (a queued `ended` after the clip before it)", () => {
    const { result, playTo } = setupCutRig(GAP_THEN_SLIDE, 2);
    act(() => result.current.play());
    playTo(5.3); // the hand-off into the slide ran; the element's `ended` was already queued
    frame();
    expect(result.current.activeSlideId).toBe("s1");

    act(() => result.current.onVideoEnded());

    expect(result.current.playing).toBe(true); // the slide is still running
    expect(result.current.timelineTime).toBe(5); // not snapped to the layout end (13)
    expect(result.current.activeSlideId).toBe("s1");
    advance(1700); // the slide still ends on its own clock and chains into clip b
    expect(result.current.activeSlideId).toBeNull();
    expect(result.current.playing).toBe(true);
  });

  it("still stops at the layout end, and play restarts from 0", () => {
    const { result, seeks } = setupCutRig(ONE_CLIP, 1);
    act(() => result.current.play());

    act(() => result.current.onVideoEnded());

    expect(result.current.playing).toBe(false);
    expect(result.current.timelineTime).toBe(10);

    act(() => result.current.play());

    expect(seeks).toEqual([0]);
    expect(result.current.playing).toBe(true);
    expect(result.current.timelineTime).toBe(0);
  });
});

// Editing while playing: the layout prop changes under a running hook. A split gives both
// halves NEW ids, so the remembered clip id no longer exists and the active clip has to be
// found again by position; a trim moves the cut the next hand-off must use.
function setupEditRig(items: TrackItem[], speed: number) {
  const hook = renderHook(({ list }) => usePreviewPlayback(useMemo(() => toLayout(list), [list])), {
    initialProps: { list: items },
  });
  const rig = makeSeekRecordingVideo();
  hook.result.current.videoRef.current = rig.video;
  act(() => hook.result.current.setSpeed(speed));
  const edit = (list: TrackItem[]) => hook.rerender({ list });
  return { ...hook, ...rig, edit };
}

describe.each([1, 2])("usePreviewPlayback — editing the layout while playing, at %sx", (speed) => {
  const WHOLE_THEN_SLIDE = [clip("x", 0, 10), slide("s1", 3)];

  it.each([4, 7])(
    "a split with the playhead at source %s hands off at the right cut afterwards",
    (at) => {
      const { result, seeks, playTo, edit } = setupEditRig(WHOLE_THEN_SLIDE, speed);
      act(() => result.current.play());
      playTo(at);
      frame();

      const split = splitClipAt(WHOLE_THEN_SLIDE, 5);
      expect(split.map((item) => item.id)).not.toContain("x"); // both halves got new ids
      edit(split);
      frame();

      playFrames(playTo, speed, at + 0.1, 9.9); // on through the footage, over the split at 5 when before it
      expect(seeks).toEqual([]);
      expect(result.current.activeSlideId).toBeNull();
      expect(result.current.playing).toBe(true);

      playTo(10.2); // past the cut of the second half: the slide follows at timeline 10
      frame();
      expect(result.current.activeSlideId).toBe("s1");
      expect(result.current.timelineTime).toBe(10);
      expect(seeks).toEqual([]);
    },
  );

  it("trimming the end below the playhead hands off at the new cut", () => {
    const items = [clip("x", 0, 10), clip("y", 20, 25)];
    const { result, seeks, playTo, edit } = setupEditRig(items, speed);
    act(() => result.current.play());
    playTo(7);
    frame();
    expect(seeks).toEqual([]);

    edit(trimClip(items, "x", "end", 5)); // x now ends at 5; the video is already at 7
    frame();

    expect(seeks).toEqual([20]); // straight to y, which now starts at timeline 5
    expect(result.current.timelineTime).toBe(5);
    expect(result.current.playing).toBe(true);
  });

  it("trimming the end below the playhead enters a slide that follows the clip", () => {
    const items = [clip("x", 0, 10), slide("s1", 3)];
    const { result, seeks, playTo, edit } = setupEditRig(items, speed);
    act(() => result.current.play());
    playTo(7);
    frame();

    edit(trimClip(items, "x", "end", 5));
    frame();

    expect(result.current.activeSlideId).toBe("s1");
    expect(result.current.timelineTime).toBe(5);
    expect(seeks).toEqual([]);
  });

  it("deleting the active clip while playing snaps to the next kept clip", () => {
    const items = [clip("a", 0, 5), clip("b", 5, 10), clip("c", 20, 25)];
    const { result, seeks, playTo, edit } = setupEditRig(items, speed);
    act(() => result.current.play());
    playTo(7); // inside b
    frame();

    edit(removeItem(items, "b")); // the footage under the element is deleted now
    frame();
    expect(seeks).toEqual([]); // the frame loop holds the last time; it does not guess

    act(() => result.current.onVideoTimeUpdate());

    expect(seeks).toEqual([20]);
    expect(result.current.timelineTime).toBe(5); // c starts right after a
    expect(result.current.playing).toBe(true);
  });
});
