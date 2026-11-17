import { describe, expect, it, vi } from "vitest";
import {
  FILMSTRIP_BYTE_BUDGET,
  FIT_FRAME_CAP,
  FrameStore,
  MIN_SLOT_STEP,
  pickFrame,
  planSlots,
  slotStepFor,
  type Frame,
} from "./filmstrip-frames";

const MB = 1024 * 1024;

/** A frame of `bytes` at a file timestamp; the payload is the timestamp itself. */
const frame = (timestamp: number, bytes = 1): Frame<number> => ({
  timestamp,
  bytes,
  data: timestamp,
});

const stamps = (frames: readonly Frame<number>[]) => frames.map((f) => f.timestamp);

describe("FrameStore: AC5 thumbnail bytes held never exceed 48 MB", () => {
  it("AC5: the default budget is 48 MB", () => {
    expect(FILMSTRIP_BYTE_BUDGET).toBe(48 * MB);
  });

  it("AC5: bytes never pass the budget while frames of many files arrive", () => {
    const store = new FrameStore<number>({ budgetBytes: 10 });
    for (let file = 0; file < 20; file++) {
      for (let i = 0; i < 7; i++) {
        store.add(`file-${file}`, frame(i, 3));
        expect(store.bytes).toBeLessThanOrEqual(10);
      }
    }
  });

  it("AC5: the least recently used file is dropped whole, the newest file stays", () => {
    const store = new FrameStore<number>({ budgetBytes: 9 });
    store.add("a", frame(0, 3));
    store.add("a", frame(1, 3));
    store.add("b", frame(0, 3));
    expect(store.bytes).toBe(9);
    store.add("c", frame(0, 3));
    expect(stamps(store.frames("a"))).toEqual([]);
    expect(stamps(store.frames("b"))).toEqual([0]);
    expect(stamps(store.frames("c"))).toEqual([0]);
    expect(store.bytes).toBe(6);
  });

  it("AC5: reading a file's frames makes it recently used, so another file goes first", () => {
    const store = new FrameStore<number>({ budgetBytes: 6 });
    store.add("a", frame(0, 3));
    store.add("b", frame(0, 3));
    store.frames("a"); // a is now newer than b
    store.add("c", frame(0, 3));
    expect(stamps(store.frames("b"))).toEqual([]);
    expect(stamps(store.frames("a"))).toEqual([0]);
  });

  it("AC5: when the current file alone is over budget, the frames farthest from the visible range go", () => {
    const store = new FrameStore<number>({ budgetBytes: 4 });
    const view = { start: 100, end: 110 };
    for (const t of [0, 50, 105, 108, 400, 90]) store.add("a", frame(t, 1), view);
    // 4 frames fit: the two inside the view, then the two nearest outside it (90 is 10 away,
    // 50 is 50 away; 0 and 400 are the farthest and went first).
    expect(stamps(store.frames("a"))).toEqual([50, 90, 105, 108]);
    expect(store.bytes).toBeLessThanOrEqual(4);
  });

  it("AC5: a frame added far from the view is itself the one dropped, and it is reported", () => {
    const onEvict = vi.fn();
    const store = new FrameStore<number>({ budgetBytes: 2, onEvict });
    const view = { start: 100, end: 110 };
    store.add("a", frame(105), view);
    store.add("a", frame(108), view);
    store.add("a", frame(400), view);
    expect(stamps(store.frames("a"))).toEqual([105, 108]);
    expect(onEvict).toHaveBeenCalledTimes(1);
    expect(onEvict).toHaveBeenCalledWith("a", expect.objectContaining({ timestamp: 400 }));
  });

  it("AC5: with no view ever given, the frame just added is kept and the farthest ones go", () => {
    const onEvict = vi.fn();
    const store = new FrameStore<number>({ budgetBytes: 2, onEvict });
    store.add("a", frame(10));
    store.add("a", frame(20));
    store.add("a", frame(15));
    expect(stamps(store.frames("a"))).toContain(15);
    expect(store.frames("a")).toHaveLength(2);
    expect(onEvict).not.toHaveBeenCalledWith("a", expect.objectContaining({ timestamp: 15 }));
  });

  it("AC5: the last view given stays in force for later adds that pass none", () => {
    const store = new FrameStore<number>({ budgetBytes: 2 });
    store.add("a", frame(100), { start: 100, end: 110 });
    store.add("a", frame(105));
    store.add("a", frame(400)); // no view: the earlier one still decides, so 400 is the farthest
    expect(stamps(store.frames("a"))).toEqual([100, 105]);
  });

  it("AC5: a single frame larger than the whole budget is not kept", () => {
    const store = new FrameStore<number>({ budgetBytes: 5 });
    store.add("a", frame(1, 6));
    expect(store.bytes).toBe(0);
    expect(store.frames("a")).toEqual([]);
  });

  it("AC5: every dropped frame is reported once, so its object URL can be revoked", () => {
    const onEvict = vi.fn();
    const store = new FrameStore<number>({ budgetBytes: 3, onEvict });
    store.add("a", frame(0, 3));
    store.add("b", frame(7, 3));
    expect(onEvict).toHaveBeenCalledTimes(1);
    expect(onEvict).toHaveBeenCalledWith("a", expect.objectContaining({ timestamp: 0 }));
  });

  it("AC5: a frame at an already stored timestamp replaces it and the bytes follow", () => {
    const onEvict = vi.fn();
    const store = new FrameStore<number>({ budgetBytes: 100, onEvict });
    store.add("a", frame(5, 10));
    store.add("a", frame(5, 4));
    expect(store.bytes).toBe(4);
    expect(store.frames("a")).toHaveLength(1);
    expect(onEvict).toHaveBeenCalledWith("a", expect.objectContaining({ bytes: 10 }));
  });

  it("AC5: a frame without a finite timestamp or a valid size is refused and reported", () => {
    const onEvict = vi.fn();
    const store = new FrameStore<number>({ budgetBytes: 100, onEvict });
    store.add("a", frame(Number.NaN, 1));
    store.add("a", frame(1, -1));
    store.add("a", frame(2, Number.POSITIVE_INFINITY));
    expect(store.bytes).toBe(0);
    expect(onEvict).toHaveBeenCalledTimes(3);
  });

  it("AC5: clear() empties every file in one call and reports every frame", () => {
    const onEvict = vi.fn();
    const store = new FrameStore<number>({ budgetBytes: 100, onEvict });
    store.add("a", frame(0, 2));
    store.add("a", frame(1, 2));
    store.add("b", frame(0, 2));
    store.clear();
    expect(store.bytes).toBe(0);
    expect(store.frames("a")).toEqual([]);
    expect(store.frames("b")).toEqual([]);
    expect(onEvict).toHaveBeenCalledTimes(3);
  });

  it("keeps a file's frames sorted by true timestamp whatever the arrival order", () => {
    const store = new FrameStore<number>({ budgetBytes: 100 });
    for (const t of [30, 10, 20, 0, 25]) store.add("a", frame(t));
    expect(stamps(store.frames("a"))).toEqual([0, 10, 20, 25, 30]);
  });

  it("an unknown file gives the same empty snapshot every time, so a subscription never loops", () => {
    const store = new FrameStore<number>({ budgetBytes: 100 });
    expect(store.frames("nope")).toBe(store.frames("other"));
    store.add("a", frame(0));
    expect(store.frames("a")).toBe(store.frames("a"));
  });

  it("hands out snapshots: a later add never mutates an array already returned", () => {
    const store = new FrameStore<number>({ budgetBytes: 100 });
    store.add("a", frame(0));
    const before = store.frames("a");
    store.add("a", frame(1));
    expect(stamps(before)).toEqual([0]);
    expect(stamps(store.frames("a"))).toEqual([0, 1]);
  });
});

