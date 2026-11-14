import { describe, expect, it, vi } from "vitest";
import { MediaSwitch } from "./media-switch";
import { asElement, FakeVideo, joinedSource as joined } from "./media-switch.fixture";
import { sourceAxis } from "./source-axis";

/** Opened recording [0, 100]; B joined at [3600, 3640]; C joined at [7200, 7230]. */
function setup(options: { c?: boolean } = {}) {
  let wall = 0;
  const sw = new MediaSwitch({ now: () => wall });
  const sources = [joined("B", 3600, 40), ...(options.c ? [joined("C", 7200, 30)] : [])];
  sw.setAxis(sourceAxis(100, sources));
  const a = new FakeVideo();
  const b = new FakeVideo();
  const c = new FakeVideo();
  sw.attach(null, asElement(a));
  sw.attach("B", asElement(b));
  if (options.c) sw.attach("C", asElement(c));
  return {
    sw,
    a,
    b,
    c,
    advanceWall(ms: number) {
      wall += ms;
    },
  };
}

describe("MediaSwitch — one recording", () => {
  it("shows the opened recording and reads its own time", () => {
    const { sw, a, b } = setup();
    a.currentTime = 12.5;
    expect(sw.currentTime).toBe(12.5);
    expect(a.style.visibility).toBe("visible");
    expect(b.style.visibility).toBe("hidden");
    expect(sw.isActive(asElement(a))).toBe(true);
    expect(sw.isActive(asElement(b))).toBe(false);
  });

  it("seeks the same element for a time inside the recording it shows", () => {
    const { sw, a, b } = setup();
    sw.currentTime = 40;
    expect(a.currentTime).toBe(40);
    expect(b.seekWrites).toEqual([]);
    expect(a.style.visibility).toBe("visible");
  });

  it("forwards play, pause and the transport state of the active element", () => {
    const { sw, a } = setup();
    void sw.play();
    expect(a.play).toHaveBeenCalledOnce();
    expect(sw.paused).toBe(false);
    sw.pause();
    expect(a.pause).toHaveBeenCalled();
    expect(sw.paused).toBe(true);
  });
});

describe("MediaSwitch — switching recordings", () => {
  it("reads the joined recording's time on the axis: local time plus its offset", () => {
    const { sw, b } = setup();
    sw.currentTime = 3610;
    expect(b.currentTime).toBeCloseTo(10, 9);
    expect(sw.currentTime).toBeCloseTo(3610, 9);
  });

  it("makes the other element the shown one and hides and pauses the previous", () => {
    const { sw, a, b } = setup();
    a.paused = false;
    sw.currentTime = 3605;
    expect(sw.activeKey).toBe("B");
    expect(b.style.visibility).toBe("visible");
    expect(a.style.visibility).toBe("hidden");
    expect(a.pause).toHaveBeenCalled();
    expect(a.muted).toBe(true);
    expect(sw.isActive(asElement(b))).toBe(true);
  });

  it("keeps playing across the switch when it was playing, and stays paused when it was paused", () => {
    const playing = setup();
    playing.a.paused = false;
    playing.sw.currentTime = 3605;
    expect(playing.b.play).toHaveBeenCalledOnce();
    expect(playing.sw.paused).toBe(false);

    const idle = setup();
    idle.sw.currentTime = 3605;
    expect(idle.b.play).not.toHaveBeenCalled();
    expect(idle.sw.paused).toBe(true);
  });

  it("carries the mute state to the element that takes over", () => {
    const { sw, a, b } = setup();
    sw.muted = true;
    expect(a.muted).toBe(true);
    a.muted = false; // the hook unmuted the active element for an audible instant
    sw.currentTime = 3605;
    expect(b.muted).toBe(false);
    sw.muted = true;
    expect(b.muted).toBe(true);
    expect(a.muted).toBe(true); // the standby is always silent
  });

  it("goes back and forth across A -> B -> A, the time always on the axis", () => {
    const { sw, a, b } = setup();
    a.paused = false;
    a.currentTime = 99.9;
    sw.currentTime = 3600; // the cut A -> B
    expect(sw.currentTime).toBeCloseTo(3600, 9);
    sw.currentTime = 20; // and back into A
    expect(sw.activeKey).toBeNull();
    expect(a.currentTime).toBe(20);
    expect(a.style.visibility).toBe("visible");
    expect(b.style.visibility).toBe("hidden");
    expect(a.play).toHaveBeenCalled();
  });

  it("falls back to the active recording for a time no range holds (a legacy clip)", () => {
    const { sw, a } = setup();
    sw.currentTime = 150; // past the opened recording's end, inside no other range
    expect(sw.activeKey).toBeNull();
    expect(a.currentTime).toBe(150);
  });

  it("tells subscribers once per switch, with the new time already readable", () => {
    const { sw } = setup();
    const seen: number[] = [];
    const off = sw.onActiveChange(() => seen.push(sw.currentTime));
    sw.currentTime = 3610;
    sw.currentTime = 3620; // same recording: no change
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeCloseTo(3610, 9);
    off();
    sw.currentTime = 5;
    expect(seen).toHaveLength(1);
  });
});

