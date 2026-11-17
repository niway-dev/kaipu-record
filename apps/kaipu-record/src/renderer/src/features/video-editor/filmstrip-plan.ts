/**
 * What the filmstrip worker decides before it decodes anything (ADR 0064): in which order the
 * slots are served, how a slot is filled (the key packet inside it, or an exact decode that was
 * counted first), and which slots share a decode. Pure: the container is reached through
 * {@link PacketIndex}, so the logic runs under test with a fake and in the worker with
 * mediabunny behind it (`filmstrip-mediabunny.ts`).
 */
import type { Slot } from "./filmstrip-frames";
import { MAX_EXACT_PACKETS, MAX_REQUEST_SLOTS, type ScrollDirection } from "./filmstrip-messages";

// ---------------------------------------------------------------------------------------
// Order
// ---------------------------------------------------------------------------------------

export interface OrderOptions {
  /** The playhead in the file's own time. */
  playhead: number;
  direction: ScrollDirection;
}

/** Seconds between a time and a half-open range; 0 when it is inside. */
function distanceToRange(start: number, end: number, from: number, to: number): number {
  return Math.max(0, from - end, start - to);
}

/**
 * The order slots are served (decision 14): the visible slots nearest the playhead first, then
 * the rest of the visible slots (by the same distance), then the margin nearest the view first,
 * and the margin only on the side the view is moving toward. A view that is not moving keeps
 * both sides. The list is cut to `cap` after ordering, so what is dropped is the least wanted.
 * Does not change its input.
 */
export function orderSlots(
  slots: readonly Slot[],
  options: OrderOptions,
  cap: number = MAX_REQUEST_SLOTS,
): Slot[] {
  const visible = slots.filter((s) => s.visible);
  const margin = slots.filter((s) => !s.visible);

  const byPlayhead = (a: Slot, b: Slot) =>
    distanceToRange(a.start, a.end, options.playhead, options.playhead) -
      distanceToRange(b.start, b.end, options.playhead, options.playhead) || a.start - b.start;
  visible.sort(byPlayhead);

  if (visible.length === 0) {
    // Nothing to measure a side from, so nothing is dropped; nearest the playhead first.
    return margin.sort(byPlayhead).slice(0, cap);
  }

  const viewStart = Math.min(...visible.map((s) => s.start));
  const viewEnd = Math.max(...visible.map((s) => s.end));
  const wanted = margin.filter((s) => {
    if (options.direction > 0) return s.start >= viewEnd;
    if (options.direction < 0) return s.end <= viewStart;
    return true;
  });
  const fromView = (s: Slot) => distanceToRange(s.start, s.end, viewStart, viewEnd);
  wanted.sort((a, b) => fromView(a) - fromView(b) || a.start - b.start);

  return [...visible, ...wanted].slice(0, cap);
}

// ---------------------------------------------------------------------------------------
// Planning one slot
// ---------------------------------------------------------------------------------------

/**
 * The container, as the planner needs it. Every call reads packet METADATA only (no packet
 * data, no decoding), so planning stays cheap on a 10 GB file.
 */
export interface PacketIndex {
  /** Timestamp of the last key packet at or before `t`; null when there is none. */
  keyAtOrBefore(t: number): Promise<number | null>;
  /** Timestamp of the last frame (presentation order) at or before `t`; null when none. */
  frameAtOrBefore(t: number): Promise<number | null>;
  /**
   * Timestamps of the packets in DECODE order from the key packet at `keyTimestamp`. Reading
   * this is how an exact decode is counted before it runs; the caller releases it early.
   */
  packetTimestampsFrom(keyTimestamp: number): AsyncIterable<number>;
}

/** A slot with the work that fills it. */
export interface PlannedSlot {
  kind: "plan";
  slot: Slot;
  /** True when the key packet itself is inside the slot: one packet decoded, nothing else. */
  keyframe: boolean;
  /** The key packet decoding starts from. */
  keyTimestamp: number;
  /** The frame the slot is filled with: the key packet's own, or an exact one inside the slot. */
  targetTimestamp: number;
  /** Position in the served order; lower is wanted sooner. */
  rank: number;
}

