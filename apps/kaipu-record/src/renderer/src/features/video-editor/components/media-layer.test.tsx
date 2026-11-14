import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { mediaBoxPx } from "../media";
import type { ImageMediaItem, MediaBox } from "../scene";
import { toLayout } from "../timeline";
import { MediaLayer } from "./media-layer";

const layout = toLayout([{ id: "a", kind: "clip", sourceStart: 0, sourceEnd: 60 }]);
const picture = { width: 1920, height: 1080 };

const img = (
  id: string,
  time: number,
  z: number,
  patch: Partial<ImageMediaItem> = {},
): ImageMediaItem => ({
  id,
  kind: "image",
  assetId: `asset-${id}`,
  naturalWidth: 1600,
  naturalHeight: 900,
  anchor: { kind: "source", time },
  duration: 10,
  box: { x: 0.5, y: 0.5, width: 0.4 },
  z,
  fadeInMs: 0,
  fadeOutMs: 0,
  ...patch,
});

function renderLayer(props: Partial<React.ComponentProps<typeof MediaLayer>> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onBegin: vi.fn(),
    onBoxChange: vi.fn(),
    onEnd: vi.fn(),
  };
  const utils = render(
    <MediaLayer
      media={[]}
      layout={layout}
      time={0}
      picture={picture}
      selectedId={null}
      interactive
      imageUrl={(assetId) => `blob:${assetId}`}
      {...handlers}
      {...props}
    />,
  );
  const slot = screen.getByTestId("media-layer");
  slot.getBoundingClientRect = () => ({ width: 960, height: 540 }) as DOMRect;
  return { ...utils, ...handlers };
}

const items = (): HTMLElement[] => screen.queryAllByTestId("media-item");

