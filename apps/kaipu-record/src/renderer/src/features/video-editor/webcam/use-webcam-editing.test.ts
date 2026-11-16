import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { WebcamTrackMeta } from "@shared/webcam-track";
import { initialScene, type VideoScene } from "../scene";
import { toLayout } from "../timeline";
import { useVideoScene } from "../use-video-scene";
import { useWebcamEditing } from "./use-webcam-editing";

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
    const webcam = useWebcamEditing({ controller, layout, sourceDuration: 20 });
    return { controller, webcam };
  });
}

describe("useWebcamEditing", () => {
  it("hides the webcam from the playhead to the end as one undo step", () => {
    const { result } = setup();
    let added: ReturnType<typeof result.current.webcam.hideAtPlayhead> | undefined;
    act(() => {
      added = result.current.webcam.hideAtPlayhead(4);
    });
    expect(added).toMatchObject({ ok: true });
    expect(result.current.controller.scene.webcam!.segments).toEqual([
      expect.objectContaining({ start: 4, end: 20, mode: "hidden" }),
    ]);
    act(() => result.current.controller.undo());
    expect(result.current.controller.scene.webcam!.segments).toEqual([]);
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

  describe("change camera from here", () => {
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

    it("creates a block from the playhead as one undo step, and undo removes it", () => {
      const { result } = setup();
      let added: ReturnType<typeof result.current.webcam.changeAtPlayhead> | undefined;
      act(() => {
        added = result.current.webcam.changeAtPlayhead(4);
      });
      expect(added).toMatchObject({ ok: true, kind: "create" });
      expect(result.current.controller.scene.webcam!.segments).toEqual([
        expect.objectContaining({ start: 4, end: 20, mode: "override" }),
      ]);
      act(() => result.current.controller.undo());
      expect(result.current.controller.scene.webcam!.segments).toEqual([]);
      expect(result.current.controller.canUndo).toBe(false);
    });

    it("splits the block under the playhead as one undo step", () => {
      const { result } = setup(withBlock());
      let added: ReturnType<typeof result.current.webcam.changeAtPlayhead> | undefined;
      act(() => {
        added = result.current.webcam.changeAtPlayhead(9);
      });
      expect(added).toMatchObject({ ok: true, kind: "split" });
      expect(result.current.controller.scene.webcam!.segments.map((s) => [s.start, s.end])).toEqual(
        [
          [5, 9],
          [9, 15],
        ],
      );
      act(() => result.current.controller.undo());
      expect(result.current.controller.scene.webcam!.segments.map((s) => [s.start, s.end])).toEqual(
        [[5, 15]],
      );
    });

    it("is unavailable inside a hidden range, with no room, and over a slide, and adds nothing", () => {
      const base = initialScene(20, TRACK);
      const hiddenScene: VideoScene = {
        ...base,
        webcam: {
          ...base.webcam!,
          segments: [{ id: "h", start: 5, end: 10, mode: "hidden" }],
        },
      };
      const { result } = setup(hiddenScene);
      expect(result.current.webcam.changeBlockedReason(7)).toBe("hidden");
      expect(result.current.webcam.changeBlockedReason(4.5)).toBe("no-room");
      expect(result.current.webcam.changeBlockedReason(19.5)).toBe("no-room");
      expect(result.current.webcam.changeBlockedReason(2)).toBeNull();
      let refused: ReturnType<typeof result.current.webcam.changeAtPlayhead> | undefined;
      act(() => {
        refused = result.current.webcam.changeAtPlayhead(7);
      });
      expect(refused).toEqual({ ok: false, reason: "hidden" });
      expect(result.current.controller.canUndo).toBe(false);
    });

    it("is unavailable over a slide", () => {
      const base = initialScene(20, TRACK);
      const slide = {
        id: "s",
        kind: "slide" as const,
        assetId: "a",
        duration: 3,
        naturalWidth: 10,
        naturalHeight: 10,
      };
      const { result } = setup({ ...base, items: [slide, ...base.items] });
      expect(result.current.webcam.changeBlockedReason(1)).toBe("on-slide");
      // The recording starts at timeline 3.
      expect(result.current.webcam.changeBlockedReason(4)).toBeNull();
    });

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
