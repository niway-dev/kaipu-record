/**
 * Floating images on a zoomed, scrolled timeline (NIW2-771). Same geometry as
 * timeline-zoom.test.tsx: a 100 s recording in a 1000 px lane starting at x = 220; at 4x
 * scrolled 1200 px the lane shows 30 s..55 s, so a pointer 500 px into the lane is at 42.5 s
 * (28.5 s if the lane forgot the zoom and the scroll).
 */
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mediaRows, type PlacedMedia } from "../media";
import type { ImageMediaItem } from "../scene";
import type { LayoutEntry } from "../timeline";
import type { PreviewPlayback } from "../use-preview-playback";
import { createTimelineViewStore } from "../use-timeline-view";
import type { TimelineMedia } from "./media-lane-contract";
import { TimelineStrip } from "./timeline-strip";

const LANE_LEFT = 220;
const LANE_WIDTH = 1000;

function rectOf(left: number, width: number): DOMRect {
  return {
    left,
    right: left + width,
    width,
    top: 0,
    bottom: 20,
    height: 20,
    x: left,
    y: 0,
    toJSON: () => ({}),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

const layout: LayoutEntry[] = [
  { itemId: "a", kind: "clip", timelineStart: 0, timelineEnd: 100, sourceStart: 0, sourceEnd: 100 },
];

function playback(): PreviewPlayback {
  return {
    videoRef: { current: null },
    playing: false,
    muted: false,
    speed: 1,
    duration: 100,
    timelineTime: 0,
    readTimelineTime: () => 0,
    activeSlideId: null,
    play: vi.fn(),
    pause: vi.fn(),
    toggle: vi.fn(),
    toggleMute: vi.fn(),
    setSpeed: vi.fn(),
    seek: vi.fn(),
    onVideoTimeUpdate: vi.fn(),
    onVideoEnded: vi.fn(),
    onVideoLoadedMetadata: vi.fn(),
    onVideoPlay: vi.fn(),
    onVideoPause: vi.fn(),
    subscribeTime: vi.fn(() => () => {}),
  };
}

function placedItem(id: string, start: number, end: number): PlacedMedia {
  const item: ImageMediaItem = {
    id,
    kind: "image",
    assetId: `asset-${id}`,
    naturalWidth: 100,
    naturalHeight: 50,
    anchor: { kind: "source", time: start },
    duration: end - start,
    box: { x: 0.5, y: 0.5, width: 0.4 },
    z: 1,
    fadeInMs: 200,
    fadeOutMs: 200,
  };
  return { item, start, end };
}

function renderZoomed(media: TimelineMedia): HTMLElement {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const id = this.dataset.testid;
      if (id === "timeline-scroller") return rectOf(100, 120 + LANE_WIDTH);
      if (id === "lane-corner") return rectOf(100, 120);
      return rectOf(0, 0);
    },
  );
  const store = createTimelineViewStore();
  store.setDuration(100);
  const { container } = render(
    <TimelineStrip
      layout={layout}
      playback={playback()}
      thumbnails={[]}
      selectedItemId={null}
      onSelectItem={vi.fn()}
      overlays={[]}
      selectedOverlayId={null}
      onSelectOverlay={vi.fn()}
      timelineView={store}
      media={media}
    />,
  );
  act(() => {
    store.zoomTo(4);
    store.scrollTo(1200, "user");
  });
  return container;
}

describe("floating images at 4x, scrolled", () => {
  it("a body drag moves by the zoomed amount, not the 1x amount", () => {
    const items = [placedItem("m1", 40, 50)];
    const media: TimelineMedia = {
      placed: items,
      rows: mediaRows(items),
      selectedId: null,
      imageUrl: () => null,
      onSelect: vi.fn(),
      onMove: vi.fn(),
      onResizeEdge: vi.fn(),
      onInteractionStart: vi.fn(),
      onInteractionEnd: vi.fn(),
    };
    const container = renderZoomed(media);
    const block = container.querySelector<HTMLElement>("[data-testid='media-block-m1']")!;
    // Grab at 42.5 s (500 px into the lane), move 80 px right: 80 / 40 px per second = 2 s.
    fireEvent.pointerDown(block, { pointerId: 1, button: 0, clientX: LANE_LEFT + 500 });
    fireEvent.pointerMove(block, { pointerId: 1, clientX: LANE_LEFT + 580 });
    expect(media.onMove).toHaveBeenLastCalledWith("m1", 42);
    fireEvent.pointerUp(block, { pointerId: 1, clientX: LANE_LEFT + 580 });
  });

  it("an edge drag reports the time under the pointer at that zoom", () => {
    const items = [placedItem("m1", 40, 50)];
    const media: TimelineMedia = {
      placed: items,
      rows: mediaRows(items),
      selectedId: null,
      imageUrl: () => null,
      onSelect: vi.fn(),
      onMove: vi.fn(),
      onResizeEdge: vi.fn(),
      onInteractionStart: vi.fn(),
      onInteractionEnd: vi.fn(),
    };
    const container = renderZoomed(media);
    const handle = container.querySelector<HTMLElement>("[data-testid='media-handle-m1-end']")!;
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: LANE_LEFT + 400 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: LANE_LEFT + 500 });
    expect(media.onResizeEdge).toHaveBeenLastCalledWith("m1", "end", 42.5);
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: LANE_LEFT + 500 });
  });
});