describe("MediaLayer", () => {
  it("draws the items visible at the playhead, back to front, whatever the array order", () => {
    renderLayer({ media: [img("front", 0, 5), img("back", 0, 1), img("later", 20, 9)], time: 3 });
    expect(items().map((el) => el.dataset.mediaId)).toEqual(["back", "front"]);
  });

  it("draws an item from its start up to, not including, its end", () => {
    const media = [img("m", 5, 0)];
    const { rerender, onSelect, onBegin, onBoxChange, onEnd } = renderLayer({ media, time: 4.9 });
    expect(items()).toHaveLength(0);
    const props = { media, layout, picture, selectedId: null, interactive: true };
    const handlers = { onSelect, onBegin, onBoxChange, onEnd };
    const url = (assetId: string): string => `blob:${assetId}`;
    rerender(<MediaLayer {...props} {...handlers} imageUrl={url} time={5} />);
    expect(items()).toHaveLength(1);
    rerender(<MediaLayer {...props} {...handlers} imageUrl={url} time={15} />);
    expect(items()).toHaveLength(0);
  });

  it("takes the opacity from the fade ramps", () => {
    renderLayer({ media: [img("m", 0, 0, { fadeInMs: 1000 })], time: 0.5 });
    const image = items()[0].querySelector("img")!;
    expect(image.style.opacity).toBe("0.5");
    expect(image.getAttribute("src")).toBe("blob:asset-m");
  });

  it("places the box in percent of the picture, the height from the image's own aspect", () => {
    renderLayer({ media: [img("m", 0, 0)], time: 1 });
    const style = items()[0].style;
    // 40 % of 1920 = 768 px wide; a 16:9 image is 432 px high = 40 % of 1080; centred.
    expect([style.left, style.top, style.width, style.height]).toEqual([
      "30%",
      "30%",
      "40%",
      "40%",
    ]);
  });

  it("shows no outline or handles until an item is selected, then four corner handles", () => {
    const media = [img("m", 0, 0)];
    const { rerender, onSelect, onBegin, onBoxChange, onEnd } = renderLayer({ media, time: 1 });
    expect(screen.queryByTestId("media-selection")).toBeNull();
    rerender(
      <MediaLayer
        media={media}
        layout={layout}
        time={1}
        picture={picture}
        selectedId="m"
        interactive
        imageUrl={() => "blob:x"}
        onSelect={onSelect}
        onBegin={onBegin}
        onBoxChange={onBoxChange}
        onEnd={onEnd}
      />,
    );
    expect(screen.getByTestId("media-selection")).toBeInTheDocument();
    for (const corner of ["nw", "ne", "sw", "se"]) {
      expect(screen.getByTestId(`media-handle-${corner}`)).toBeInTheDocument();
    }
    expect(items()[0].dataset.selected).toBe("true");
  });

  it("keeps the selected item grabbable at opacity 0 while the playhead is inside its span", () => {
    const media = [img("m", 0, 0, { fadeInMs: 1000 })];
    renderLayer({ media, time: 0, selectedId: "m" });
    expect(items()).toHaveLength(1);
    expect(items()[0].querySelector("img")!.style.opacity).toBe("0");
    expect(screen.getByTestId("media-handle-se")).toBeInTheDocument();
  });

  it("does not draw a selected item whose span the playhead is outside of", () => {
    renderLayer({ media: [img("m", 20, 0)], time: 1, selectedId: "m" });
    expect(items()).toHaveLength(0);
    expect(screen.queryByTestId("media-selection")).toBeNull();
  });

  it("a click selects an unselected item and starts no drag", () => {
    const { onSelect, onBegin, onBoxChange, onEnd } = renderLayer({
      media: [img("m", 0, 0)],
      time: 1,
    });
    const el = items()[0];
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 100, clientY: 100, pointerId: 1 });
    expect(onSelect).toHaveBeenCalledWith("m");
    expect(onBegin).not.toHaveBeenCalled();
    expect(onBoxChange).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("a click with no pointerdown selects an unselected item (assistive technology)", () => {
    const { onSelect } = renderLayer({ media: [img("m", 0, 0)], time: 1 });
    fireEvent.click(items()[0]);
    expect(onSelect).toHaveBeenCalledWith("m");
  });

  it("a click on the already selected item does not select it again", () => {
    const { onSelect } = renderLayer({ media: [img("m", 0, 0)], time: 1, selectedId: "m" });
    fireEvent.click(items()[0]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("Enter selects from the keyboard", () => {
    const { onSelect } = renderLayer({ media: [img("m", 0, 0)], time: 1 });
    fireEvent.keyDown(items()[0], { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("m");
  });

  it("dragging the body is one interaction: begin once, live box changes, end once", () => {
    const { onSelect, onBegin, onBoxChange, onEnd } = renderLayer({
      media: [img("m", 0, 0)],
      time: 1,
      selectedId: "m",
    });
    const el = items()[0];
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 148, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 196, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 196, clientY: 100, pointerId: 1 });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onBegin).toHaveBeenCalledOnce();
    expect(onEnd).toHaveBeenCalledOnce();
    expect(onBoxChange).toHaveBeenCalledTimes(2);
    // 96 client px of a 960 px slot is 10 % of the picture.
    const [id, box] = onBoxChange.mock.calls[1] as [string, MediaBox];
    expect(id).toBe("m");
    expect(box.x).toBeCloseTo(0.6);
    expect(box.y).toBeCloseTo(0.5);
    expect(box.width).toBe(0.4);
  });

  it("dragging a corner keeps the aspect and the opposite corner", () => {
    const item = img("m", 0, 0);
    const { onBegin, onBoxChange, onEnd } = renderLayer({
      media: [item],
      time: 1,
      selectedId: "m",
    });
    const handle = screen.getByTestId("media-handle-se");
    fireEvent.pointerDown(handle, { clientX: 500, clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 580, clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 580, clientY: 300, pointerId: 1 });
    expect(onBegin).toHaveBeenCalledOnce();
    expect(onEnd).toHaveBeenCalledOnce();
    const [, box] = onBoxChange.mock.calls[0] as [string, MediaBox];
    const before = mediaBoxPx(item, picture);
    const after = mediaBoxPx({ ...item, box }, picture);
    expect(after.width / after.height).toBeCloseTo(before.width / before.height);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(after.width).toBeGreaterThan(before.width);
  });

  it("a lost pointer ends the drag so the undo step is not left open", () => {
    const { onBegin, onEnd } = renderLayer({ media: [img("m", 0, 0)], time: 1, selectedId: "m" });
    const el = items()[0];
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 150, clientY: 100, pointerId: 1 });
    fireEvent.pointerCancel(el, { pointerId: 1 });
    expect(onBegin).toHaveBeenCalledOnce();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it("a second pointer cannot take over a drag: the first one still ends the interaction", () => {
    const { onBegin, onBoxChange, onEnd } = renderLayer({
      media: [img("m", 0, 0)],
      time: 1,
      selectedId: "m",
    });
    const el = items()[0];
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 150, clientY: 100, pointerId: 1 });
    fireEvent.pointerDown(el, { clientX: 300, clientY: 300, pointerId: 2 });
    fireEvent.pointerMove(el, { clientX: 400, clientY: 400, pointerId: 2 });
    fireEvent.pointerUp(el, { clientX: 300, clientY: 300, pointerId: 2 });
    expect(onEnd).not.toHaveBeenCalled();
    expect(onBoxChange).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(el, { clientX: 150, clientY: 100, pointerId: 1 });
    expect(onBegin).toHaveBeenCalledOnce();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it("lets a drawing tool through while it is armed: no image or handle takes the pointer", () => {
    renderLayer({ media: [img("m", 0, 0)], time: 1, selectedId: "m", interactive: false });
    // jsdom applies no CSS, so the image's pass-through is the attribute the stylesheet keys on,
    // and the handles, which no rule can disable, must simply not exist.
    expect(items()[0].dataset.interactive).toBe("false");
    expect(screen.queryAllByTestId(/^media-handle-/)).toHaveLength(0);
    expect(screen.getByTestId("media-selection")).toBeTruthy();
  });

  it("ignores a right or middle press: no select, no drag", () => {
    const { onSelect, onBegin, onBoxChange, onEnd } = renderLayer({
      media: [img("m", 0, 0)],
      time: 1,
    });
    const el = items()[0];
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1, button: 2 });
    fireEvent.pointerMove(el, { clientX: 200, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(el, { pointerId: 1 });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onBegin).not.toHaveBeenCalled();
    expect(onBoxChange).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("ends a drag in progress when the layer unmounts, so the editor is not left interacting", () => {
    const { onBegin, onEnd, unmount } = renderLayer({
      media: [img("m", 0, 0)],
      time: 1,
      selectedId: "m",
    });
    const el = items()[0];
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 150, clientY: 100, pointerId: 1 });
    expect(onBegin).toHaveBeenCalledOnce();
    unmount();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it("does not report an end on unmount when the press never became a drag", () => {
    const { onEnd, unmount } = renderLayer({ media: [img("m", 0, 0)], time: 1, selectedId: "m" });
    fireEvent.pointerDown(items()[0], { clientX: 100, clientY: 100, pointerId: 1 });
    unmount();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("ends the drag when the dragged image leaves the playhead span", () => {
    const item = img("m", 0, 0);
    const { onEnd, rerender, onBegin } = renderLayer({ media: [item], time: 1, selectedId: "m" });
    const el = items()[0];
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 150, clientY: 100, pointerId: 1 });
    expect(onBegin).toHaveBeenCalledOnce();
    // The playhead moved past the image: its element unmounts, the layer stays.
    rerender(
      <MediaLayer
        media={[item]}
        layout={layout}
        time={30}
        picture={picture}
        selectedId="m"
        interactive
        imageUrl={(assetId) => `blob:${assetId}`}
        onSelect={vi.fn()}
        onBegin={vi.fn()}
        onBoxChange={vi.fn()}
        onEnd={onEnd}
      />,
    );
    expect(items()).toHaveLength(0);
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it("ends a corner drag when a drawing tool is armed in the middle of it", () => {
    const item = img("m", 0, 0);
    const { onEnd, onBegin, rerender } = renderLayer({ media: [item], time: 1, selectedId: "m" });
    const handle = screen.getByTestId("media-handle-se");
    fireEvent.pointerDown(handle, { clientX: 500, clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 580, clientY: 300, pointerId: 1 });
    expect(onBegin).toHaveBeenCalledOnce();
    rerender(
      <MediaLayer
        media={[item]}
        layout={layout}
        time={1}
        picture={picture}
        selectedId="m"
        interactive={false}
        imageUrl={(assetId) => `blob:${assetId}`}
        onSelect={vi.fn()}
        onBegin={vi.fn()}
        onBoxChange={vi.fn()}
        onEnd={onEnd}
      />,
    );
    expect(screen.queryAllByTestId(/^media-handle-/)).toHaveLength(0);
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it("ends a corner drag when the selection is cleared in the middle of it (Escape)", () => {
    const item = img("m", 0, 0);
    const { onEnd, onBegin, rerender } = renderLayer({ media: [item], time: 1, selectedId: "m" });
    const handle = screen.getByTestId("media-handle-se");
    fireEvent.pointerDown(handle, { clientX: 500, clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 580, clientY: 300, pointerId: 1 });
    expect(onBegin).toHaveBeenCalledOnce();
    rerender(
      <MediaLayer
        media={[item]}
        layout={layout}
        time={1}
        picture={picture}
        selectedId={null}
        interactive
        imageUrl={(assetId) => `blob:${assetId}`}
        onSelect={vi.fn()}
        onBegin={vi.fn()}
        onBoxChange={vi.fn()}
        onEnd={onEnd}
      />,
    );
    expect(onEnd).toHaveBeenCalledOnce();
  });

  describe("while playing", () => {
    it("draws at the per-frame clock, not at the sparse page time", () => {
      vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
      try {
        // A 1 s fade-in; the page state still says 0 (the image is not drawn there).
        const fading = img("m", 0, 0, { fadeInMs: 1000 });
        let clock = 0.25;
        renderLayer({ media: [fading], time: 0, playing: true, readTime: () => clock });
        expect(items()).toHaveLength(0);
        act(() => void vi.advanceTimersByTime(20));
        expect(items()).toHaveLength(1);
        expect(items()[0].querySelector("img")!.style.opacity).toBe("0.25");
        clock = 0.75;
        act(() => void vi.advanceTimersByTime(20));
        expect(items()[0].querySelector("img")!.style.opacity).toBe("0.75");
      } finally {
        vi.useRealTimers();
      }
    });

    it("goes back to the page time when playback stops, and does not replay a stale frame", () => {
      vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
      try {
        const fading = img("m", 0, 0, { fadeInMs: 1000 });
        const common = {
          media: [fading],
          layout,
          picture,
          selectedId: null,
          interactive: true,
          imageUrl: (assetId: string) => `blob:${assetId}`,
          onSelect: vi.fn(),
          onBegin: vi.fn(),
          onBoxChange: vi.fn(),
          onEnd: vi.fn(),
        };
        let clock = 0.5;
        const readTime = () => clock;
        const { rerender } = render(
          <MediaLayer {...common} time={0} playing readTime={readTime} />,
        );
        act(() => void vi.advanceTimersByTime(20));
        expect(items()).toHaveLength(1);
        rerender(<MediaLayer {...common} time={0} playing={false} readTime={readTime} />);
        expect(items()).toHaveLength(0);
        // Playing again: the clock now reads a moment where nothing is drawn. The frame at the
        // old live time (0.5) must not show before the first tick.
        clock = 0;
        rerender(<MediaLayer {...common} time={0} playing readTime={readTime} />);
        expect(items()).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
