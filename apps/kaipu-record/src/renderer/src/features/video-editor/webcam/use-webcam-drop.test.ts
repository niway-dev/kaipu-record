import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { WebcamTrackMeta } from "@shared/webcam-track";
import type { EditorSelection } from "../editor-selection";
import { WEBCAM_LAYER_SELECTION } from "../editor-selection";
import { initialScene } from "../scene";
import { toLayout } from "../timeline";
import { useVideoScene } from "../use-video-scene";
import { createWebcamPart } from "./webcam-edits";
import { useWebcamDrop } from "./use-webcam-drop";
import { useWebcamEditing } from "./use-webcam-editing";
import { WEBCAM_DEFAULTS, WEBCAM_TRANSITION_DEFAULTS, type WebcamSegment } from "./webcam-model";

const TRACK: WebcamTrackMeta = {
  startOffsetMs: 0,
  offsetQuality: "exact",
  width: 1280,
  height: 720,
  fps: 30,
};
const FRAME = { width: 1000, height: 1000 };
const DROP = { x: 0.8, y: 0.3 };

function setup(duration = 40) {
  const select = vi.fn();
  const hook = renderHook(
    (inputs: { timelineTime: number; playing: boolean; selection: EditorSelection }) => {
      const controller = useVideoScene(initialScene(duration, TRACK));
      const layout = toLayout(controller.scene.items);
      const edits = useWebcamEditing({ controller, layout, sourceDuration: duration });
      const drop = useWebcamDrop({
        controller,
        edits,
        sourceDuration: duration,
        frame: FRAME,
        cameraScaleAt: () => 1,
        select,
        ...inputs,
      });
      return { controller, drop };
    },
    { initialProps: { timelineTime: 24, playing: false, selection: null as EditorSelection } },
  );
  const segments = () => hook.result.current.controller.scene.webcam!.segments;
  /** A part over [at, at + 10) holding `position`, committed as one step. */
  const addPart = (at: number, position: { x: number; y: number }) => {
    act(() => {
      const c = hook.result.current.controller;
      c.commit(createWebcamPart(c.scene, { at, position }, duration).scene);
    });
  };
  return { ...hook, select, segments, addPart };
}

describe("useWebcamDrop — a drop outside every part", () => {
  it("leaves the scene the very same object and opens the card for the dropped place", () => {
    const t = setup();
    const before = t.result.current.controller.scene;
    act(() => t.result.current.drop.drop(DROP, 24));
    expect(t.result.current.controller.scene).toBe(before);
    expect(t.result.current.controller.canUndo).toBe(false);
    const card = t.result.current.drop.card!;
    expect(card.position).toEqual(DROP);
    expect(card.sourceTime).toBe(24);
    expect(card.room).toEqual({ start: 24, end: 34 });
    // "Now" is where the scene has the bubble: the original position, in frame pixels.
    expect(card.now.x).toBeCloseTo(WEBCAM_DEFAULTS.position.x * FRAME.width, 3);
    expect(card.now.y).toBeCloseTo(WEBCAM_DEFAULTS.position.y * FRAME.height, 3);
    expect(t.select).not.toHaveBeenCalled();
  });

  it("gives the real room, and none when under a second is left", () => {
    const t = setup();
    t.addPart(30, { x: 0.2, y: 0.2 });
    act(() => t.result.current.drop.drop(DROP, 24));
    expect(t.result.current.drop.card!.room).toEqual({ start: 24, end: 30 });
    t.rerender({ timelineTime: 29.5, playing: false, selection: null });
    act(() => t.result.current.drop.drop(DROP, 29.5));
    expect(t.result.current.drop.card!.room).toBeNull();
  });
});

