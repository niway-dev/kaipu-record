import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@shared/types";
import { dismissToast, getToasts } from "@renderer/ui/toast-store";
import type { LibraryVideo } from "../types";
import { ShareRecording } from "./share-recording";

const probe = vi.hoisted(() => vi.fn());
vi.mock("@renderer/features/video-editor/export/probe-source", () => ({ probeSource: probe }));

// The worker pipeline itself is covered by use-video-export.test.ts; here only what Share
// hands it matters.
const exportController = vi.hoisted(() => ({
  status: "idle" as "idle" | "exporting" | "error",
  fraction: 0,
  error: null as string | null,
  start: vi.fn(async () => {}),
  cancel: vi.fn(),
}));
vi.mock("@renderer/features/video-editor/export/use-video-export", () => ({
  useVideoExport: () => exportController,
}));

const PROBE = {
  width: 1662,
  height: 1080,
  durationSec: 12.4,
  fps: 30,
  hasAudio: true,
  sampleRate: 48000,
};

const VIDEO: LibraryVideo & { id: string } = {
  id: "rec-1",
  assetId: "asset-1",
  kind: "recording",
  title: "Demo",
  createdAt: 1,
  durationSeconds: 12,
  fileSizeBytes: 1000,
  cloudSizeBytes: null,
  availability: "local",
  comparison: "same",
  editing: "project-available",
  transfer: { state: "idle" },
  derivedFromAssetId: null,
  editSavedAt: null,
  editExportedSavedAt: null,
};

function renderShare(overrides: Partial<Parameters<typeof ShareRecording>[0]> = {}) {
  const props = {
    video: VIDEO,
    exports: [] as LibraryVideo[],
    onSaved: vi.fn(),
    onOpenExisting: vi.fn(),
    ...overrides,
  };
  render(<ShareRecording {...props} />);
  return props;
}

beforeEach(() => {
  probe.mockResolvedValue(PROBE);
  exportController.status = "idle";
  exportController.start.mockClear();
  window.electronAPI.getSettings = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);
});

afterEach(() => {
  for (const t of getToasts()) dismissToast(t.id);
});

describe("ShareRecording", () => {
  it("opens the export sheet for the whole recording with Balanced preselected", async () => {
    renderShare();
    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    expect(await screen.findByRole("heading", { name: "Share a copy" })).toBeVisible();
    expect(probe).toHaveBeenCalledWith("rec-1");
    const balanced = screen.getByRole("radio", { name: /^Balanced/ });
    expect(balanced).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Demo · 0:12 · 1662×1080")).toBeInTheDocument();
    // MP4 only: no GIF format switch here.
    expect(screen.queryByRole("radio", { name: "GIF" })).toBeNull();
  });

  it("exports through the same pipeline with a trivial plan: one clip, nothing else", async () => {
    renderShare();
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    fireEvent.click(await screen.findByRole("radio", { name: /^YouTube/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Export / }));

    expect(exportController.start).toHaveBeenCalledOnce();
    const [args] = exportController.start.mock.calls[0] as unknown as [
      Record<string, unknown> & { scene: { items: unknown[]; overlays: unknown[] } },
    ];
    expect(args).toMatchObject({
      sourceId: "rec-1",
      title: "Demo",
      derivedFromAssetId: "asset-1",
      videoWidth: 1662,
      videoHeight: 1080,
      cameraPath: null,
      presetId: "youtube",
      fingerprint: "whole",
    });
    expect(args.scene.items).toEqual([
      expect.objectContaining({ kind: "clip", sourceStart: 0, sourceEnd: 12.4 }),
    ]);
    expect(args.scene.overlays).toEqual([]);
    expect(screen.queryByRole("heading", { name: "Share a copy" })).toBeNull();
  });

  it("offers an existing whole-recording export instead of encoding it again", async () => {
    const existing: LibraryVideo = {
      ...VIDEO,
      id: "rec-2",
      assetId: "asset-2",
      title: "Demo (for sharing)",
      derivedFromAssetId: "asset-1",
      export: { preset: "balanced", fingerprint: "whole" },
    };
    const props = renderShare({ exports: [existing] });
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await screen.findByRole("radio", { name: /^Balanced/ });
    expect(screen.getByRole("button", { name: "Open the existing Balanced file" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(props.onOpenExisting).toHaveBeenCalledWith(existing);
    expect(exportController.start).not.toHaveBeenCalled();
  });

  it("does not reuse an editor export (it carries edits)", async () => {
    const edited: LibraryVideo = {
      ...VIDEO,
      id: "rec-3",
      assetId: "asset-3",
      derivedFromAssetId: "asset-1",
      export: { preset: "balanced", fingerprint: "edit:abc" },
    };
    renderShare({ exports: [edited] });
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await screen.findByRole("radio", { name: /^Balanced/ });
    expect(screen.queryByText("Already exported · Open")).toBeNull();
  });

  it("says so when the file can't be read, and opens nothing", async () => {
    probe.mockResolvedValue(null);
    renderShare();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share" }));
    });
    await waitFor(() =>
      expect(getToasts()).toContainEqual(
        expect.objectContaining({
          message: "Couldn't read this recording to prepare a file.",
        }),
      ),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("shows the progress dialog while exporting", () => {
    exportController.status = "exporting";
    renderShare();
    expect(screen.getByText("Exporting video…")).toBeInTheDocument();
  });
});
