import { describe, expect, it } from "vitest";
import type { Slot } from "./filmstrip-frames";
import { MAX_EXACT_PACKETS } from "./filmstrip-messages";
import {
  countPacketsTo,
  groupByKeyframe,
  orderSlots,
  planSlot,
  type PacketIndex,
  type PlannedSlot,
} from "./filmstrip-plan";

/** A slot of `step` seconds at index `n`; `visible` unless told otherwise. */
const slot = (n: number, step = 2, visible = true): Slot => ({
  index: n,
  start: n * step,
  end: (n + 1) * step,
  visible,
});

const indexes = (slots: readonly Slot[]) => slots.map((s) => s.index);

describe("orderSlots: decision 14, playhead first, then visible, then the margin ahead", () => {
  it("decodes the visible slots nearest the playhead first", () => {
    const slots = [0, 1, 2, 3, 4, 5].map((n) => slot(n));
    // The playhead is inside slot 3 (6–8 s).
    const ordered = orderSlots(slots, { playhead: 7, direction: 0 });
    expect(indexes(ordered)).toEqual([3, 2, 4, 1, 5, 0]);
  });

  it("puts every visible slot before any margin slot", () => {
    const slots = [slot(0, 2, false), slot(1), slot(2), slot(3, 2, false)];
    const ordered = orderSlots(slots, { playhead: 3, direction: 0 });
    expect(indexes(ordered).slice(0, 2).sort()).toEqual([1, 2]);
    expect(indexes(ordered).slice(2).sort()).toEqual([0, 3]);
  });

  it("decodes the margin nearest the view first, on both sides when the view is not moving", () => {
    const slots = [
      slot(0, 2, false),
      slot(1, 2, false),
      slot(2),
      slot(3),
      slot(4, 2, false),
      slot(5, 2, false),
    ];
    const ordered = orderSlots(slots, { playhead: 4, direction: 0 });
    // Visible: 2 and 3. Margin by distance to the view: 1 and 4 (adjacent), then 0 and 5.
    expect(indexes(ordered).slice(2, 4).sort()).toEqual([1, 4]);
    expect(indexes(ordered).slice(4).sort()).toEqual([0, 5]);
  });

  it("drops the margin behind the view while it moves forward", () => {
    const slots = [slot(0, 2, false), slot(1), slot(2), slot(3, 2, false)];
    expect(indexes(orderSlots(slots, { playhead: 3, direction: 1 }))).not.toContain(0);
    expect(indexes(orderSlots(slots, { playhead: 3, direction: 1 }))).toContain(3);
  });

  it("drops the margin ahead of the view while it moves backward", () => {
    const slots = [slot(0, 2, false), slot(1), slot(2), slot(3, 2, false)];
    const ordered = indexes(orderSlots(slots, { playhead: 3, direction: -1 }));
    expect(ordered).toContain(0);
    expect(ordered).not.toContain(3);
  });

  it("keeps the margin on both sides when no slot is visible (nothing to measure a side from)", () => {
    const slots = [slot(0, 2, false), slot(1, 2, false)];
    expect(orderSlots(slots, { playhead: 0, direction: 1 })).toHaveLength(2);
  });

  it("does not change the list it was given", () => {
    const slots = [slot(2), slot(0), slot(1)];
    const copy = [...slots];
    orderSlots(slots, { playhead: 0, direction: 0 });
    expect(slots).toEqual(copy);
  });

  it("cuts a list over the cap after ordering, so what is dropped is the least wanted", () => {
    const slots = [0, 1, 2, 3, 4, 5].map((n) => slot(n, 2, n === 3));
    const ordered = orderSlots(slots, { playhead: 7, direction: 0 }, 3);
    expect(ordered).toHaveLength(3);
    expect(ordered[0].index).toBe(3);
  });
});