describe("useWebcamDrop — the three answers", () => {
  it("Only for this part creates a Slide 0.7 s Smooth part at the playhead, selected, as one undo step", () => {
    const t = setup();
    t.addPart(2, { x: 0.1, y: 0.1 });
    const other = t.segments()[0]!;
    act(() => t.result.current.drop.drop(DROP, 24));
    act(() => t.result.current.drop.answerPart());
    expect(t.segments()).toHaveLength(2);
    const made = t.segments()[1]!;
    expect(made).toMatchObject({
      start: 24,
      end: 34,
      mode: "override",
      layout: { position: DROP },
      transition: { kind: "slide", ms: 700, easing: "ease-in-out" },
    });
    expect(made.transition).toEqual(WEBCAM_TRANSITION_DEFAULTS);
    expect(t.segments()[0]).toBe(other);
    expect(t.select).toHaveBeenCalledExactlyOnceWith("webcam", made.id);
    expect(t.result.current.drop.card).toBeNull();
    act(() => t.result.current.controller.undo());
    expect(t.segments()).toEqual([other]);
  });

  it("For the whole video moves the original position, makes no part, as one undo step", () => {
    const t = setup();
    act(() => t.result.current.drop.drop(DROP, 24));
    act(() => t.result.current.drop.answerWhole());
    expect(t.segments()).toEqual([]);
    expect(t.result.current.controller.scene.webcam!.layout.position).toEqual(DROP);
    expect(t.select).toHaveBeenCalledExactlyOnceWith("webcam", WEBCAM_LAYER_SELECTION);
    expect(t.result.current.drop.card).toBeNull();
    act(() => t.result.current.controller.undo());
    expect(t.result.current.controller.scene.webcam!.layout.position).toEqual(
      WEBCAM_DEFAULTS.position,
    );
  });

  it("Close changes nothing", () => {
    const t = setup();
    const before = t.result.current.controller.scene;
    act(() => t.result.current.drop.drop(DROP, 24));
    act(() => t.result.current.drop.close());
    expect(t.result.current.drop.card).toBeNull();
    expect(t.result.current.controller.scene).toBe(before);
    expect(t.result.current.controller.canUndo).toBe(false);
    expect(t.select).not.toHaveBeenCalled();
  });

  it("Only for this part with no room changes nothing", () => {
    const t = setup();
    t.addPart(24.5, { x: 0.2, y: 0.2 });
    const before = t.result.current.controller.scene;
    act(() => t.result.current.drop.drop(DROP, 24));
    expect(t.result.current.drop.card!.room).toBeNull();
    act(() => t.result.current.drop.answerPart());
    expect(t.result.current.controller.scene).toBe(before);
    expect(t.select).not.toHaveBeenCalled();
  });
});

describe("useWebcamDrop — a drop inside a part", () => {
  it("sets that part's position as one undo step, selects it, asks nothing and leaves the other parts", () => {
    const t = setup();
    t.addPart(2, { x: 0.1, y: 0.1 });
    t.addPart(20, { x: 0.9, y: 0.9 });
    const [first, second] = t.segments() as [WebcamSegment, WebcamSegment];
    const original = t.result.current.controller.scene.webcam!.layout;
    act(() => t.result.current.drop.drop(DROP, 25));
    expect(t.result.current.drop.card).toBeNull();
    const [nextFirst, nextSecond] = t.segments();
    expect(nextFirst).toBe(first);
    expect(nextSecond).toEqual({ ...second, layout: { ...second.layout, position: DROP } });
    expect(t.result.current.controller.scene.webcam!.layout).toBe(original);
    expect(t.select).toHaveBeenCalledExactlyOnceWith("webcam", second.id);
    // One step: a single undo gives the scene from before the drop.
    act(() => t.result.current.controller.undo());
    expect(t.segments()).toEqual([first, second]);
  });

  it("ignores a drop while another gesture owns the scene", () => {
    const t = setup();
    t.addPart(20, { x: 0.9, y: 0.9 });
    act(() => t.result.current.controller.beginInteract());
    const before = t.result.current.controller.scene;
    act(() => t.result.current.drop.drop(DROP, 25));
    expect(t.result.current.controller.scene).toBe(before);
    expect(t.result.current.drop.card).toBeNull();
  });
});

describe("useWebcamDrop — what closes the card like Close does", () => {
  const open = () => {
    const t = setup();
    act(() => t.result.current.drop.drop(DROP, 24));
    expect(t.result.current.drop.card).not.toBeNull();
    return t;
  };

  it("seeking", () => {
    const t = open();
    t.rerender({ timelineTime: 30, playing: false, selection: null });
    expect(t.result.current.drop.card).toBeNull();
  });

  it("playing", () => {
    const t = open();
    t.rerender({ timelineTime: 24, playing: true, selection: null });
    expect(t.result.current.drop.card).toBeNull();
  });

  it("selecting something else", () => {
    const t = open();
    t.rerender({ timelineTime: 24, playing: false, selection: { kind: "zoom", id: "z1" } });
    expect(t.result.current.drop.card).toBeNull();
  });

  it("undo and redo", () => {
    const t = setup();
    t.addPart(2, { x: 0.1, y: 0.1 });
    act(() => t.result.current.drop.drop(DROP, 24));
    act(() => t.result.current.controller.undo());
    expect(t.result.current.drop.card).toBeNull();
    act(() => t.result.current.drop.drop(DROP, 24));
    expect(t.result.current.drop.card).not.toBeNull();
    act(() => t.result.current.controller.redo());
    expect(t.result.current.drop.card).toBeNull();
  });

  it("Escape, once, without reaching the page's own Escape handler", () => {
    const t = open();
    const page = vi.fn();
    window.addEventListener("keydown", page);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    });
    window.removeEventListener("keydown", page);
    expect(t.result.current.drop.card).toBeNull();
    expect(page).not.toHaveBeenCalled();
    // With no card open, Escape belongs to the page.
    window.addEventListener("keydown", page);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    window.removeEventListener("keydown", page);
    expect(page).toHaveBeenCalledOnce();
  });
});