describe("MediaSwitch — priming", () => {
  it("pre-seeks the other recording's element, paused and muted, without showing it", () => {
    const { sw, a, b } = setup();
    a.paused = false;
    sw.prime(3605);
    expect(b.currentTime).toBe(5);
    expect(b.paused).toBe(true);
    expect(b.muted).toBe(true);
    expect(b.play).not.toHaveBeenCalled();
    expect(b.style.visibility).toBe("hidden");
    expect(sw.activeKey).toBeNull();
  });

  it("ignores a time inside the recording already shown", () => {
    const { sw, a, b } = setup();
    sw.prime(50);
    expect(a.seekWrites).toEqual([]);
    expect(b.seekWrites).toEqual([]);
  });

  it("makes the cut a visibility flip plus play: no seek write on the primed element", () => {
    const { sw, a, b } = setup();
    a.paused = false;
    sw.prime(3605);
    expect(b.seekWrites).toEqual([5]);
    b.finishSeek();
    sw.currentTime = 3605; // the cut
    expect(b.seekWrites).toEqual([5]); // no second write
    expect(sw.activeKey).toBe("B");
    expect(b.style.visibility).toBe("visible");
    expect(a.style.visibility).toBe("hidden");
    expect(b.play).toHaveBeenCalledOnce();
  });

  it("does not prime twice for the same second", () => {
    const { sw, b } = setup();
    sw.prime(3605);
    sw.prime(3605);
    expect(b.seekWrites).toEqual([5]);
  });

  it("keeps the old frame on screen until the new element has its frame", () => {
    const { sw, a, b } = setup();
    // No prime: the seek is still running when the cut arrives.
    b.seeking = false;
    const original = Object.getOwnPropertyDescriptor(FakeVideo.prototype, "currentTime")!;
    Object.defineProperty(b, "currentTime", {
      get: () => original.get!.call(b),
      set: (v: number) => {
        original.set!.call(b, v);
        b.seeking = true; // a real element starts seeking as soon as the time is written
      },
    });
    sw.currentTime = 3610;
    expect(sw.activeKey).toBe("B"); // time and transport already follow B
    expect(sw.currentTime).toBeCloseTo(3610, 9);
    expect(a.style.visibility).toBe("visible"); // but the picture is still A's last frame
    expect(b.style.visibility).toBe("hidden");
    b.finishSeek();
    expect(b.style.visibility).toBe("visible");
    expect(a.style.visibility).toBe("hidden");
  });
});