describe("countPacketsTo: the packet count planned before an exact decode (AC8)", () => {
  async function* stamps(values: number[], seen: { returned: boolean }) {
    try {
      for (const value of values) yield value;
    } finally {
      seen.returned = true;
    }
  }

  it("counts the packets from the keyframe up to and including the target", async () => {
    const seen = { returned: false };
    const result = await countPacketsTo(stamps([0, 0.1, 0.2, 0.3, 0.4], seen), 0.2, 300);
    expect(result).toEqual({ count: 3, reached: true });
  });

  it("stops reading as soon as the limit is passed, and releases the iterator", async () => {
    const seen = { returned: false };
    const values = Array.from({ length: 1000 }, (_, i) => i / 100);
    const result = await countPacketsTo(stamps(values, seen), 9.99, 300);
    expect(result.reached).toBe(false);
    expect(result.count).toBe(301);
    expect(seen.returned).toBe(true);
  });

  it("AC8: exactly the limit is still within it, one more is not", async () => {
    const values = Array.from({ length: 400 }, (_, i) => i);
    const seen = { returned: false };
    expect(await countPacketsTo(stamps(values, seen), 299, 300)).toEqual({
      count: 300,
      reached: true,
    });
    expect(await countPacketsTo(stamps(values, seen), 300, 300)).toEqual({
      count: 301,
      reached: false,
    });
  });

  it("is not reached when the packets run out before the target", async () => {
    const seen = { returned: false };
    const result = await countPacketsTo(stamps([0, 1, 2], seen), 9, 300);
    expect(result).toEqual({ count: 3, reached: false });
  });

  it("counts a target that is not the last in presentation order (B-frames)", async () => {
    // Decode order: I P B B; the target 0.1 is the third packet.
    const seen = { returned: false };
    const result = await countPacketsTo(stamps([0, 0.3, 0.1, 0.2], seen), 0.1, 300);
    expect(result).toEqual({ count: 3, reached: true });
  });
});

/** A fake container: keyframes and frames at the given timestamps, in presentation order. */
function fakeIndex(options: {
  keys: number[];
  frames: number[];
  /** Packets between a keyframe and its target, when the test needs a specific count. */
  packetsFrom?: (keyTimestamp: number) => number[];
}): PacketIndex {
  const { keys, frames } = options;
  const lastAtOrBefore = (list: number[], t: number): number | null => {
    const hits = list.filter((x) => x <= t);
    return hits.length ? Math.max(...hits) : null;
  };
  return {
    keyAtOrBefore: async (t) => lastAtOrBefore(keys, t),
    frameAtOrBefore: async (t) => lastAtOrBefore(frames, t),
    packetTimestampsFrom: (keyTimestamp) =>
      (async function* () {
        const list = options.packetsFrom?.(keyTimestamp) ?? frames.filter((f) => f >= keyTimestamp);
        for (const value of list) yield value;
      })(),
  };
}

