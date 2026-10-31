import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { pictureBox, RecordingPlayer } from "./recording-player";

function video(container: HTMLElement): HTMLVideoElement {
  return container.querySelector("video")!;
}

/** jsdom has no media pipeline: set what the element would report, then fire its event. */
function at(element: HTMLVideoElement, time: number): void {
  element.currentTime = time;
  fireEvent.timeUpdate(element);
}

describe("RecordingPlayer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("serves the id through the media protocol", () => {
    const { container } = render(<RecordingPlayer id="Sprint demo" />);
    expect(video(container).getAttribute("src")).toBe("kaipu-media://recording/Sprint%20demo");
  });

  it("restores the playback position after the id changes (a rename moved the file)", () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const { container, rerender } = render(<RecordingPlayer id="old" />);
    fireEvent.play(video(container));
    at(video(container), 42);

    rerender(<RecordingPlayer id="New name" />);
    // The reload's own events must not overwrite the saved position.
    at(video(container), 0);
    fireEvent.loadedMetadata(video(container));

    expect(video(container).getAttribute("src")).toBe("kaipu-media://recording/New%20name");
    expect(video(container).currentTime).toBe(42);
    expect(pause).not.toHaveBeenCalled();
  });

  it("keeps a paused video paused across the id change", () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const { container, rerender } = render(<RecordingPlayer id="old" />);
    at(video(container), 7);
    fireEvent.pause(video(container));

    rerender(<RecordingPlayer id="new" />);
    fireEvent.play(video(container)); // autoplay on the new source
    fireEvent.loadedMetadata(video(container));

    expect(video(container).currentTime).toBe(7);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it("does not seek on the first load", () => {
    const { container } = render(<RecordingPlayer id="clip" />);
    at(video(container), 3);
    fireEvent.loadedMetadata(video(container));
    expect(video(container).currentTime).toBe(3);
  });
});

describe("pictureBox", () => {
  it("fills the 16:9 player with a 16:9 picture", () => {
    expect(pictureBox({ width: 1920, height: 1080 })).toEqual({ width: "100%", height: "100%" });
  });

  it("pillarboxes a taller picture: full height, narrower width", () => {
    expect(pictureBox({ width: 1080, height: 1080 })).toEqual({
      width: "56.25%",
      height: "100%",
    });
  });

  it("letterboxes a wider picture: full width, shorter height", () => {
    const box = pictureBox({ width: 3200, height: 900 });
    expect(box.width).toBe("100%");
    expect(parseFloat(box.height)).toBeCloseTo(50, 5);
  });
});
