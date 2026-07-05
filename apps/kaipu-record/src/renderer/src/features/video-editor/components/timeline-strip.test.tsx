import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LayoutEntry } from "../timeline";
import type { PreviewPlayback } from "../use-preview-playback";
import { TimelineStrip } from "./timeline-strip";

function makePlayback(overrides: Partial<PreviewPlayback> = {}): PreviewPlayback {
  return {
    videoRef: { current: null },
    playing: false,
    muted: false,
    duration: 10,
    timelineTime: 0,
    activeSlideId: null,
    play: vi.fn(),
    pause: vi.fn(),
    toggle: vi.fn(),
    toggleMute: vi.fn(),
    seek: vi.fn(),
    onVideoTimeUpdate: vi.fn(),
    onVideoEnded: vi.fn(),
    subscribeTime: vi.fn(() => () => {}),
    ...overrides,
  };
}

// Two contiguous clips — mirrors how toLayout() lays out real timeline entries.
const twoClipLayout: LayoutEntry[] = [
  { itemId: "a", kind: "clip", timelineStart: 0, timelineEnd: 5, sourceStart: 0, sourceEnd: 5 },
  { itemId: "b", kind: "clip", timelineStart: 5, timelineEnd: 10, sourceStart: 5, sourceEnd: 10 },
];

// A slide followed by a clip — an intro image ahead of footage.
const slideThenClipLayout: LayoutEntry[] = [
  {
    itemId: "s1",
    kind: "slide",
    timelineStart: 0,
    timelineEnd: 3,
    sourceStart: 0,
    sourceEnd: 3,
    assetId: "asset-1",
  },
  { itemId: "b", kind: "clip", timelineStart: 3, timelineEnd: 10, sourceStart: 0, sourceEnd: 7 },
];

describe("TimelineStrip trim handles", () => {
  it("renders trim handles only for the selected clip", () => {
    const { container } = render(
      <TimelineStrip
        layout={twoClipLayout}
        playback={makePlayback()}
        thumbnails={[]}
        selectedItemId="a"
        onSelectItem={vi.fn()}
        onTrim={vi.fn()}
        overlays={[]}
        selectedOverlayId={null}
        onSelectOverlay={vi.fn()}
      />,
    );
    const handles = container.querySelectorAll("[data-trim-handle]");
    expect(handles).toHaveLength(2);
    // Both handles belong to the selected clip's edges (start + end), not clip "b".
    expect(handles[0]).toHaveAttribute("data-trim-handle", "start");
    expect(handles[1]).toHaveAttribute("data-trim-handle", "end");
  });

  it("renders no trim handles when nothing is selected", () => {
    const { container } = render(
      <TimelineStrip
        layout={twoClipLayout}
        playback={makePlayback()}
        thumbnails={[]}
        selectedItemId={null}
        onSelectItem={vi.fn()}
        onTrim={vi.fn()}
        overlays={[]}
        selectedOverlayId={null}
        onSelectOverlay={vi.fn()}
      />,
    );
    expect(container.querySelectorAll("[data-trim-handle]")).toHaveLength(0);
  });

  it("switching the selection moves the handles to the newly selected clip", () => {
    const { container, rerender } = render(
      <TimelineStrip
        layout={twoClipLayout}
        playback={makePlayback()}
        thumbnails={[]}
        selectedItemId="a"
        onSelectItem={vi.fn()}
        onTrim={vi.fn()}
        overlays={[]}
        selectedOverlayId={null}
        onSelectOverlay={vi.fn()}
      />,
    );
    expect(container.querySelectorAll("[data-trim-handle]")).toHaveLength(2);

    rerender(
      <TimelineStrip
        layout={twoClipLayout}
        playback={makePlayback()}
        thumbnails={[]}
        selectedItemId="b"
        onSelectItem={vi.fn()}
        onTrim={vi.fn()}
        overlays={[]}
        selectedOverlayId={null}
        onSelectOverlay={vi.fn()}
      />,
    );
    expect(container.querySelectorAll("[data-trim-handle]")).toHaveLength(2);
  });
});

describe("TimelineStrip slide blocks", () => {
  it("renders the slide image from slideUrlFor", () => {
    const slideUrlFor = vi.fn((assetId: string) => `blob:${assetId}`);
    const { container } = render(
      <TimelineStrip
        layout={slideThenClipLayout}
        playback={makePlayback()}
        thumbnails={[]}
        selectedItemId={null}
        onSelectItem={vi.fn()}
        onTrim={vi.fn()}
        slideUrlFor={slideUrlFor}
        onSlideDuration={vi.fn()}
        overlays={[]}
        selectedOverlayId={null}
        onSelectOverlay={vi.fn()}
      />,
    );
    expect(slideUrlFor).toHaveBeenCalledWith("asset-1");
    const img = container.querySelector('img[src="blob:asset-1"]');
    expect(img).not.toBeNull();
  });

  it("shows a single duration handle for a selected slide (not the two clip handles)", () => {
    const { container } = render(
      <TimelineStrip
        layout={slideThenClipLayout}
        playback={makePlayback()}
        thumbnails={[]}
        selectedItemId="s1"
        onSelectItem={vi.fn()}
        onTrim={vi.fn()}
        slideUrlFor={() => null}
        onSlideDuration={vi.fn()}
        overlays={[]}
        selectedOverlayId={null}
        onSelectOverlay={vi.fn()}
      />,
    );
    expect(container.querySelectorAll("[data-trim-handle]")).toHaveLength(0);
    const handles = container.querySelectorAll("[data-slide-handle]");
    expect(handles).toHaveLength(1);
    expect(handles[0]).toHaveAttribute("data-slide-handle", "end");
  });

  it("reports the duration drag lifecycle through onSlideDuration", () => {
    const onSlideDuration = vi.fn();
    const { container } = render(
      <TimelineStrip
        layout={slideThenClipLayout}
        playback={makePlayback({ duration: 10 })}
        thumbnails={[]}
        selectedItemId="s1"
        onSelectItem={vi.fn()}
        onTrim={vi.fn()}
        slideUrlFor={() => null}
        onSlideDuration={onSlideDuration}
        overlays={[]}
        selectedOverlayId={null}
        onSelectOverlay={vi.fn()}
      />,
    );
    const handle = container.querySelector("[data-slide-handle]") as HTMLElement;
    // jsdom has no layout, so pointer capture APIs are undefined — stub them so the
    // move handler's hasPointerCapture guard passes.
    handle.setPointerCapture = vi.fn();
    handle.hasPointerCapture = vi.fn(() => true);

    fireEvent.pointerDown(handle, { pointerId: 1 });
    expect(onSlideDuration).toHaveBeenLastCalledWith("s1", 3, "start");
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 0 });
    expect(onSlideDuration).toHaveBeenCalledWith("s1", expect.any(Number), "move");
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 0 });
    expect(onSlideDuration).toHaveBeenLastCalledWith("s1", expect.any(Number), "end");
  });
});