describe("planSlot: keyframe first, otherwise a counted exact decode", () => {
  it("decodes the key packet alone when one sits inside the slot", async () => {
    const index = fakeIndex({ keys: [0, 2, 4], frames: [0, 1, 2, 3, 4, 5] });
    const plan = await planSlot(index, slot(1)); // [2, 4)
    expect(plan).toMatchObject({
      kind: "plan",
      keyframe: true,
      keyTimestamp: 2,
      targetTimestamp: 2,
    });
  });

  it("takes a keyframe exactly at the slot start, but not one exactly at its end", async () => {
    const index = fakeIndex({ keys: [0, 4], frames: [0, 1, 2, 3, 4] });
    // Slot [2, 4): the keyframe at 4 belongs to the next slot, so this one is exact.
    const plan = await planSlot(index, slot(1));
    expect(plan).toMatchObject({ kind: "plan", keyframe: false, keyTimestamp: 0 });
  });

  it("targets the frame at the slot centre when there is no keyframe inside", async () => {
    const index = fakeIndex({ keys: [0], frames: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5] });
    const plan = await planSlot(index, slot(1)); // [2, 4), centre 3
    expect(plan).toMatchObject({
      kind: "plan",
      keyframe: false,
      keyTimestamp: 0,
      targetTimestamp: 3,
    });
  });

  it("AC8: skips a slot whose exact decode needs more than the packet cap", async () => {
    const capped = await planSlot(
      fakeIndex({
        keys: [0],
        frames: Array.from({ length: 5000 }, (_, i) => i),
      }),
      slot(2000, 1), // [2000, 2001): its frame is the 2001st packet from the keyframe
    );
    expect(capped).toEqual({ kind: "skip", reason: "over-cap" });
  });

  it("AC8: an exact decode of exactly the cap goes ahead", async () => {
    const frames = Array.from({ length: 400 }, (_, i) => i);
    const index = fakeIndex({ keys: [0], frames });
    // Slot [150, 152): the centre frame is 151, the 152nd packet from the keyframe.
    const plan = await planSlot(index, slot(75, 2));
    expect(plan.kind).toBe("plan");
    // Cap boundary: the 300th packet is allowed, the 301st is not.
    const edge = await planSlot(index, { index: 0, start: 298.5, end: 299.5, visible: true });
    expect(edge).toMatchObject({ kind: "plan", targetTimestamp: 299 });
    expect(MAX_EXACT_PACKETS).toBe(300);
    const over = await planSlot(index, { index: 0, start: 299.5, end: 300.5, visible: true });
    expect(over).toEqual({ kind: "skip", reason: "over-cap" });
  });

  it("takes the frame just before the centre when it is still inside the slot", async () => {
    // Frames 2.9 and 3.8: the centre 3 reaches 2.9, which is inside [2, 4).
    const index = fakeIndex({ keys: [0], frames: [0, 2.9, 3.8] });
    const plan = await planSlot(index, slot(1));
    expect(plan).toMatchObject({ kind: "plan", targetTimestamp: 2.9 });
  });

  it("looks at the end of the slot when the centre only reaches back before it", async () => {
    // Centre 3 finds 1.9 (before the slot); the end query finds 3.9 which is inside.
    const index = fakeIndex({ keys: [0], frames: [0, 1.9, 3.9] });
    const plan = await planSlot(index, slot(1));
    expect(plan).toMatchObject({ kind: "plan", targetTimestamp: 3.9 });
  });

  it("skips a slot with no frame inside (a gap in the file)", async () => {
    const index = fakeIndex({ keys: [0], frames: [0, 1, 9] });
    expect(await planSlot(index, slot(2))).toEqual({ kind: "skip", reason: "no-frame" });
  });

  it("skips a slot before the first keyframe", async () => {
    const index = fakeIndex({ keys: [5], frames: [5, 6] });
    expect(await planSlot(index, slot(0))).toEqual({ kind: "skip", reason: "no-frame" });
  });
});

describe("groupByKeyframe: a packet is never decoded twice", () => {
  const planned = (
    n: number,
    keyTimestamp: number,
    targetTimestamp: number,
    rank: number,
  ): PlannedSlot => ({
    kind: "plan",
    slot: slot(n, 0.5),
    keyframe: keyTimestamp === targetTimestamp,
    keyTimestamp,
    targetTimestamp,
    rank,
  });

  it("puts the slots that share a keyframe in one group, in timestamp order", () => {
    const groups = groupByKeyframe([
      planned(3, 0, 1.6, 0),
      planned(1, 0, 0.6, 1),
      planned(2, 0, 1.1, 2),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.targetTimestamp)).toEqual([0.6, 1.1, 1.6]);
  });

  it("orders the groups by their best-ranked slot", () => {
    const groups = groupByKeyframe([
      planned(8, 4, 4.6, 5),
      planned(0, 0, 0, 0),
      planned(4, 2, 2.6, 3),
      planned(5, 2, 2.1, 1),
    ]);
    expect(groups.map((g) => g.keyTimestamp)).toEqual([0, 2, 4]);
  });

  it("is empty for nothing", () => {
    expect(groupByKeyframe([])).toEqual([]);
  });
});
