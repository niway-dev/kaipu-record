import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import type { PreviewPlayback } from "../use-preview-playback";
import { PreviewStage } from "./preview-stage";

/** Only the members PreviewStage wires to the <video> element. */
function stubPlayback(): PreviewPlayback {
  return {
    videoRef: { current: null },
    onVideoTimeUpdate: vi.fn(),
    onVideoEnded: vi.fn(),
    onVideoPlay: vi.fn(),
    onVideoPause: vi.fn(),
    toggle: vi.fn(),
  } as unknown as PreviewPlayback;
}

describe("PreviewStage — onFrameSize", () => {
  it("reports the decoded frame size once metadata lands", () => {
    const onFrameSize = vi.fn();
    const { container } = render(
      <PreviewStage playback={stubPlayback()} mediaUrl="blob:x" onFrameSize={onFrameSize} />,
    );
    const video = container.querySelector("video")!;

    // jsdom decodes nothing, so the size has to be stubbed onto the element the event
    // reports through — the same approach video-editor-page.test.tsx uses.
    Object.defineProperty(video, "videoWidth", { configurable: true, get: () => 2560 });
    Object.defineProperty(video, "videoHeight", { configurable: true, get: () => 1440 });
    fireEvent.loadedMetadata(video);

    expect(onFrameSize).toHaveBeenCalledWith({ width: 2560, height: 1440 });
  });

  it("stays silent while the size is still 0 — a 0 would read as a known-small source", () => {
    const onFrameSize = vi.fn();
    const { container } = render(
      <PreviewStage playback={stubPlayback()} mediaUrl="blob:x" onFrameSize={onFrameSize} />,
    );
    fireEvent.loadedMetadata(container.querySelector("video")!);
    expect(onFrameSize).not.toHaveBeenCalled();
  });

  it("does not require the callback", () => {
    const { container } = render(<PreviewStage playback={stubPlayback()} mediaUrl="blob:x" />);
    expect(() => fireEvent.loadedMetadata(container.querySelector("video")!)).not.toThrow();
  });
});
