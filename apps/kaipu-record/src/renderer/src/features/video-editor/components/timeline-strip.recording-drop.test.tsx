import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RECORDING_DRAG_MIME } from "../add-from-library";
import type { LayoutEntry } from "../timeline";
import type { PreviewPlayback } from "../use-preview-playback";
import { TimelineStrip } from "./timeline-strip";

function makePlayback(): PreviewPlayback {
  return {
    videoRef: { current: null },
    playing: false,
    muted: false,
    speed: 1,
    duration: 10,
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

/** jsdom lays nothing out: the strip's scroller sits at x = 0 and its lane is 1000 px wide. */
function stubLaneGeometry(): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const id = this.dataset.testid;
      if (id === "timeline-scroller") return rectOf(0, 1000);
      if (id === "lane-corner") return rectOf(0, 0);
      return rectOf(0, 0);
    },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

// Boundaries at 0, 5 and 10 s. The lane is 1000 px for 10 s: 100 px per second.
const layout: LayoutEntry[] = [
  { itemId: "a", kind: "clip", timelineStart: 0, timelineEnd: 5, sourceStart: 0, sourceEnd: 5 },
  { itemId: "b", kind: "clip", timelineStart: 5, timelineEnd: 10, sourceStart: 5, sourceEnd: 10 },
];

function renderStrip(onDropRecording?: (time: number) => void): HTMLElement {
  stubLaneGeometry();
  const { container } = render(
    <TimelineStrip
      layout={layout}
      playback={makePlayback()}
      thumbnails={[]}
      selectedItemId={null}
      onSelectItem={vi.fn()}
      overlays={[]}
      selectedOverlayId={null}
      onSelectOverlay={vi.fn()}
      onDropRecording={onDropRecording}
    />,
  );
  // The Clips row is the one holding the two blocks.
  return container.querySelectorAll("button")[0].parentElement as HTMLElement;
}

function dragData(types: string[]): { types: string[]; dropEffect: string; getData: () => string } {
  return { types, dropEffect: "none", getData: () => "asset-b" };
}
const recording = (): ReturnType<typeof dragData> => dragData([RECORDING_DRAG_MIME]);

interface DragInit {
  dataTransfer: ReturnType<typeof dragData>;
  clientX?: number;
  relatedTarget?: Element;
}

/**
 * jsdom has no DragEvent, so testing-library builds a plain Event that drops `clientX` and
 * `relatedTarget`; set them on the event the way a browser's DragEvent carries them. Returns
 * what `dispatchEvent` does: false when a handler called preventDefault.
 */
function drag(type: "dragOver" | "dragLeave" | "drop", target: Element, init: DragInit): boolean {
  const event = createEvent[type](target, { dataTransfer: init.dataTransfer });
  Object.defineProperty(event, "clientX", { value: init.clientX ?? 0 });
  Object.defineProperty(event, "relatedTarget", { value: init.relatedTarget ?? null });
  return fireEvent(target, event);
}

describe("TimelineStrip — drop a Library recording (NIW2-782)", () => {
  it("marks the indicator as the editorVideo.insertIndicator area", () => {
    const track = renderStrip(vi.fn());
    drag("dragOver", track, { dataTransfer: recording(), clientX: 480 });
    expect(screen.getByTestId("insert-indicator").getAttribute("data-ui-area")).toBe(
      "editorVideo.insertIndicator",
    );
  });

  it("shows Insert here and a bar on the nearest clip boundary while a recording is dragged over the Clips row", () => {
    const track = renderStrip(vi.fn());

    // 480 px = 4.8 s: the nearest boundary is the seam at 5 s.
    const notPrevented = drag("dragOver", track, { dataTransfer: recording(), clientX: 480 });

    expect(notPrevented).toBe(false); // preventDefault: the row accepts the drop
    expect(screen.getByText("Insert here · 0:05.0")).toBeInTheDocument();
    expect(screen.getByTestId("insert-indicator").style.left).toBe("50%");
  });

  it("moves the indicator to the boundary nearest the pointer as it moves", () => {
    const track = renderStrip(vi.fn());

    drag("dragOver", track, { dataTransfer: recording(), clientX: 20 });
    expect(screen.getByText("Insert here · 0:00.0")).toBeInTheDocument();
    expect(screen.getByTestId("insert-indicator").style.left).toBe("0%");

    drag("dragOver", track, { dataTransfer: recording(), clientX: 900 });
    expect(screen.getByText("Insert here · 0:10.0")).toBeInTheDocument();
    expect(screen.getByTestId("insert-indicator").style.left).toBe("100%");
  });

  it("dropping calls the handler with the boundary's time and hides the indicator", () => {
    const onDropRecording = vi.fn();
    const track = renderStrip(onDropRecording);
    drag("dragOver", track, { dataTransfer: recording(), clientX: 480 });

    drag("drop", track, { dataTransfer: recording(), clientX: 480 });

    expect(onDropRecording).toHaveBeenCalledTimes(1);
    expect(onDropRecording).toHaveBeenCalledWith(5);
    expect(screen.queryByTestId("insert-indicator")).toBeNull();
  });

  it("works out the boundary from the drop position itself, so a drop needs no dragover before it", () => {
    const onDropRecording = vi.fn();
    const track = renderStrip(onDropRecording);

    drag("drop", track, { dataTransfer: recording(), clientX: 40 });

    expect(onDropRecording).toHaveBeenCalledWith(0);
  });

  it("hides the indicator when the drag leaves the row", () => {
    const track = renderStrip(vi.fn());
    drag("dragOver", track, { dataTransfer: recording(), clientX: 480 });
    expect(screen.getByTestId("insert-indicator")).toBeInTheDocument();

    drag("dragLeave", track, { dataTransfer: recording() });

    expect(screen.queryByTestId("insert-indicator")).toBeNull();
  });

  it("keeps the indicator while the pointer crosses from the row into one of its clips", () => {
    const track = renderStrip(vi.fn());
    drag("dragOver", track, { dataTransfer: recording(), clientX: 480 });
    const block = track.querySelector("button") as HTMLElement;

    drag("dragLeave", track, { dataTransfer: recording(), relatedTarget: block });

    expect(screen.getByTestId("insert-indicator")).toBeInTheDocument();
  });

  it("hides the indicator when the drag ends anywhere, as when it is cancelled with Escape", () => {
    const track = renderStrip(vi.fn());
    drag("dragOver", track, { dataTransfer: recording(), clientX: 480 });

    fireEvent.dragEnd(window);

    expect(screen.queryByTestId("insert-indicator")).toBeNull();
  });

  it("ignores a drag that is not a Library recording: no indicator, not accepted, no drop", () => {
    const onDropRecording = vi.fn();
    const track = renderStrip(onDropRecording);
    const file = dragData(["Files"]);

    const notPrevented = drag("dragOver", track, { dataTransfer: file, clientX: 480 });
    drag("drop", track, { dataTransfer: file, clientX: 480 });

    expect(notPrevented).toBe(true);
    expect(screen.queryByTestId("insert-indicator")).toBeNull();
    expect(onDropRecording).not.toHaveBeenCalled();
  });

  it("without onDropRecording the row neither accepts a drag nor draws an indicator", () => {
    const track = renderStrip(undefined);

    const notPrevented = drag("dragOver", track, { dataTransfer: recording(), clientX: 480 });
    drag("drop", track, { dataTransfer: recording(), clientX: 480 });

    expect(notPrevented).toBe(true);
    expect(screen.queryByTestId("insert-indicator")).toBeNull();
  });
});
