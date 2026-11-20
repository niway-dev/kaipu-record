import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { WebcamTrackMeta } from "@shared/webcam-track";
import { initialScene, type VideoScene } from "../scene";
import { joinRecording, sourceAxis } from "../source-axis";
import { toLayout } from "../timeline";
import { useVideoScene } from "../use-video-scene";
import { useWebcamEditing } from "./use-webcam-editing";
import type { WebcamLayout } from "./webcam-model";
import { webcamResizeTarget, webcamResizeWriteTime, type WebcamPanelTab } from "./webcam-resize";

const TRACK: WebcamTrackMeta = {
  startOffsetMs: 0,
  offsetQuality: "exact",
  width: 1280,
  height: 720,
  fps: 30,
};

function setup(initial: VideoScene = initialScene(20, TRACK)) {
  return renderHook(() => {
    const controller = useVideoScene(initial);
    const layout = toLayout(controller.scene.items);
    const webcam = useWebcamEditing({
      controller,
      layout,
      axis: sourceAxis(20, controller.scene.sources),
    });
    return { controller, webcam };
  });
}

describe("useWebcamEditing", () => {
  it("hides the webcam for 10 seconds from the playhead as one undo step", () => {
    const { result } = setup();
    let added: ReturnType<typeof result.current.webcam.hideAtPlayhead> | undefined;
    act(() => {
      added = result.current.webcam.hideAtPlayhead(4);
    });
    expect(added).toMatchObject({ ok: true });
    expect(result.current.controller.scene.webcam!.segments).toEqual([
      expect.objectContaining({ start: 4, end: 14, mode: "hidden" }),
    ]);
    act(() => result.current.controller.undo());
    expect(result.current.controller.scene.webcam!.segments).toEqual([]);
  });

  it("hides up to the end of the recording when that comes within 10 seconds", () => {
    const { result } = setup();
    act(() => void result.current.webcam.hideAtPlayhead(15));
    expect(result.current.controller.scene.webcam!.segments.map((s) => [s.start, s.end])).toEqual([
      [15, 20],
    ]);
  });

  it("stops the hidden segment at the next one", () => {
    const { result } = setup();
    act(() => void result.current.webcam.hideAtPlayhead(10));
    act(() => void result.current.webcam.hideAtPlayhead(2));
    const segments = result.current.controller.scene.webcam!.segments;
    expect(segments.map((s) => [s.start, s.end])).toEqual([
      [2, 10],
      [10, 20],
    ]);
  });

  it("inside a segment returns that segment and adds nothing", () => {
    const { result } = setup();
    let first: ReturnType<typeof result.current.webcam.hideAtPlayhead> | undefined;
    let second: ReturnType<typeof result.current.webcam.hideAtPlayhead> | undefined;
    act(() => {
      first = result.current.webcam.hideAtPlayhead(4);
    });
    act(() => {
      second = result.current.webcam.hideAtPlayhead(6);
    });
    expect(second).toEqual(first);
    expect(result.current.controller.scene.webcam!.segments).toHaveLength(1);
  });

  it("refuses less than the minimum before the end", () => {
    const { result } = setup();
    let added: ReturnType<typeof result.current.webcam.hideAtPlayhead> | undefined;
    act(() => {
      added = result.current.webcam.hideAtPlayhead(19.5);
    });
    expect(added).toEqual({ ok: false, reason: "no-room" });
  });

  it("a drag of the bubble is one undo step on the global layout", () => {
    const { result } = setup();
    const before = result.current.controller.scene.webcam!.layout.position;
    act(() => result.current.webcam.begin());
    act(() => result.current.webcam.liveLayout({ position: { x: 0.4, y: 0.4 } }, 1));
    act(() => result.current.webcam.liveLayout({ position: { x: 0.6, y: 0.3 } }, 1));
    act(() => result.current.webcam.end());
    expect(result.current.controller.scene.webcam!.layout.position).toEqual({ x: 0.6, y: 0.3 });
    act(() => result.current.controller.undo());
    expect(result.current.controller.scene.webcam!.layout.position).toEqual(before);
    expect(result.current.controller.canUndo).toBe(false);
  });

  // The page sends a corner drag's live patch where `webcamResizeTarget` points for the Camera
  // panel's open tab, at the time `webcamResizeWriteTime` gives: the same two calls the page makes.
  describe("a corner drag of the bubble, by the Camera panel's tab", () => {
    const withPart = (layout: Partial<WebcamLayout>): VideoScene => {
      const base = initialScene(20, TRACK);
      return {
        ...base,
        webcam: {
          ...base.webcam!,
          segments: [{ id: "o", start: 5, end: 8, mode: "override", layout }],
        },
      };
    };
    const drag = (
      result: ReturnType<typeof setup>["result"],
      tab: WebcamPanelTab,
      sourceTime: number,
      position?: WebcamLayout["position"],
    ): void => {
      const webcam = result.current.controller.scene.webcam!;
      const target = webcamResizeTarget(webcam, tab, sourceTime);
      const at = webcamResizeWriteTime(target, sourceTime);
      act(() => result.current.webcam.begin());
      for (const size of [0.3, 0.4]) {
        act(() => result.current.webcam.liveLayout(position ? { size, position } : { size }, at));
      }
      act(() => result.current.webcam.end());
    };
    const POSITION = { x: 0.8, y: 0.2 };

    it('"This part" writes the size into the part at the playhead, as one undo step', () => {
      const { result } = setup(withPart({ position: POSITION }));
      const globalSize = result.current.controller.scene.webcam!.layout.size;
      drag(result, "part", 6);
      const webcam = result.current.controller.scene.webcam!;
      expect(webcam.segments[0].layout).toEqual({ position: POSITION, size: 0.4 });
      expect(webcam.layout.size).toBe(globalSize);
      act(() => result.current.controller.undo());
      expect(result.current.controller.scene.webcam!.segments[0].layout).toEqual({
        position: POSITION,
      });
      expect(result.current.controller.canUndo).toBe(false);
    });

    it('"Whole video" writes the size into the whole layout when the part owns only its position', () => {
      const { result } = setup(withPart({ position: POSITION }));
      drag(result, "whole", 6);
      const webcam = result.current.controller.scene.webcam!;
      expect(webcam.layout.size).toBe(0.4);
      expect(webcam.segments[0].layout).toEqual({ position: POSITION });
      act(() => result.current.controller.undo());
      expect(result.current.controller.canUndo).toBe(false);
    });

    // The opposite-corner anchor moves the bubble while it grows: the page forwards both together.
    const MOVED = { x: 0.7, y: 0.3 };

    it('"This part" writes size and position into the same part, as one undo step', () => {
      const { result } = setup(withPart({ position: POSITION }));
      const globalLayout = result.current.controller.scene.webcam!.layout;
      drag(result, "part", 6, MOVED);
      const webcam = result.current.controller.scene.webcam!;
      expect(webcam.segments[0].layout).toEqual({ position: MOVED, size: 0.4 });
      expect(webcam.layout).toEqual(globalLayout);
      act(() => result.current.controller.undo());
      expect(result.current.controller.scene.webcam!.segments[0].layout).toEqual({
        position: POSITION,
      });
      expect(result.current.controller.scene.webcam!.layout).toEqual(globalLayout);
      expect(result.current.controller.canUndo).toBe(false);
    });

    it('"Whole video" writes size and position into the whole layout, as one undo step', () => {
      const { result } = setup(withPart({}));
      const before = result.current.controller.scene.webcam!.layout;
      drag(result, "whole", 6, MOVED);
      const webcam = result.current.controller.scene.webcam!;
      expect(webcam.layout).toMatchObject({ size: 0.4, position: MOVED });
      expect(webcam.segments[0].layout).toEqual({});
      act(() => result.current.controller.undo());
      expect(result.current.controller.scene.webcam!.layout).toEqual(before);
      expect(result.current.controller.canUndo).toBe(false);
    });

    it('"Whole video" writes the size into the whole layout when the part owns nothing', () => {
      const { result } = setup(withPart({}));
      drag(result, "whole", 6);
      const webcam = result.current.controller.scene.webcam!;
      expect(webcam.layout.size).toBe(0.4);
      expect(webcam.segments[0].layout).toEqual({});
    });

    it('"Whole video" writes into the part when the part owns its size, so the bubble resizes', () => {
      const { result } = setup(withPart({ size: 0.2 }));
      const globalSize = result.current.controller.scene.webcam!.layout.size;
      drag(result, "whole", 6);
      const webcam = result.current.controller.scene.webcam!;
      expect(webcam.segments[0].layout).toEqual({ size: 0.4 });
      expect(webcam.layout.size).toBe(globalSize);
      act(() => result.current.controller.undo());
      expect(result.current.controller.scene.webcam!.segments[0].layout).toEqual({ size: 0.2 });
      expect(result.current.controller.canUndo).toBe(false);
    });

    it('"Whole video" writes into the part when the part owns its shape', () => {
      const { result } = setup(withPart({ shape: "rounded" }));
      const globalSize = result.current.controller.scene.webcam!.layout.size;
      drag(result, "whole", 6);
      const webcam = result.current.controller.scene.webcam!;
      expect(webcam.segments[0].layout).toEqual({ shape: "rounded", size: 0.4 });
      expect(webcam.layout.size).toBe(globalSize);
    });
  });

  it("inside an override, a layout edit changes the override, not the global layout", () => {
    const base = initialScene(20, TRACK);
    const scene: VideoScene = {
      ...base,
      webcam: {
        ...base.webcam!,
        segments: [{ id: "o", start: 5, end: 8, mode: "override", layout: { size: 0.4 } }],
      },
    };
    const { result } = setup(scene);
    act(() => result.current.webcam.commitLayout({ shape: "rounded" }, 6));
    const webcam = result.current.controller.scene.webcam!;
    expect(webcam.segments[0].layout).toEqual({ size: 0.4, shape: "rounded" });
    expect(webcam.layout.shape).toBe("circle");
    act(() => result.current.webcam.commitLayout({ shape: "rounded" }, 9));
    expect(result.current.controller.scene.webcam!.layout.shape).toBe("rounded");
  });

  it("removes a segment and drags its edge within the history contract", () => {
    const { result } = setup();
    let id = "";
    act(() => {
      const r = result.current.webcam.hideAtPlayhead(4);
      if (r.ok) id = r.id;
    });
    act(() => result.current.webcam.edgeDrag(id, "end", 20, "start"));
    act(() => result.current.webcam.edgeDrag(id, "end", 12, "move"));
    act(() => result.current.webcam.edgeDrag(id, "end", null, "end"));
    expect(result.current.controller.scene.webcam!.segments[0].end).toBe(12);
    act(() => result.current.webcam.remove(id));
    expect(result.current.controller.scene.webcam!.segments).toEqual([]);
  });

  it("does nothing for a recording without a webcam", () => {
    const { result } = setup(initialScene(20));
    let added: ReturnType<typeof result.current.webcam.hideAtPlayhead> | undefined;
    act(() => {
      added = result.current.webcam.hideAtPlayhead(4);
    });
    expect(added).toMatchObject({ ok: false });
    act(() => result.current.webcam.commitLayout({ shape: "rounded" }, 1));
    expect(result.current.controller.scene.webcam).toBeNull();
    expect(result.current.controller.canUndo).toBe(false);
    expect(result.current.webcam.visibleSegments).toEqual([]);
  });

  describe("dragging inside a block", () => {
    const withBlock = (): VideoScene => {
      const base = initialScene(20, TRACK);
      return {
        ...base,
        webcam: {
          ...base.webcam!,
          segments: [
            {
              id: "o",
              start: 5,
              end: 15,
              mode: "override",
              layout: { position: { x: 0.8, y: 0.2 } },
            },
          ],
        },
      };
    };

    it("a drag inside a block moves that block only, and undo restores its position in one step", () => {
      const { result } = setup(withBlock());
      const globalBefore = result.current.controller.scene.webcam!.layout.position;
      act(() => result.current.webcam.begin());
      act(() => result.current.webcam.liveLayout({ position: { x: 0.3, y: 0.3 } }, 6));
      act(() => result.current.webcam.liveLayout({ position: { x: 0.2, y: 0.6 } }, 6));
      act(() => result.current.webcam.end());
      const webcam = result.current.controller.scene.webcam!;
      expect(webcam.segments[0].layout!.position).toEqual({ x: 0.2, y: 0.6 });
      expect(webcam.layout.position).toEqual(globalBefore);
      act(() => result.current.controller.undo());
      expect(result.current.controller.scene.webcam!.segments[0].layout!.position).toEqual({
        x: 0.8,
        y: 0.2,
      });
    });
  });

  describe("transition edits", () => {
    const withSlideBlock = (): VideoScene => {
      const base = initialScene(20, TRACK);
      return {
        ...base,
        webcam: {
          ...base.webcam!,
          segments: [
            {
              id: "o",
              start: 5,
              end: 15,
              mode: "override",
              transition: { kind: "slide", ms: 700, easing: "back" },
            },
          ],
        },
      };
    };

    it("a discrete change is one undo step", () => {
      const { result } = setup(withSlideBlock());
      act(() => result.current.webcam.commitTransition("o", { kind: "cut" }));
      expect(result.current.controller.scene.webcam!.segments[0].transition?.kind).toBe("cut");
      act(() => result.current.controller.undo());
      expect(result.current.controller.scene.webcam!.segments[0].transition?.kind).toBe("slide");
      expect(result.current.controller.canUndo).toBe(false);
    });

    it("a duration drag is one undo step", () => {
      const { result } = setup(withSlideBlock());
      act(() => result.current.webcam.begin());
      act(() => result.current.webcam.liveTransition("o", { ms: 900 }));
      act(() => result.current.webcam.liveTransition("o", { ms: 1200 }));
      act(() => result.current.webcam.end());
      expect(result.current.controller.scene.webcam!.segments[0].transition?.ms).toBe(1200);
      act(() => result.current.controller.undo());
      expect(result.current.controller.scene.webcam!.segments[0].transition?.ms).toBe(700);
      expect(result.current.controller.canUndo).toBe(false);
    });

    it("an unchanged value pushes no undo step", () => {
      const { result } = setup(withSlideBlock());
      act(() => result.current.webcam.commitTransition("o", { ms: 700 }));
      expect(result.current.controller.canUndo).toBe(false);
    });
  });
});

describe("useWebcamEditing with a joined recording (ADR 0058)", () => {
  const JOIN = { assetId: "asset-b", title: "B", durationSeconds: 20, width: 0, height: 0 };
  const joined = () => joinRecording(initialScene(20, TRACK), 20, JOIN, 20).scene;

  it("hides from the playhead in B and stops at the end of B's range", () => {
    const { result } = setup(joined());
    // 3615 s on the axis: 10 s would run past B's end at 3620.
    act(() => void result.current.webcam.hideAtPlayhead(35));
    expect(result.current.controller.scene.webcam!.segments).toEqual([
      expect.objectContaining({ start: 3615, end: 3620, mode: "hidden" }),
    ]);
  });

  it("an edge drag in B stops at B's range", () => {
    const { result } = setup(joined());
    act(() => void result.current.webcam.hideAtPlayhead(25));
    const id = result.current.controller.scene.webcam!.segments[0].id;
    act(() => result.current.webcam.edgeDrag(id, "start", null, "start"));
    act(() => result.current.webcam.edgeDrag(id, "start", 5, "move"));
    act(() => result.current.webcam.edgeDrag(id, "start", null, "end"));
    expect(result.current.controller.scene.webcam!.segments[0].start).toBe(3600);
  });
});
