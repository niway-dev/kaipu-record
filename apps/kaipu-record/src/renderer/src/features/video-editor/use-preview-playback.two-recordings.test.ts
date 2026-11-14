import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaSwitch } from "./media-switch";
import { asElement, FakeVideo, joinedSource } from "./media-switch.fixture";
import type { TrackItem } from "./scene";
import { sourceAxis } from "./source-axis";
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

// The opened recording A sits at [0, 100]; B was joined at [3600, 3640] (ADR 0058).
// Timeline: a1 0-10 (A), b 10-20 (B), a2 20-30 (A).
const ACROSS: TrackItem[] = [clip("a1", 0, 10), clip("b", 3600, 3610), clip("a2", 50, 60)];

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

/** The hook driven through a real MediaSwitch over fake elements, as the preview stage wires it. */
function setup(
  items: TrackItem[],
  options: { missing?: boolean; audio?: Parameters<typeof usePreviewPlayback>[1] } = {},
) {
  const layout = toLayout(items);
  const sw = new MediaSwitch({ now: () => now });
  const sources = [
    joinedSource("B", 3600, 40),
    ...(options.missing ? [joinedSource("M", 7200, 10)] : []),
  ];
  sw.setAxis(sourceAxis(100, sources));
  const a = new FakeVideo();
  const b = new FakeVideo();
  sw.attach(null, asElement(a));
  sw.attach("B", asElement(b));
  const hook = renderHook(() => usePreviewPlayback(layout, options.audio));
  hook.result.current.videoRef.current = sw;
  return { ...hook, sw, a, b };
}

describe("usePreviewPlayback over two recordings — a cut across recordings", () => {
  it("plays A -> B -> A: the shown element follows each cut and the timeline keeps advancing", () => {
    const { result, sw, a, b } = setup(ACROSS);
    const times: number[] = [];
    result.current.subscribeTime((t) => times.push(t));

    act(() => result.current.play());
    expect(a.paused).toBe(false);

    // A reaches the cut at its second 10.
    a.currentTime = 9.99;
    advance(20);
    expect(sw.activeKey).toBe("B");
    expect(b.style.visibility).toBe("visible");
    expect(a.style.visibility).toBe("hidden");
    expect(a.paused).toBe(true);
    expect(b.paused).toBe(false);
    expect(result.current.timelineTime).toBe(10);

    // B plays on: the playhead reads its time on the axis, offset removed by the layout.
    b.currentTime = 3;
    advance(20);
    expect(times.at(-1)).toBeCloseTo(13, 6);
    expect(sw.currentTime).toBeCloseTo(3603, 6);

    // B reaches ITS cut (axis 3610, local 10) and hands back to A at the second 50.
    b.currentTime = 9.99;
    advance(20);
    expect(sw.activeKey).toBeNull();
    expect(a.currentTime).toBe(50);
    expect(a.style.visibility).toBe("visible");
    expect(b.style.visibility).toBe("hidden");
    expect(a.paused).toBe(false);
    expect(result.current.timelineTime).toBe(20);

    a.currentTime = 55;
    advance(20);
    expect(times.at(-1)).toBeCloseTo(25, 6);
    expect(result.current.playing).toBe(true);
  });

  it("primes the recording of the next clip when a clip becomes the active one", () => {
    const { result, sw, b } = setup(ACROSS);
    const prime = vi.spyOn(sw, "prime");

    act(() => result.current.seek(2)); // clip a1: the next clip is in B
    expect(prime).toHaveBeenLastCalledWith(3600);
    expect(b.muted).toBe(true);
    expect(b.paused).toBe(true);
    expect(sw.activeKey).toBeNull();

    act(() => result.current.seek(12)); // clip b: the next clip is a2, back in A
    expect(prime).toHaveBeenLastCalledWith(50);

    prime.mockClear();
    act(() => result.current.seek(25)); // clip a2: nothing follows
    expect(prime).not.toHaveBeenCalled();
  });

  it("makes the cut a flip, not a seek: the primed element is not written again", () => {
    const { result, a, b } = setup(ACROSS);
    act(() => result.current.seek(9)); // primes B on its first frame (already at 0: no write)
    act(() => result.current.play());
    b.seekWrites.length = 0;
    a.currentTime = 9.99;
    advance(20);
    expect(b.seekWrites).toEqual([]);
    expect(b.paused).toBe(false);
  });

  it("primes again when an edit changes which clip comes next", () => {
    const layoutA = toLayout([clip("a1", 0, 10), clip("a2", 50, 60), clip("b", 3600, 3610)]);
    const layoutB = toLayout([clip("a1", 0, 10), clip("b", 3600, 3610), clip("a2", 50, 60)]);
    const sw = new MediaSwitch({ now: () => now });
    sw.setAxis(sourceAxis(100, [joinedSource("B", 3600, 40)]));
    const a = new FakeVideo();
    const b = new FakeVideo();
    sw.attach(null, asElement(a));
    sw.attach("B", asElement(b));
    const prime = vi.spyOn(sw, "prime");
    const { result, rerender } = renderHook(({ layout }) => usePreviewPlayback(layout), {
      initialProps: { layout: layoutA },
    });
    result.current.videoRef.current = sw;
    act(() => result.current.seek(2));
    expect(prime).toHaveBeenLastCalledWith(50); // the next clip is a2, in A
    rerender({ layout: layoutB });
    expect(prime).toHaveBeenLastCalledWith(3600); // now it is b
  });
});

