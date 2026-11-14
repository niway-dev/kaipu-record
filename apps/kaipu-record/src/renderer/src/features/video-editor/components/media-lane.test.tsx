import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { mediaRows, type PlacedMedia } from "../media";
import type { ImageMediaItem } from "../scene";
import { MediaLane } from "./media-lane";
import type { TimelineMedia } from "./media-lane-contract";

/** The lane measures its own box when it is not under a strip: pin it to 1000 px for a
 *  10-second timeline (100 px per second, easy-to-read expectations below). */
function mockRect(el: HTMLElement): void {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 1000,
    bottom: 28,
    width: 1000,
    height: 28,
    toJSON: () => ({}),
  });
}

function placed(id: string, start: number, end: number, z: number): PlacedMedia {
  const item: ImageMediaItem = {
    id,
    kind: "image",
    assetId: `asset-${id}`,
    naturalWidth: 100,
    naturalHeight: 50,
    anchor: { kind: "source", time: start },
    duration: end - start,
    box: { x: 0.5, y: 0.5, width: 0.4 },
    z,
    fadeInMs: 200,
    fadeOutMs: 200,
  };
  return { item, start, end };
}

function makeMedia(items: PlacedMedia[], overrides: Partial<TimelineMedia> = {}): TimelineMedia {
  return {
    placed: items,
    rows: mediaRows(items),
    selectedId: null,
    imageUrl: (assetId) => `blob:${assetId}`,
    onSelect: vi.fn(),
    onMove: vi.fn(),
    onResizeEdge: vi.fn(),
    onInteractionStart: vi.fn(),
    onInteractionEnd: vi.fn(),
    ...overrides,
  };
}

function renderLane(media: TimelineMedia): { container: HTMLElement; lane: HTMLElement } {
  const { container } = render(<MediaLane media={media} duration={10} />);
  const lane = container.firstChild as HTMLElement;
  mockRect(lane);
  return { container, lane };
}

