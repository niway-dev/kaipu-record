import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { initialScene } from "./scene";
import { joinRecording, sourceAxis } from "./source-axis";
import { toLayout } from "./timeline";
import { useMuteEditing } from "./use-mute-editing";
import { useVideoScene } from "./use-video-scene";

const JOIN = { assetId: "asset-b", title: "B", durationSeconds: 20, width: 0, height: 0 };

/** A at [0, 20] and a joined B at [3600, 3620]: timeline 0-20 plays A, 20-40 plays B. */
function setup() {
  return renderHook(() => {
    const controller = useVideoScene(joinRecording(initialScene(20), 20, JOIN, 20).scene);
    const mutes = useMuteEditing(
      controller,
      toLayout(controller.scene.items),
      sourceAxis(20, controller.scene.sources),
    );
    return { controller, mutes };
  });
}

describe("useMuteEditing with a joined recording (ADR 0058)", () => {
  it("mutes from the playhead in B on B's axis seconds", () => {
    const { result } = setup();
    act(() => void result.current.mutes.addAtPlayhead(25));
    expect(result.current.controller.scene.mutedRanges[0]).toMatchObject({
      sourceStart: 3605,
      sourceEnd: 3608,
    });
  });

  it("clamps a mute near the end of B to B's range", () => {
    const { result } = setup();
    act(() => void result.current.mutes.addAtPlayhead(39));
    expect(result.current.controller.scene.mutedRanges[0]).toMatchObject({
      sourceStart: 3619,
      sourceEnd: 3620,
    });
  });

  it("a mute still in A is clamped to A, and an edge drag in B stops at B's range", () => {
    const { result } = setup();
    act(() => void result.current.mutes.addAtPlayhead(19));
    expect(result.current.controller.scene.mutedRanges[0]).toMatchObject({
      sourceStart: 19,
      sourceEnd: 20,
    });
    act(() => void result.current.mutes.addAtPlayhead(25));
    const inB = result.current.controller.scene.mutedRanges.find((r) => r.sourceStart >= 3600)!;
    act(() => result.current.mutes.edgeDrag(inB.id, "end", null, "start"));
    act(() => result.current.mutes.edgeDrag(inB.id, "end", 99999, "move"));
    act(() => result.current.mutes.edgeDrag(inB.id, "end", null, "end"));
    const after = result.current.controller.scene.mutedRanges.find((r) => r.id === inB.id)!;
    expect(after.sourceEnd).toBe(3620);
  });
});