describe("MediaSwitch — transport settings", () => {
  it("writes the playback rate to every element and reads the active one", () => {
    const { sw, a, b } = setup();
    sw.playbackRate = 2;
    sw.defaultPlaybackRate = 2;
    sw.preservesPitch = true;
    expect(a.playbackRate).toBe(2);
    expect(b.playbackRate).toBe(2);
    expect(b.defaultPlaybackRate).toBe(2);
    // An element whose src just reloaded lost its rate: the reader sees the mismatch.
    a.playbackRate = 1;
    expect(sw.playbackRate).toBe(1);
  });

  it("gives an element that takes over the rate the user chose", () => {
    const { sw, b } = setup();
    sw.playbackRate = 1.5;
    b.playbackRate = 1; // reloaded in the meantime
    sw.prime(3610);
    expect(b.playbackRate).toBe(1.5);
  });

  it("exposes the active element's decoded size and element", () => {
    const { sw, a, b } = setup();
    b.videoWidth = 1280;
    b.videoHeight = 720;
    expect(sw.videoWidth).toBe(1920);
    expect(sw.activeElement()).toBe(a);
    sw.currentTime = 3610;
    expect(sw.videoWidth).toBe(1280);
    expect(sw.videoHeight).toBe(720);
    expect(sw.activeElement()).toBe(b);
  });

  it("pauses the standby too when the transport pauses", () => {
    const { sw, a, b } = setup();
    a.paused = false;
    b.paused = false; // a leaked play
    sw.pause();
    expect(a.paused).toBe(true);
    expect(b.paused).toBe(true);
  });
});

