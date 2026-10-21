import { describe, expect, it } from "vitest";
import { initialScene, type VideoScene } from "./scene";
import { addMuteAt, dragMuteEdge, MUTE_LIMITS, removeMute, toggleMuteAll } from "./mute-edits";

const SOURCE = 30;
/** addMuteAt returns null when there is no room; these cases expect success. */
const added = (scene: VideoScene, at: number) => {
  const result = addMuteAt(scene, at, SOURCE);
  if (!result) throw new Error(`addMuteAt unexpectedly refused at ${at}`);
  return result;
};

const sceneWith = (
  ranges: { id: string; sourceStart: number; sourceEnd: number }[],
): VideoScene => ({
  ...initialScene(SOURCE),
  mutedRanges: ranges,
});

describe("addMuteAt", () => {
  it("adds a range of the default length at the playhead", () => {
    const { scene, id } = added(initialScene(SOURCE), 10);
    expect(scene.mutedRanges).toHaveLength(1);
    expect(scene.mutedRanges[0]).toMatchObject({
      id,
      sourceStart: 10,
      sourceEnd: 10 + MUTE_LIMITS.defaultSeconds,
    });
  });

  it("adds one even where another already sits — overlaps are allowed", () => {
    // Unlike zooms, which need a free window: silence over silence is silence.
    const { scene } = added(sceneWith([{ id: "a", sourceStart: 10, sourceEnd: 15 }]), 12);
    expect(scene.mutedRanges).toHaveLength(2);
  });

  it("clamps a range that would run past the end of the recording", () => {
    const { scene } = added(initialScene(SOURCE), SOURCE - 1);
    expect(scene.mutedRanges[0]!.sourceEnd).toBe(SOURCE);
    expect(scene.mutedRanges[0]!.sourceStart).toBeLessThan(SOURCE);
  });

  it("refuses when there is no room left for the minimum length", () => {
    // At the very last instant there is nothing to silence.
    expect(addMuteAt(initialScene(SOURCE), SOURCE, SOURCE)).toBeNull();
  });

  it("keeps ranges sorted by start", () => {
    const { scene } = added(sceneWith([{ id: "a", sourceStart: 20, sourceEnd: 25 }]), 5);
    expect(scene.mutedRanges.map((r) => r.sourceStart)).toEqual([5, 20]);
  });
});

describe("dragMuteEdge", () => {
  const base = sceneWith([{ id: "a", sourceStart: 10, sourceEnd: 15 }]);

  it("moves the start edge", () => {
    expect(dragMuteEdge(base, "a", "start", 12, SOURCE).mutedRanges[0]).toMatchObject({
      sourceStart: 12,
      sourceEnd: 15,
    });
  });

  it("moves the end edge", () => {
    expect(dragMuteEdge(base, "a", "end", 20, SOURCE).mutedRanges[0]).toMatchObject({
      sourceStart: 10,
      sourceEnd: 20,
    });
  });

  it("never lets an edge cross the other — the minimum length holds", () => {
    const dragged = dragMuteEdge(base, "a", "start", 99, SOURCE).mutedRanges[0]!;
    expect(dragged.sourceEnd - dragged.sourceStart).toBeGreaterThanOrEqual(MUTE_LIMITS.minSeconds);
  });

  it("clamps to the recording's bounds", () => {
    expect(dragMuteEdge(base, "a", "start", -5, SOURCE).mutedRanges[0]!.sourceStart).toBe(0);
    expect(dragMuteEdge(base, "a", "end", 999, SOURCE).mutedRanges[0]!.sourceEnd).toBe(SOURCE);
  });

  it("lets a drag push a range over its neighbour", () => {
    const two = sceneWith([
      { id: "a", sourceStart: 5, sourceEnd: 10 },
      { id: "b", sourceStart: 20, sourceEnd: 25 },
    ]);
    expect(dragMuteEdge(two, "a", "end", 22, SOURCE).mutedRanges[0]!.sourceEnd).toBe(22);
  });

  it("ignores an unknown id instead of throwing", () => {
    expect(dragMuteEdge(base, "nope", "end", 20, SOURCE)).toBe(base);
  });
});

describe("removeMute", () => {
  it("drops the range", () => {
    const scene = sceneWith([
      { id: "a", sourceStart: 5, sourceEnd: 10 },
      { id: "b", sourceStart: 20, sourceEnd: 25 },
    ]);
    expect(removeMute(scene, "a").mutedRanges.map((r) => r.id)).toEqual(["b"]);
  });

  it("returns the same scene for an unknown id", () => {
    const scene = sceneWith([]);
    expect(removeMute(scene, "nope")).toBe(scene);
  });
});

describe("toggleMuteAll", () => {
  it("flips the flag and keeps the ranges", () => {
    const scene = sceneWith([{ id: "a", sourceStart: 5, sourceEnd: 10 }]);
    const muted = toggleMuteAll(scene);
    expect(muted.audioMuted).toBe(true);
    // Kept on purpose: turning the whole-video mute back off must restore the
    // ranges the user drew, not lose them.
    expect(muted.mutedRanges).toHaveLength(1);
    expect(toggleMuteAll(muted).audioMuted).toBe(false);
  });
});
