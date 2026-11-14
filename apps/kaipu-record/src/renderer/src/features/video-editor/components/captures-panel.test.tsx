import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryVideo } from "@renderer/features/library/types";
import { dismissToast, getToasts } from "@renderer/ui/toast-store";
import { CapturesPanel, type CapturesPanelProps } from "./captures-panel";

function capture(over: Partial<LibraryVideo>): LibraryVideo {
  return {
    id: "frame-1",
    assetId: "asset-1",
    kind: "screenshot",
    title: "Demo frame 1m23s",
    createdAt: 1,
    durationSeconds: 0,
    fileSizeBytes: 10,
    cloudSizeBytes: null,
    thumbnailUrl: "kaipu-media://screenshot/frame-1",
    sourceVideoAssetId: "video-1",
    sourceTimeSeconds: 83.4,
    ...over,
  } as LibraryVideo;
}

function renderPanel(over: Partial<CapturesPanelProps> = {}): CapturesPanelProps {
  const props: CapturesPanelProps = {
    captures: [],
    loaded: true,
    onSeek: vi.fn(),
    onCaptureFrame: vi.fn(),
    captureBusy: false,
    onClose: vi.fn(),
    ...over,
  };
  render(<CapturesPanel {...props} />);
  return props;
}

const original = { ...window.electronAPI };
beforeEach(() => {
  window.electronAPI.copyScreenshotById = vi.fn(async () => {});
});
afterEach(() => {
  cleanup();
  Object.assign(window.electronAPI, original);
  for (const toast of getToasts()) dismissToast(toast.id);
});

describe("CapturesPanel", () => {
  it("is marked as the editorVideo.capturesPanel area", () => {
    renderPanel();
    expect(document.querySelector('[data-ui-area="editorVideo.capturesPanel"]')).not.toBeNull();
  });

  it("with nothing captured, says so and offers Capture frame", () => {
    const props = renderPanel();
    expect(screen.getByText("No captures of this video yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Capture frame" }));
    expect(props.onCaptureFrame).toHaveBeenCalledOnce();
  });

  it("waits for the first read before saying there is nothing", () => {
    renderPanel({ loaded: false });
    expect(screen.queryByText("No captures of this video yet.")).toBeNull();
  });

  it("disables the empty state's button while a capture runs", () => {
    renderPanel({ captureBusy: true });
    expect(screen.getByRole("button", { name: "Capture frame" })).toBeDisabled();
  });

  it("lists each capture in the given order with its time", () => {
    renderPanel({
      captures: [
        capture({ assetId: "b", sourceTimeSeconds: 12.3, id: "b" }),
        capture({ assetId: "a", sourceTimeSeconds: 83.4, id: "a" }),
      ],
    });
    const items = screen.getAllByTestId("capture-item");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText("0:12.3")).toBeInTheDocument();
    expect(within(items[1]).getByText("1:23.4")).toBeInTheDocument();
    expect(items[0].querySelector("img")).toHaveAttribute(
      "src",
      "kaipu-media://screenshot/frame-1",
    );
  });

  it("names the image of a capture that has no click action (a slide frame)", () => {
    renderPanel({
      captures: [capture({ sourceTimeSeconds: null, title: "Demo slide frame" })],
    });
    expect(screen.queryByRole("button", { name: /Go to/ })).toBeNull();
    expect(screen.getByRole("img", { name: "Demo slide frame" })).toBeInTheDocument();
  });

  it("leaves the image alt empty inside the seek button, which already names it", () => {
    renderPanel({ captures: [capture({ sourceTimeSeconds: 83.4 })] });
    const button = screen.getByRole("button", { name: "Go to 1:23.4" });
    expect(button.querySelector("img")).toHaveAttribute("alt", "");
  });

  it("seeks to the capture's source time when its image is clicked", () => {
    const props = renderPanel({ captures: [capture({ sourceTimeSeconds: 83.4 })] });
    fireEvent.click(screen.getByRole("button", { name: "Go to 1:23.4" }));
    expect(props.onSeek).toHaveBeenCalledWith(83.4);
  });

  it("copies the image by its library id and confirms", async () => {
    renderPanel({ captures: [capture({ id: "frame-9" })] });
    fireEvent.click(screen.getByRole("button", { name: "Copy image" }));
    await waitFor(() =>
      expect(window.electronAPI.copyScreenshotById).toHaveBeenCalledWith("frame-9"),
    );
    await waitFor(() => expect(getToasts().map((t) => t.message)).toContain("Image copied"));
  });

  it("tells the user when copying fails", async () => {
    window.electronAPI.copyScreenshotById = vi.fn(async () => {
      throw new Error("clipboard");
    });
    renderPanel({ captures: [capture({})] });
    fireEvent.click(screen.getByRole("button", { name: "Copy image" }));
    await waitFor(() =>
      expect(getToasts().map((t) => t.message)).toContain(
        "Couldn't copy the screenshot to the clipboard.",
      ),
    );
  });

  it("closes from its button", () => {
    const props = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Close captures" }));
    expect(props.onClose).toHaveBeenCalledOnce();
  });
});