describe("TimelineStrip ruler scrubber", () => {
  // Helper: mock a rect on an element so jsdom (which has no layout engine) returns
  // a known pixel grid. clientX=500 on a 1000px-wide ruler with duration=10 → 5s.
  function mockRect(el: HTMLElement): void {
    el.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      right: 1000,
      width: 1000,
      top: 0,
      bottom: 20,
      height: 20,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
  }

  it("ruler pointerDown calls seek with the mapped time and does NOT call pause", () => {
    // Ruler scrubbing keeps playback running — the user chose to reposition without
    // stopping. The old track-background handler called pause() before seeking; the
    // ruler intentionally omits it so the video keeps playing from the new point.
    const playback = makePlayback({ duration: 10 });
    const { getByTestId } = render(
      <TimelineStrip
        layout={twoClipLayout}
        playback={playback}
        thumbnails={[]}
        selectedItemId={null}
        onSelectItem={vi.fn()}
        onTrim={vi.fn()}
        overlays={[]}
        selectedOverlayId={null}
        onSelectOverlay={vi.fn()}
      />,
    );

    const ruler = getByTestId("ruler");
    mockRect(ruler);
    ruler.setPointerCapture = vi.fn();

    fireEvent.pointerDown(ruler, { pointerId: 1, clientX: 500 });

    // 500px / 1000px * 10s = 5s
    expect(playback.seek).toHaveBeenCalledWith(5);
    expect(playback.pause).not.toHaveBeenCalled();
  });

  it("ruler pointerMove with pointer capture continues scrubbing to the new position", () => {
    const playback = makePlayback({ duration: 10 });
    const { getByTestId } = render(
      <TimelineStrip
        layout={twoClipLayout}
        playback={playback}
        thumbnails={[]}
        selectedItemId={null}
        onSelectItem={vi.fn()}
        onTrim={vi.fn()}
        overlays={[]}
        selectedOverlayId={null}
        onSelectOverlay={vi.fn()}
      />,
    );

    const ruler = getByTestId("ruler");
    mockRect(ruler);
    ruler.setPointerCapture = vi.fn();
    ruler.hasPointerCapture = vi.fn(() => true);

    fireEvent.pointerDown(ruler, { pointerId: 1, clientX: 200 });
    fireEvent.pointerMove(ruler, { pointerId: 1, clientX: 700 });

    // Last seek call: 700px / 1000px * 10s = 7s
    expect(playback.seek).toHaveBeenLastCalledWith(7);
    expect(playback.pause).not.toHaveBeenCalled();
  });

  it("ruler pointerMove without capture is ignored (guard prevents phantom scrubs)", () => {
    const playback = makePlayback({ duration: 10 });
    const { getByTestId } = render(
      <TimelineStrip
        layout={twoClipLayout}
        playback={playback}
        thumbnails={[]}
        selectedItemId={null}
        onSelectItem={vi.fn()}
        onTrim={vi.fn()}
        overlays={[]}
        selectedOverlayId={null}
        onSelectOverlay={vi.fn()}
      />,
    );

    const ruler = getByTestId("ruler");
    mockRect(ruler);
    // hasPointerCapture returns false → move must be a no-op
    ruler.hasPointerCapture = vi.fn(() => false);

    fireEvent.pointerMove(ruler, { pointerId: 1, clientX: 700 });

    expect(playback.seek).not.toHaveBeenCalled();
  });

  it("a clip block click calls onSelectItem and does NOT call playback.seek", () => {
    // Clip blocks call stopPropagation on pointerdown and click — they are select-only.
    // The ruler is the only surface responsible for scrubbing.
    const playback = makePlayback({ duration: 10 });
    const onSelectItem = vi.fn();
    const { container } = render(
      <TimelineStrip
        layout={twoClipLayout}
        playback={playback}
        thumbnails={[]}
        selectedItemId={null}
        onSelectItem={onSelectItem}
        onTrim={vi.fn()}
        overlays={[]}
        selectedOverlayId={null}
        onSelectOverlay={vi.fn()}
      />,
    );

    const firstBlock = container.querySelector("button") as HTMLElement;
    fireEvent.click(firstBlock);

    expect(onSelectItem).toHaveBeenCalledWith("a");
    expect(playback.seek).not.toHaveBeenCalled();
  });
});