describe("MediaSwitch — events and frames", () => {
  it("delivers an element's events only while that element is the active one", () => {
    const { sw, a, b } = setup();
    const heard = vi.fn();
    sw.addEventListener("pause", heard);
    a.emit("pause");
    expect(heard).toHaveBeenCalledTimes(1);
    b.emit("pause"); // the standby pausing says nothing about playback
    expect(heard).toHaveBeenCalledTimes(1);
    sw.currentTime = 3610;
    a.emit("pause"); // the old element's own pause, arriving after the switch
    expect(heard).toHaveBeenCalledTimes(1);
    b.emit("pause");
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it("binds listeners on an element attached later, and unbinds on removeEventListener", () => {
    const { sw } = setup({ c: false });
    const heard = vi.fn();
    sw.addEventListener("seeked", heard);
    const late = new FakeVideo();
    sw.setAxis(sourceAxis(100, [joined("B", 3600, 40), joined("L", 7200, 30)]));
    sw.attach("L", asElement(late));
    sw.currentTime = 7210;
    late.emit("seeked");
    expect(heard).toHaveBeenCalledTimes(1);
    sw.removeEventListener("seeked", heard);
    late.emit("seeked");
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("reports frames of the active element in axis seconds and drops the standby's", () => {
    const { sw, a, b } = setup();
    const frames: number[] = [];
    sw.requestVideoFrameCallback((_now, metadata) => frames.push(metadata.mediaTime));
    b.presentFrame(5); // the primed standby presents a frame: not on screen
    expect(frames).toEqual([]);
    a.presentFrame(12);
    expect(frames).toEqual([12]);
  });

  it("reports a joined element's frame at local + offset", () => {
    const { sw, b } = setup();
    sw.currentTime = 3610;
    const frames: number[] = [];
    sw.requestVideoFrameCallback((_now, metadata) => frames.push(metadata.mediaTime));
    b.presentFrame(10.5);
    expect(frames[0]).toBeCloseTo(3610.5, 9);
  });

  it("does not pile requests on the standby: the one that fires cancels the other", () => {
    const { sw, a, b } = setup();
    let again = (_now: number, _m: VideoFrameCallbackMetadata): void => {};
    const loop = (_now: number, metadata: VideoFrameCallbackMetadata): void => {
      void metadata;
      sw.requestVideoFrameCallback(again);
    };
    again = loop;
    sw.requestVideoFrameCallback(loop);
    for (let i = 0; i < 5; i++) a.presentFrame(i);
    expect(b.pendingFrames).toBe(1);
    expect(a.pendingFrames).toBe(1);
  });

  it("keeps the clock alive across a flip: the new element has a request to answer", () => {
    const { sw, a, b } = setup();
    const frames: number[] = [];
    const loop = (_now: number, metadata: VideoFrameCallbackMetadata): void => {
      frames.push(metadata.mediaTime);
      sw.requestVideoFrameCallback(loop);
    };
    sw.requestVideoFrameCallback(loop);
    b.presentFrame(5); // the primed standby's frame is dropped; its request is spent
    sw.currentTime = 3605; // the cut
    b.presentFrame(5.04);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toBeCloseTo(3605.04, 9);
    a.presentFrame(99); // the old element no longer counts
    expect(frames).toHaveLength(1);
  });

  it("cancels a request on every element", () => {
    const { sw, a, b } = setup();
    const handle = sw.requestVideoFrameCallback(() => {});
    sw.cancelVideoFrameCallback(handle);
    expect(a.pendingFrames).toBe(0);
    expect(b.pendingFrames).toBe(0);
  });

  it("answers a request made before an element existed once the element is attached", () => {
    const { sw } = setup();
    const frames: number[] = [];
    sw.requestVideoFrameCallback((_now, metadata) => frames.push(metadata.mediaTime));
    sw.setAxis(sourceAxis(100, [joined("B", 3600, 40), joined("L", 7200, 30)]));
    const late = new FakeVideo();
    sw.attach("L", asElement(late));
    sw.currentTime = 7205;
    late.presentFrame(5);
    expect(frames[0]).toBeCloseTo(7205, 9);
  });
});

describe("MediaSwitch — a recording with no element (missing or still loading)", () => {
  it("runs a silent clock on wall time so the sequence can cross it", () => {
    const { sw, a, b, advanceWall } = setup();
    sw.setAxis(sourceAxis(100, [joined("B", 3600, 40), joined("M", 7200, 30)]));
    a.paused = false;
    sw.currentTime = 7200; // M has no element
    expect(sw.activeKey).toBe("M");
    expect(sw.activeElement()).toBeNull();
    expect(a.style.visibility).toBe("hidden");
    expect(b.style.visibility).toBe("hidden");
    expect(a.pause).toHaveBeenCalled();
    expect(sw.paused).toBe(false); // it was playing, so the clock runs
    advanceWall(2000);
    expect(sw.currentTime).toBeCloseTo(7202, 6);
  });

  it("stays still while paused, follows the playback rate and stops at the recording's end", () => {
    const { sw, advanceWall } = setup();
    sw.setAxis(sourceAxis(100, [joined("M", 7200, 30)]));
    sw.currentTime = 7210;
    advanceWall(5000);
    expect(sw.currentTime).toBeCloseTo(7210, 6); // paused
    void sw.play();
    sw.playbackRate = 2;
    advanceWall(5000);
    expect(sw.currentTime).toBeCloseTo(7220, 6);
    advanceWall(60000);
    expect(sw.currentTime).toBeCloseTo(7230, 6); // clamped at the end of the range
    sw.pause();
    expect(sw.paused).toBe(true);
  });

  it("hands a running clock to the element that appears for that recording", () => {
    const { sw, advanceWall } = setup();
    sw.setAxis(sourceAxis(100, [joined("M", 7200, 30)]));
    sw.currentTime = 7205;
    void sw.play();
    advanceWall(3000);
    const late = new FakeVideo();
    sw.attach("M", asElement(late));
    expect(late.currentTime).toBeCloseTo(8, 6);
    expect(late.play).toHaveBeenCalled();
    expect(sw.activeElement()).toBe(late);
    expect(late.style.visibility).toBe("visible");
  });
});

describe("MediaSwitch — attach and detach", () => {
  it("falls back to the opened recording when the shown one is removed", () => {
    const { sw, a, b } = setup();
    sw.currentTime = 3610;
    sw.setAxis(sourceAxis(100, []));
    sw.attach("B", null);
    expect(sw.activeKey).toBeNull();
    expect(a.style.visibility).toBe("visible");
    expect(b.style.visibility).toBe("hidden");
  });

  it("stops listening to an element that is detached", () => {
    const { sw, b } = setup();
    const heard = vi.fn();
    sw.addEventListener("seeked", heard);
    expect(b.listenerCount("seeked")).toBe(1);
    sw.currentTime = 3610;
    sw.attach("B", null);
    expect(b.listenerCount("seeked")).toBe(0);
    expect(b.listenerCount("loadeddata")).toBe(0);
    b.emit("seeked");
    expect(heard).not.toHaveBeenCalled();
  });
});

describe("MediaSwitch — presentedTime while a switch is pending", () => {
  it("exposes the element on screen, not the pending one, so a canvas never samples a frame the viewer does not see", () => {
    const { sw, a, b } = setup();
    a.currentTime = 10;
    b.readyState = 1; // not decoded yet
    sw.currentTime = 3605; // B is active, A's picture is still on screen
    expect(sw.activeKey).toBe("B");
    expect(sw.activeElement()).toBe(a);
    b.readyState = 4;
    b.emit("seeked");
    expect(sw.activeElement()).toBe(b);
  });

  it("keeps the shown frame's axis time until the unprimed recording has a frame", () => {
    const { sw, a, b } = setup();
    a.currentTime = 10;
    expect(sw.presentedTime).toBe(10);
    const seen: number[] = [];
    sw.onActiveChange(() => seen.push(sw.presentedTime));
    b.readyState = 1; // not decoded yet
    sw.currentTime = 3605; // paused on A's frame, seek into B
    expect(sw.currentTime).toBeCloseTo(3605, 9); // the requested position is unchanged
    expect(sw.presentedTime).toBe(10);
    expect(a.style.visibility).toBe("visible");
    expect(seen.every((t) => t === 10)).toBe(true);
    seen.length = 0;
    b.readyState = 4;
    b.emit("seeked");
    expect(sw.presentedTime).toBeCloseTo(3605, 9);
    expect(b.style.visibility).toBe("visible");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeCloseTo(3605, 9);
  });

  it("catches up on loadeddata too", () => {
    const { sw, a, b } = setup();
    a.currentTime = 10;
    b.readyState = 0;
    sw.currentTime = 3601;
    expect(sw.presentedTime).toBe(10);
    b.readyState = 2;
    b.emit("loadeddata");
    expect(sw.presentedTime).toBeCloseTo(3601, 9);
  });

  it("reports the new time at once when the recording is primed", () => {
    const { sw, a, b } = setup();
    a.currentTime = 10;
    sw.prime(3605);
    const seen: number[] = [];
    sw.onActiveChange(() => seen.push(sw.presentedTime));
    sw.currentTime = 3605; // b is ready (readyState 4) and sits on the spot
    expect(sw.presentedTime).toBeCloseTo(3605, 9);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeCloseTo(3605, 9);
    expect(b.style.visibility).toBe("visible");
  });

  it("returns to the shown frame when the pending switch is cancelled by a seek back", () => {
    const { sw, a, b } = setup();
    a.currentTime = 10;
    b.readyState = 1;
    sw.currentTime = 3605;
    sw.currentTime = 12; // back into A, whose frame is ready
    expect(sw.presentedTime).toBe(12);
    b.readyState = 4;
    b.emit("seeked"); // a late B event must not take the screen
    expect(sw.presentedTime).toBe(12);
    expect(a.style.visibility).toBe("visible");
  });

  it("takes the screen for a frame the pending element presents before its seeked event", () => {
    const { sw, a, b } = setup();
    a.currentTime = 10;
    sw.requestVideoFrameCallback(() => {});
    b.readyState = 1;
    sw.currentTime = 3605;
    expect(sw.presentedTime).toBe(10);
    b.readyState = 4;
    b.presentFrame(5);
    expect(sw.presentedTime).toBeCloseTo(3605, 9);
    expect(b.style.visibility).toBe("visible");
  });
});