describe("slotStepFor: dyadic steps", () => {
  it("rounds a tile span down to 0.25 s times a power of two", () => {
    expect(slotStepFor(0.25)).toBe(0.25);
    expect(slotStepFor(0.49)).toBe(0.25);
    expect(slotStepFor(0.5)).toBe(0.5);
    expect(slotStepFor(5)).toBe(4);
    expect(slotStepFor(105.9)).toBe(64);
    expect(slotStepFor(128)).toBe(128);
  });

  it("never goes finer than 0.25 s, and survives a nonsense span", () => {
    expect(slotStepFor(0.01)).toBe(MIN_SLOT_STEP);
    expect(slotStepFor(0)).toBe(MIN_SLOT_STEP);
    expect(slotStepFor(Number.NaN)).toBe(MIN_SLOT_STEP);
  });
});

describe("planSlots: slots and dyadic fill", () => {
  const base = { duration: 1800, visible: { start: 600, end: 690 }, tileSpan: 5, margin: 0 };

  it("lists the empty slots of the visible range, in the file's own time", () => {
    const slots = planSlots({ ...base, frames: [] });
    // step 4 s: [600,604) … [688,692)
    expect(slots[0]).toMatchObject({ start: 600, end: 604 });
    expect(slots.at(-1)).toMatchObject({ start: 688, end: 692 });
    expect(slots).toHaveLength(23);
    expect(slots.every((s) => s.end - s.start === 4)).toBe(true);
  });

  it("a stored frame anywhere inside a slot fills it, at its true timestamp", () => {
    const slots = planSlots({ ...base, frames: [frame(601.7), frame(689.9)] });
    expect(slots).toHaveLength(21);
    expect(slots.some((s) => s.start === 600)).toBe(false);
    expect(slots.some((s) => s.start === 688)).toBe(false);
  });

  it("a frame exactly on a slot's end belongs to the next slot", () => {
    const slots = planSlots({ ...base, frames: [frame(604)] });
    expect(slots.some((s) => s.start === 600)).toBe(true);
    expect(slots.some((s) => s.start === 604)).toBe(false);
  });

  it("finer frames fill coarser slots: frames from a 1 s step cover every 4 s slot they sit in", () => {
    const fine = [601, 602.5, 605, 609.25, 613].map((t) => frame(t));
    const coarse = planSlots({ ...base, frames: fine });
    const filled = [600, 604, 608, 612];
    for (const start of filled) expect(coarse.some((s) => s.start === start)).toBe(false);
    // and the 1 s plan of the same range asks only where the fine frames are absent
    const finePlan = planSlots({ ...base, tileSpan: 1, frames: fine });
    expect(finePlan.some((s) => s.start === 601)).toBe(false);
    expect(finePlan.some((s) => s.start === 602)).toBe(false); // 602.5 is inside [602,603)
    expect(finePlan.some((s) => s.start === 603)).toBe(true);
  });

  it("slot boundaries are the same at every zoom: a coarse slot is the union of finer ones", () => {
    const wide = { ...base, visible: { start: 600, end: 696 } }; // 696 = 87 × 8
    const coarse = planSlots({ ...wide, tileSpan: 8, frames: [] });
    const fine = planSlots({ ...wide, tileSpan: 2, frames: [] });
    const fineStarts = new Set(fine.map((s) => s.start));
    for (const slot of coarse) {
      for (let t = slot.start; t < slot.end; t += 2) expect(fineStarts.has(t)).toBe(true);
    }
  });

  it("adds a margin of one screen each side by default, flagged apart from the visible slots", () => {
    const slots = planSlots({ ...base, margin: undefined, frames: [] });
    expect(slots[0].start).toBeLessThanOrEqual(600 - 90 + 4);
    expect(slots.at(-1)!.end).toBeGreaterThanOrEqual(690 + 90 - 4);
    expect(slots.filter((s) => s.visible).every((s) => s.end > 600 && s.start < 690)).toBe(true);
    expect(slots.some((s) => !s.visible)).toBe(true);
    expect(slots.filter((s) => !s.visible).every((s) => s.end <= 600 || s.start >= 690)).toBe(true);
  });

  it("stays inside the file: no slot before 0 or starting at or after the duration", () => {
    const slots = planSlots({
      duration: 10,
      visible: { start: 0, end: 10 },
      tileSpan: 1,
      margin: 50,
      frames: [],
    });
    expect(slots[0].start).toBe(0);
    expect(slots.at(-1)!.start).toBeLessThan(10);
  });

  it("returns slots sorted by start", () => {
    const slots = planSlots({ ...base, margin: 90, frames: [] });
    const starts = slots.map((s) => s.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it("plans nothing for a file with an unusable duration or range", () => {
    expect(planSlots({ ...base, duration: 0, frames: [] })).toEqual([]);
    expect(planSlots({ ...base, duration: Number.NaN, frames: [] })).toEqual([]);
    expect(planSlots({ ...base, visible: { start: 50, end: 50 }, margin: 0, frames: [] })).toEqual(
      [],
    );
  });

  it("a file whose timestamps jump (17.8 hours) still gets a bounded plan", () => {
    const slots = planSlots({
      duration: 17.8 * 3600,
      visible: { start: 0, end: 17.8 * 3600 },
      tileSpan: 0.3,
      frames: [],
    });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.length).toBeLessThanOrEqual(FIT_FRAME_CAP);
  });
});

describe("planSlots: AC3 fit zoom never asks for more than 24 frames per file", () => {
  // Fit zoom: the visible range is the whole file; about 17 tiles on a 1,240 px lane.
  const fit = (duration: number, frames: Frame<number>[] = []) =>
    planSlots({
      duration,
      visible: { start: 0, end: duration },
      tileSpan: duration / 17,
      frames,
    });

  it("AC3: an empty file asks for at most 24 frames at fit, from 18 s to 54 minutes", () => {
    for (const duration of [17.7, 18.1 * 60, 31.7 * 60, 33.8 * 60, 54.2 * 60, 6 * 3600]) {
      const slots = fit(duration);
      expect(slots.length).toBeGreaterThan(0);
      expect(slots.length).toBeLessThanOrEqual(FIT_FRAME_CAP);
    }
  });

  it("AC3: the fit slots still cover the whole file, not just its beginning", () => {
    const slots = fit(1800);
    expect(slots[0].start).toBe(0);
    expect(slots.at(-1)!.end).toBeGreaterThanOrEqual(1800);
  });

  it("AC3: one stored frame per fit slot means fit asks for nothing", () => {
    // 1800 s at fit: 15 slots of 128 s; a frame in each, wherever inside the slot
    const spread = Array.from({ length: 15 }, (_, i) => frame(i * 128 + 10));
    expect(fit(1800, spread)).toEqual([]);
  });

  it("AC3: a fit plan only ever lists slots that hold no frame, and at most 24", () => {
    for (let stored = 0; stored <= 30; stored += 3) {
      const frames = Array.from({ length: stored }, (_, i) => frame(i * 60 + 1));
      const slots = fit(1800, frames);
      expect(slots.length).toBeLessThanOrEqual(FIT_FRAME_CAP);
      for (const slot of slots) {
        expect(frames.some((f) => f.timestamp >= slot.start && f.timestamp < slot.end)).toBe(false);
      }
    }
  });

  it("AC3: frames clustered from an earlier zoom-in never block the fit plan for the rest of the file", () => {
    const cluster = Array.from({ length: 40 }, (_, i) => frame(600 + i * 0.5));
    const slots = fit(1800, cluster);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.length).toBeLessThanOrEqual(FIT_FRAME_CAP);
    expect(slots.some((s) => s.start === 0)).toBe(true);
    expect(slots.some((s) => s.end > 1700)).toBe(true);
  });

  it("AC3: zoomed in (the range is not the whole file) the cap does not apply", () => {
    const slots = planSlots({
      duration: 1800,
      visible: { start: 600, end: 690 },
      tileSpan: 5,
      frames: [],
    });
    expect(slots.length).toBeGreaterThan(FIT_FRAME_CAP);
  });
});

describe("pickFrame: AC4 lookup rule", () => {
  const clip = { start: 100, end: 200 };

  it("AC4: prefers a frame from inside the tile's span, the one nearest its centre", () => {
    const frames = [frame(98), frame(121), frame(124), frame(140)];
    expect(pickFrame(frames, { start: 120, end: 126 }, clip)?.timestamp).toBe(124);
  });

  it("AC4: a frame inside the tile beats a nearer-in-time frame outside it", () => {
    const frames = [frame(119.9), frame(125.9)];
    expect(pickFrame(frames, { start: 120, end: 126 }, clip)?.timestamp).toBe(125.9);
  });

  it("AC4: with none in the tile, takes the nearest inside the same clip", () => {
    const frames = [frame(110), frame(150)];
    expect(pickFrame(frames, { start: 130, end: 136 }, clip)?.timestamp).toBe(150);
  });

  it("AC4: never a frame from outside the clip when one inside it exists", () => {
    // 99.9 (before the cut) is 33.1 s from the tile's centre (133); 190 is 57 s away, still the pick.
    const frames = [frame(99.9), frame(190), frame(200.1)];
    expect(pickFrame(frames, { start: 130, end: 136 }, clip)?.timestamp).toBe(190);
  });

  it("AC4: a frame exactly at the clip's end is outside it (half-open range)", () => {
    // sorted, as the store hands them out; 200 is nearer the centre (193) than 120 is
    const frames = [frame(120), frame(200)];
    expect(pickFrame(frames, { start: 190, end: 196 }, clip)?.timestamp).toBe(120);
  });

  it("AC4: a frame on the tile's start is inside it; on the tile's end it is not", () => {
    expect(pickFrame([frame(120)], { start: 120, end: 126 }, clip)?.timestamp).toBe(120);
    const frames = [frame(126), frame(150)];
    expect(pickFrame(frames, { start: 120, end: 126 }, clip)?.timestamp).toBe(126);
    // 126 is outside the tile but inside the clip and nearest to its centre: the clip rule picks it
    expect(pickFrame(frames, { start: 120, end: 126 }, clip)?.timestamp).not.toBe(150);
  });

  it("AC4: never empty when the file has any frame, even all of them outside the clip", () => {
    const frames = [frame(10), frame(300)];
    expect(pickFrame(frames, { start: 130, end: 136 }, clip)?.timestamp).toBe(10);
    expect(pickFrame([frame(500)], { start: 130, end: 136 }, clip)?.timestamp).toBe(500);
  });

  it("AC4: the file-wide fallback is the nearest frame in time", () => {
    const frames = [frame(10), frame(60), frame(300)];
    expect(pickFrame(frames, { start: 130, end: 136 }, clip)?.timestamp).toBe(60);
  });

  it("AC4: null only when the store has no frame at all", () => {
    expect(pickFrame([], { start: 130, end: 136 }, clip)).toBeNull();
  });

  it("AC4: a tile that reaches past the clip only takes frames of the clip's part of it", () => {
    // the tile [95,105) straddles the clip start 100; 97 is in the tile but before the cut
    const frames = [frame(97), frame(103)];
    expect(pickFrame(frames, { start: 95, end: 105 }, clip)?.timestamp).toBe(103);
  });

  it("AC4: a tile entirely in a frame-less clip stretch falls back inside the clip, then to the file", () => {
    const frames = [frame(50), frame(100.5)];
    expect(pickFrame(frames, { start: 150, end: 156 }, clip)?.timestamp).toBe(100.5);
  });

  it("AC4: ties between two frames equally far from the centre pick the earlier one", () => {
    const frames = [frame(121), frame(125)];
    expect(pickFrame(frames, { start: 120, end: 126 }, clip)?.timestamp).toBe(121);
  });

  it("AC4: works over the store's snapshot for a file", () => {
    const store = new FrameStore<number>({ budgetBytes: 100 });
    for (const t of [10, 140, 190]) store.add("a", frame(t));
    expect(pickFrame(store.frames("a"), { start: 130, end: 136 }, clip)?.timestamp).toBe(140);
  });
});