export type SkipReason = "no-frame" | "over-cap";

export interface SkippedSlot {
  kind: "skip";
  reason: SkipReason;
}

/** Smaller than the finest timestamp resolution (1/90000 s), so "just before the slot end". */
const EPSILON = 1e-6;

/**
 * Packets counted from the key packet to the target, in decode order. Stops, and releases the
 * iterator, as soon as the count passes `limit`: a file with one keyframe must never be walked
 * to its end to learn the answer. `reached` is false when the limit was passed or the packets
 * ran out before the target.
 */
export async function countPacketsTo(
  timestamps: AsyncIterable<number>,
  target: number,
  limit: number,
): Promise<{ count: number; reached: boolean }> {
  let count = 0;
  for await (const timestamp of timestamps) {
    count += 1;
    if (timestamp === target) return { count, reached: count <= limit };
    if (count > limit) return { count, reached: false };
  }
  return { count, reached: false };
}

/**
 * How one slot is filled (decisions 3 and 4):
 *
 * 1. The key packet at or before the slot's end. If it is inside the slot, that packet alone is
 *    decoded.
 * 2. Otherwise the frame at the slot's centre (else the last frame inside it) is the target, and
 *    the packets from the key packet to it are counted first: at {@link MAX_EXACT_PACKETS} or
 *    fewer it is decoded, above it the slot is skipped and its tile keeps the nearest frame.
 *
 * A slot with no frame inside it (a gap in the file, or before the first key packet) is skipped.
 * `rank` is filled in by the caller; the planner returns it as 0.
 */
export async function planSlot(
  index: PacketIndex,
  slot: Slot,
  limit: number = MAX_EXACT_PACKETS,
): Promise<PlannedSlot | SkippedSlot> {
  const key = await index.keyAtOrBefore(slot.end - EPSILON);
  if (key === null) return { kind: "skip", reason: "no-frame" };
  if (key >= slot.start) {
    return { kind: "plan", slot, keyframe: true, keyTimestamp: key, targetTimestamp: key, rank: 0 };
  }

  let target = await index.frameAtOrBefore((slot.start + slot.end) / 2);
  if (target === null || target < slot.start) {
    target = await index.frameAtOrBefore(slot.end - EPSILON);
  }
  if (target === null || target < slot.start) return { kind: "skip", reason: "no-frame" };

  const counted = await countPacketsTo(index.packetTimestampsFrom(key), target, limit);
  if (!counted.reached) return { kind: "skip", reason: "over-cap" };
  return {
    kind: "plan",
    slot,
    keyframe: false,
    keyTimestamp: key,
    targetTimestamp: target,
    rank: 0,
  };
}

// ---------------------------------------------------------------------------------------
// Sharing a decode
// ---------------------------------------------------------------------------------------

/** Slots that start from the same key packet: decoded in one pass, so no packet runs twice. */
export interface DecodeGroup {
  keyTimestamp: number;
  /** Ascending by target timestamp. */
  items: PlannedSlot[];
}

/**
 * Groups planned slots by the key packet they start from. Inside a group the slots are in
 * timestamp order (one forward pass serves them all); the groups are ordered by their
 * best-ranked slot, so the slots the user looks at first still arrive first.
 */
export function groupByKeyframe(plans: readonly PlannedSlot[]): DecodeGroup[] {
  const groups = new Map<number, DecodeGroup & { best: number }>();
  for (const plan of plans) {
    const group = groups.get(plan.keyTimestamp) ?? {
      keyTimestamp: plan.keyTimestamp,
      items: [],
      best: Infinity,
    };
    group.items.push(plan);
    group.best = Math.min(group.best, plan.rank);
    groups.set(plan.keyTimestamp, group);
  }
  return [...groups.values()]
    .sort((a, b) => a.best - b.best || a.keyTimestamp - b.keyTimestamp)
    .map(({ keyTimestamp, items }) => ({
      keyTimestamp,
      items: items.sort((a, b) => a.targetTimestamp - b.targetTimestamp),
    }));
}
