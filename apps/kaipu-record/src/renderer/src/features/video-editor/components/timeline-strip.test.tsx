import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LayoutEntry } from "../timeline";
import type { PreviewPlayback } from "../use-preview-playback";
import { TimelineStrip } from "./timeline-strip";

function makePlayback(overrides: Partial<PreviewPlayback> = {}): PreviewPlayback {
  return {
    videoRef: { current: null },
    playing: false,
    duration: 10,
    timelineTime: 0,
    play: vi.fn(),
    pause: vi.fn(),
    toggle: vi.fn(),
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