describe("usePreviewPlayback over two recordings — seeking and transport", () => {
  it("a seek into B shows B at the local second: axis minus offset", () => {
    const { result, sw, a, b } = setup(ACROSS);
    act(() => result.current.seek(12.5)); // 2.5 s into clip b (source 3600..)
    expect(sw.activeKey).toBe("B");
    expect(b.currentTime).toBeCloseTo(2.5, 6);
    expect(b.style.visibility).toBe("visible");
    expect(a.style.visibility).toBe("hidden");
    expect(result.current.timelineTime).toBe(12.5);
    expect(result.current.readTimelineTime()).toBe(12.5);
  });

  it("a scrub back into A while playing keeps playing on A", () => {
    const { result, sw, a, b } = setup(ACROSS);
    act(() => result.current.seek(12));
    act(() => result.current.play());
    expect(b.paused).toBe(false);
    act(() => result.current.seek(3));
    expect(sw.activeKey).toBeNull();
    expect(a.currentTime).toBe(3);
    expect(a.paused).toBe(false);
    expect(b.paused).toBe(true);
    expect(result.current.playing).toBe(true);
  });

  it("mute and rate apply to the element on screen, and the standby stays silent", () => {
    const { result, a, b } = setup(ACROSS);
    act(() => result.current.seek(12));
    act(() => result.current.toggleMute());
    expect(b.muted).toBe(true);
    expect(a.muted).toBe(true);
    act(() => result.current.toggleMute());
    expect(b.muted).toBe(false);
    expect(a.muted).toBe(true);

    act(() => result.current.setSpeed(2));
    expect(b.playbackRate).toBe(2);
    expect(a.playbackRate).toBe(2); // so a cut needs no ramp
  });

  it("mutes a range of the joined recording by its axis seconds", () => {
    const { result, b } = setup(ACROSS, {
      audio: {
        audioMuted: false,
        mutedRanges: [{ id: "m", sourceStart: 3605, sourceEnd: 3608 }],
      },
    });
    act(() => result.current.seek(10));
    act(() => result.current.play());
    b.currentTime = 6; // axis 3606: inside the range
    advance(20);
    expect(b.muted).toBe(true);
    b.currentTime = 9; // axis 3609: outside it
    advance(20);
    expect(b.muted).toBe(false);
  });

  it("pauses the shown element, and the standby, on pause()", () => {
    const { result, a, b } = setup(ACROSS);
    act(() => result.current.seek(12));
    act(() => result.current.play());
    act(() => result.current.pause());
    expect(a.paused).toBe(true);
    expect(b.paused).toBe(true);
    expect(result.current.playing).toBe(false);
  });
});

describe("usePreviewPlayback over two recordings — slides and gaps", () => {
  it("a slide between recordings still pauses the video and resumes the next recording after it", () => {
    const items = [clip("a1", 0, 10), slide("s", 2), clip("b", 3600, 3610)];
    const { result, sw, a, b } = setup(items);
    act(() => result.current.play());
    a.currentTime = 9.99;
    advance(20);
    expect(result.current.activeSlideId).toBe("s");
    expect(a.paused).toBe(true);
    expect(b.paused).toBe(true);
    expect(sw.activeKey).toBeNull(); // the slide never touches the other recording

    advance(2100); // the slide holds its two seconds on the wall clock
    expect(result.current.activeSlideId).toBeNull();
    expect(sw.activeKey).toBe("B");
    expect(b.paused).toBe(false);
    expect(b.style.visibility).toBe("visible");
    expect(result.current.playing).toBe(true);
  });

  it("a missing recording is crossed like a slide of its length, on a silent clock", () => {
    const items = [clip("a1", 0, 10), clip("m", 7200, 7204), clip("a2", 50, 60)];
    const { result, sw, a } = setup(items, { missing: true });
    act(() => result.current.play());
    a.currentTime = 9.99;
    advance(20);
    expect(sw.activeKey).toBe("M");
    expect(sw.activeElement()).toBeNull();
    expect(a.paused).toBe(true);
    expect(result.current.playing).toBe(true);

    advance(2000); // two seconds into the missing clip (timeline 10..14)
    expect(sw.currentTime).toBeCloseTo(7202, 1);

    advance(2100); // its four seconds are up: the sequence moves on to a2
    expect(sw.activeKey).toBeNull();
    expect(a.currentTime).toBe(50);
    expect(a.paused).toBe(false);
    expect(result.current.timelineTime).toBe(14);
  });
});

describe("usePreviewPlayback over one recording behind the switch", () => {
  it("a plain split stays continuous: no seek write at the cut", () => {
    const sw = new MediaSwitch({ now: () => now });
    sw.setAxis(sourceAxis(100, []));
    const a = new FakeVideo();
    sw.attach(null, asElement(a));
    const { result } = renderHook(() =>
      usePreviewPlayback(toLayout([clip("x", 0, 5), clip("y", 5, 10)])),
    );
    result.current.videoRef.current = sw;

    act(() => result.current.play());
    a.seekWrites.length = 0;
    a.currentTime = 4.99;
    a.seekWrites.length = 0;
    advance(20);
    expect(a.seekWrites).toEqual([]);
    expect(a.paused).toBe(false);
  });
});