describe("MediaLane rows", () => {
  it("draws one row per distinct row number, the highest one at the top", () => {
    // b overlaps a in time and is in front (higher z), so it is on row 2.
    const a = placed("a", 0, 4, 1);
    const b = placed("b", 2, 6, 2);
    const { container } = renderLane(makeMedia([a, b]));
    const rows = Array.from(container.querySelectorAll("[data-testid^='media-row-']"));
    expect(rows.map((el) => el.getAttribute("data-testid"))).toEqual([
      "media-row-1",
      "media-row-2",
    ]);
    // --row-pos 0 is the top of the lane: row 2 sits above row 1.
    expect(
      container
        .querySelector<HTMLElement>("[data-testid='media-row-2']")!
        .style.getPropertyValue("--row-pos"),
    ).toBe("0");
    expect(
      container
        .querySelector<HTMLElement>("[data-testid='media-row-1']")!
        .style.getPropertyValue("--row-pos"),
    ).toBe("1");
    expect(container.querySelector("[data-testid='media-block-a']")).toHaveAttribute(
      "data-row",
      "1",
    );
    expect(container.querySelector("[data-testid='media-block-b']")).toHaveAttribute(
      "data-row",
      "2",
    );
  });

  it("puts items that do not overlap in time on the same row", () => {
    const { container } = renderLane(makeMedia([placed("a", 0, 3, 1), placed("b", 5, 8, 2)]));
    expect(container.querySelectorAll("[data-testid^='media-row-']")).toHaveLength(1);
    const a = container.querySelector<HTMLElement>("[data-testid='media-block-a']")!;
    const b = container.querySelector<HTMLElement>("[data-testid='media-block-b']")!;
    expect(a).toHaveAttribute("data-row", "1");
    expect(b).toHaveAttribute("data-row", "1");
    expect(a.style.getPropertyValue("--row-pos")).toBe(b.style.getPropertyValue("--row-pos"));
  });

  it("uses media.rows as given instead of recomputing it", () => {
    const a = placed("a", 0, 3, 1);
    const b = placed("b", 5, 8, 2);
    const media = makeMedia([a, b], {
      rows: new Map([
        ["a", 1],
        ["b", 2],
      ]),
    });
    const { container } = renderLane(media);
    expect(container.querySelector("[data-testid='media-block-b']")).toHaveAttribute(
      "data-row",
      "2",
    );
  });

  it("places a block by its start and length as shares of the timeline", () => {
    const { container } = renderLane(makeMedia([placed("a", 2, 5, 1)]));
    const block = container.querySelector<HTMLElement>("[data-testid='media-block-a']")!;
    expect(block.style.left).toBe("20%");
    expect(block.style.width).toBe("30%");
    // Handles sit on the two edges, 4 px either side (an 8 px hit area).
    expect(
      container.querySelector<HTMLElement>("[data-testid='media-handle-a-start']")!.style.left,
    ).toBe("calc(20% - 4px)");
    expect(
      container.querySelector<HTMLElement>("[data-testid='media-handle-a-end']")!.style.left,
    ).toBe("calc(50% - 4px)");
  });

  it("shows the thumbnail, an accessible name and the selected state", () => {
    const { container } = renderLane(
      makeMedia([placed("a", 0, 3, 1), placed("b", 5, 8, 2)], { selectedId: "b" }),
    );
    expect(container.querySelector("[data-testid='media-block-a'] img")).toHaveAttribute(
      "src",
      "blob:asset-a",
    );
    const a = container.querySelector("[data-testid='media-block-a']")!;
    const b = container.querySelector("[data-testid='media-block-b']")!;
    expect(a).toHaveAttribute("aria-label", "Floating image");
    expect(a).toHaveAttribute("aria-pressed", "false");
    expect(b).toHaveAttribute("aria-pressed", "true");
  });

  it("draws no picture while the image is not loaded", () => {
    const { container } = renderLane(makeMedia([placed("a", 0, 3, 1)], { imageUrl: () => null }));
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("MediaLane gestures", () => {
  function setup(): {
    media: TimelineMedia;
    body: HTMLElement;
    start: HTMLElement;
    end: HTMLElement;
  } {
    const media = makeMedia([placed("a", 2, 5, 1)]);
    const { container } = renderLane(media);
    return {
      media,
      body: container.querySelector<HTMLElement>("[data-testid='media-block-a']")!,
      start: container.querySelector<HTMLElement>("[data-testid='media-handle-a-start']")!,
      end: container.querySelector<HTMLElement>("[data-testid='media-handle-a-end']")!,
    };
  }

  it("dragging the body reports start once, the new start live, and end once", () => {
    const { media, body } = setup();
    // 300 px is 3 s; the item starts at 2 s.
    fireEvent.pointerDown(body, { pointerId: 1, button: 0, clientX: 300 });
    expect(media.onSelect).toHaveBeenCalledWith("a");
    expect(media.onInteractionStart).toHaveBeenCalledTimes(1);
    fireEvent.pointerMove(body, { pointerId: 1, clientX: 400 });
    expect(media.onMove).toHaveBeenLastCalledWith("a", 3);
    fireEvent.pointerMove(body, { pointerId: 1, clientX: 100 });
    expect(media.onMove).toHaveBeenLastCalledWith("a", 0); // 2 + (1 - 3) = 0
    fireEvent.pointerUp(body, { pointerId: 1, clientX: 100 });
    fireEvent.lostPointerCapture(body, { pointerId: 1 });
    expect(media.onInteractionEnd).toHaveBeenCalledTimes(1);
    expect(media.onResizeEdge).not.toHaveBeenCalled();
  });

  it("never reports a start before zero", () => {
    const { media, body } = setup();
    fireEvent.pointerDown(body, { pointerId: 1, button: 0, clientX: 500 });
    fireEvent.pointerMove(body, { pointerId: 1, clientX: 0 });
    // 2 + (0 - 5) = -3, clamped to 0 here; the page clamps the rest.
    expect(media.onMove).toHaveBeenLastCalledWith("a", 0);
  });

  it("a click without movement selects and never moves", () => {
    const { media, body } = setup();
    fireEvent.pointerDown(body, { pointerId: 1, button: 0, clientX: 300 });
    fireEvent.pointerUp(body, { pointerId: 1, clientX: 300 });
    // A real mouse click has detail 1; detail 0 would select through the keyboard branch.
    fireEvent.click(body, { detail: 1 });
    expect(media.onMove).not.toHaveBeenCalled();
    expect(media.onResizeEdge).not.toHaveBeenCalled();
    expect(media.onSelect).toHaveBeenCalledTimes(1);
    expect(media.onSelect).toHaveBeenCalledWith("a");
  });

  it("a keyboard activation (click with no pointer) selects", () => {
    const { media, body } = setup();
    fireEvent.click(body, { detail: 0 });
    expect(media.onSelect).toHaveBeenCalledWith("a");
    expect(media.onInteractionStart).not.toHaveBeenCalled();
  });

  it("a hover over the body does nothing", () => {
    const { media, body } = setup();
    fireEvent.pointerMove(body, { pointerId: 1, clientX: 600 });
    expect(media.onMove).not.toHaveBeenCalled();
  });

  it("dragging the left edge reports the time under the pointer for the start edge", () => {
    const { media, start } = setup();
    fireEvent.pointerDown(start, { pointerId: 1, button: 0, clientX: 200 });
    expect(media.onInteractionStart).toHaveBeenCalledTimes(1);
    fireEvent.pointerMove(start, { pointerId: 1, clientX: 150 });
    expect(media.onResizeEdge).toHaveBeenLastCalledWith("a", "start", 1.5);
    fireEvent.pointerUp(start, { pointerId: 1, clientX: 150 });
    expect(media.onInteractionEnd).toHaveBeenCalledTimes(1);
    expect(media.onMove).not.toHaveBeenCalled();
    // The edge's pointerdown did not also start a body drag: one interaction, not two.
    expect(media.onInteractionStart).toHaveBeenCalledTimes(1);
  });

  it("dragging the right edge reports the time under the pointer for the end edge", () => {
    const { media, end } = setup();
    fireEvent.pointerDown(end, { pointerId: 1, button: 0, clientX: 500 });
    fireEvent.pointerMove(end, { pointerId: 1, clientX: 800 });
    expect(media.onResizeEdge).toHaveBeenLastCalledWith("a", "end", 8);
    fireEvent.pointerUp(end, { pointerId: 1, clientX: 800 });
    expect(media.onInteractionEnd).toHaveBeenCalledTimes(1);
  });

  it("pointer cancel ends the drag exactly once", () => {
    const { media, body } = setup();
    fireEvent.pointerDown(body, { pointerId: 1, button: 0, clientX: 300 });
    fireEvent.pointerCancel(body, { pointerId: 1 });
    fireEvent.lostPointerCapture(body, { pointerId: 1 });
    expect(media.onInteractionEnd).toHaveBeenCalledTimes(1);
  });

  it("ends a drag whose block goes away mid-drag", () => {
    const media = makeMedia([placed("a", 2, 5, 1)]);
    const { container, unmount } = render(<MediaLane media={media} duration={10} />);
    mockRect(container.firstChild as HTMLElement);
    fireEvent.pointerDown(container.querySelector("[data-testid='media-block-a']")!, {
      pointerId: 1,
      button: 0,
      clientX: 300,
    });
    unmount();
    expect(media.onInteractionEnd).toHaveBeenCalledTimes(1);
  });

  it("ignores a secondary button", () => {
    const { media, body } = setup();
    fireEvent.pointerDown(body, { pointerId: 1, button: 2, clientX: 300 });
    expect(media.onInteractionStart).not.toHaveBeenCalled();
  });

  it("a drag that moves the block to another row carries on: the same element keeps its capture", () => {
    const a = placed("a", 0, 4, 1);
    const b = placed("b", 5, 8, 2);
    const before = makeMedia([a, b]);
    const { container, rerender } = render(<MediaLane media={before} duration={10} />);
    mockRect(container.firstChild as HTMLElement);
    const blockB = container.querySelector<HTMLElement>("[data-testid='media-block-b']")!;
    fireEvent.pointerDown(blockB, { pointerId: 1, button: 0, clientX: 600 });
    // b was dragged onto a in time: it is now row 2.
    const after = makeMedia([a, placed("b", 2, 5, 2)]);
    rerender(<MediaLane media={after} duration={10} />);
    expect(blockB).toHaveAttribute("data-row", "2");
    expect(container.querySelector("[data-testid='media-block-b']")).toBe(blockB);
    // Not remounted: the same node still carries the drag, and nothing ended it.
    fireEvent.pointerMove(blockB, { pointerId: 1, clientX: 300 });
    expect(after.onMove).toHaveBeenCalled();
    expect(before.onInteractionEnd).not.toHaveBeenCalled();
    expect(after.onInteractionEnd).not.toHaveBeenCalled();
  });
});
