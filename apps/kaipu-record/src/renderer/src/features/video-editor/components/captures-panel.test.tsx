import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryVideo } from "@renderer/features/library/types";
import { dismissToast, getToasts } from "@renderer/ui/toast-store";
import { VAULT_MAINTENANCE_MARKER } from "@shared/types/library-storage";
import { CapturesPanel, type CapturesPanelProps } from "./captures-panel";

// `useFlag` reads PostHog; the tests pin each side of timeline-levels (NIW2-772).
const flags = vi.hoisted(() => ({ "timeline-levels": false }) as Record<string, boolean>);
vi.mock("@renderer/features/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@renderer/features/analytics")>()),
  useFlag: (name: string) => flags[name] ?? false,
}));

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
    onAddToTimeline: vi.fn(),
    onDelete: vi.fn(async () => {}),
    onClose: vi.fn(),
    ...over,
  };
  render(<CapturesPanel {...props} />);
  return props;
}

const original = { ...window.electronAPI };
beforeEach(() => {
  flags["timeline-levels"] = false;
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

  it("with nothing captured, says so and where to capture", () => {
    renderPanel();
    expect(screen.getByText(/No captures of this video yet\./)).toBeInTheDocument();
    expect(screen.getByText(/camera in the top bar/)).toBeInTheDocument();
  });

  it("has no Capture frame button: it lives in the top bar", () => {
    renderPanel({ captures: [capture({})] });
    expect(screen.queryByRole("button", { name: "Capture frame" })).toBeNull();
  });

  it("waits for the first read before saying there is nothing", () => {
    renderPanel({ loaded: false });
    expect(screen.queryByText(/No captures of this video yet/)).toBeNull();
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

  it("names the image itself: in the panel it is not a button", () => {
    renderPanel({ captures: [capture({ title: "Demo slide frame" })] });
    expect(screen.getByRole("img", { name: "Demo slide frame" })).toBeInTheDocument();
  });

  it("has no Go to on a capture with no time (a slide frame), but keeps Copy and Delete", () => {
    renderPanel({ captures: [capture({ sourceTimeSeconds: null })] });
    expect(screen.queryByRole("button", { name: /Go to/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy image" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete capture" })).toBeInTheDocument();
  });

  it("puts Go to on the image, not in the actions row", () => {
    renderPanel({ captures: [capture({})] });
    const goTo = screen.getByRole("button", { name: "Go to 1:23.4" });
    const frame = document.querySelector('[data-testid="capture-item"] > div');
    expect(frame?.contains(goTo)).toBe(true);
    expect(frame?.contains(screen.getByRole("button", { name: "Copy image" }))).toBe(false);
  });

  describe("with timeline-levels off (the default)", () => {
    it("has no Add to timeline button, and keeps Go to, Copy and Delete", () => {
      renderPanel({ captures: [capture({ id: "a" }), capture({ id: "b", assetId: "b" })] });
      expect(screen.queryByRole("button", { name: "Add to timeline" })).toBeNull();
      expect(screen.getAllByRole("button", { name: "Go to 1:23.4" })).toHaveLength(2);
      expect(screen.getAllByRole("button", { name: "Copy image" })).toHaveLength(2);
      expect(screen.getAllByRole("button", { name: "Delete capture" })).toHaveLength(2);
    });

    it("has none on a slide capture either", () => {
      renderPanel({ captures: [capture({ sourceTimeSeconds: null })] });
      expect(screen.queryByRole("button", { name: "Add to timeline" })).toBeNull();
    });
  });

  describe("with timeline-levels on", () => {
    beforeEach(() => {
      flags["timeline-levels"] = true;
    });

    it("adds a capture to the timeline from its Add to timeline button", () => {
      const target = capture({ id: "frame-3" });
      const props = renderPanel({ captures: [capture({ id: "other", assetId: "o" }), target] });
      fireEvent.click(screen.getAllByRole("button", { name: "Add to timeline" })[1]);
      expect(props.onAddToTimeline).toHaveBeenCalledOnce();
      expect(props.onAddToTimeline).toHaveBeenCalledWith(target);
    });

    it("offers Add to timeline on a slide capture too", () => {
      renderPanel({ captures: [capture({ sourceTimeSeconds: null })] });
      expect(screen.getByRole("button", { name: "Add to timeline" })).toBeInTheDocument();
    });
  });

  it("seeks to the capture's source time from its Go to button", () => {
    const props = renderPanel({ captures: [capture({ sourceTimeSeconds: 83.4 })] });
    fireEvent.click(screen.getByRole("button", { name: "Go to 1:23.4" }));
    expect(props.onSeek).toHaveBeenCalledWith(83.4);
  });

  it("marks the highlighted capture", () => {
    renderPanel({
      captures: [capture({ assetId: "a" }), capture({ assetId: "b" })],
      highlightedId: "b",
    });
    const items = screen.getAllByTestId("capture-item");
    expect(items[0]).not.toHaveAttribute("data-highlighted");
    expect(items[1]).toHaveAttribute("data-highlighted", "true");
  });

  it("asks before deleting and deletes only on confirm", async () => {
    const target = capture({ id: "frame-9", title: "Demo frame 9s" });
    const props = renderPanel({ captures: [target] });
    fireEvent.click(screen.getByRole("button", { name: "Delete capture" }));
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(screen.getByText(/Demo frame 9s/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(props.onDelete).toHaveBeenCalledWith(target));
  });

  it("cancel closes the dialog without deleting", () => {
    const props = renderPanel({ captures: [capture({})] });
    fireEvent.click(screen.getByRole("button", { name: "Delete capture" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("reports a failed delete and keeps the item", async () => {
    const props = renderPanel({
      captures: [capture({})],
      onDelete: vi.fn(async () => {
        throw new Error("busy");
      }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete capture" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(props.onDelete).toHaveBeenCalled());
    await waitFor(() => expect(getToasts().length).toBeGreaterThan(0));
    expect(screen.getAllByTestId("capture-item")).toHaveLength(1);
  });

  it("says the files are being fixed when the vault refuses the delete", async () => {
    renderPanel({
      captures: [capture({})],
      onDelete: vi.fn(async () => {
        throw new Error(`refused: ${VAULT_MAINTENANCE_MARKER}`);
      }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete capture" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(getToasts().map((t) => t.message)).toEqual([
        "Kaipu is fixing your files. Try again in a moment.",
      ]),
    );
    expect(screen.getAllByTestId("capture-item")).toHaveLength(1);
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
