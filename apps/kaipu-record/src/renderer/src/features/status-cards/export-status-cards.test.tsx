import { act, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Translator } from "@kaipu/i18n";
import type { LocalRecording } from "@shared/types/library-storage";
import {
  __resetExportRunnerForTests,
  getExportSnapshot,
  type ExportJobInfo,
  startVideoExport,
} from "@renderer/features/video-editor/export/export-runner";
import { initialScene } from "@renderer/features/video-editor/scene";
import { createSlideAssetStore } from "@renderer/features/video-editor/slide-assets";
import {
  __resetReadyCopiesForTests,
  getReadyCopies,
  noteFinishedCopy,
} from "@renderer/features/video-editor/export/ready-copies";
import { ExportProgressCard, ExportReadyCard, ExportStatusCards } from "./export-status-cards";

const JOB: ExportJobInfo = {
  presetId: "light",
  sourceTitle: "Demo",
  sourceAssetId: "asset-src",
  sourceSizeBytes: 119_000_000,
  estimateBytes: 9_200_000,
  width: 1280,
  height: 720,
};

const RECORDING: LocalRecording = {
  id: "new-rec",
  assetId: "asset-new",
  kind: "recording",
  title: "Demo (light)",
  filePath: "/vault/new-rec.mp4",
  createdAt: 1,
  sizeBytes: 8_100_000,
  durationSeconds: 78,
  thumbnailUrl: null,
  derivedFromAssetId: "asset-src",
  contentSha256: null,
};

function inRouter(element: React.ReactNode) {
  const router = createMemoryRouter(
    [
      { path: "/", element },
      { path: "/library/:assetId", element: <p>library-detail</p> },
    ],
    { initialEntries: ["/"] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

afterEach(() => {
  __resetExportRunnerForTests();
  __resetReadyCopiesForTests();
});

describe("ExportProgressCard", () => {
  const props = {
    job: JOB,
    status: "exporting" as const,
    fraction: 0.64,
    error: null,
    attemptStartedAt: 0,
    now: () => 36_000,
  };

  it("names the destination, how far along, about how long is left, and where the size is heading", () => {
    render(<ExportProgressCard {...props} job={{ ...JOB, destination: "github" }} />);
    expect(screen.getByText("Preparing your GitHub copy…")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "64");
    expect(screen.getByText("64% · about 25 s left · you can keep working")).toBeInTheDocument();
    expect(screen.getByText("119 MB → ~9.2 MB")).toBeInTheDocument();
  });

  it("calls an editor export (no destination) 'your export'", () => {
    render(<ExportProgressCard {...props} />);
    expect(screen.getByText("Preparing your export…")).toBeInTheDocument();
  });

  it("shows only the percent until the rate is known", () => {
    render(<ExportProgressCard {...props} fraction={0.01} now={() => 500} />);
    expect(screen.getByText("1% · you can keep working")).toBeInTheDocument();
  });

  it("says 'up to' for a fixed canvas and nothing about sizes without the original's", () => {
    const { rerender } = render(
      <ExportProgressCard
        {...props}
        job={{ ...JOB, presetId: "youtube-1440", estimateBytes: 61_000_000 }}
      />,
    );
    expect(screen.getByText("119 MB → up to ~61 MB")).toBeInTheDocument();
    rerender(<ExportProgressCard {...props} job={{ ...JOB, sourceSizeBytes: null }} />);
    expect(screen.queryByText(/→/)).toBeNull();
  });

  it("offers Retry and Close when it failed", () => {
    render(<ExportProgressCard {...props} status="error" error="Couldn't export the video." />);
    expect(screen.getByText("Couldn't export the video.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Close" }).length).toBeGreaterThan(0);
  });
});

describe("ExportReadyCard", () => {
  it("names the destination, the copy's size and that it is in the Library", () => {
    inRouter(
      <ExportReadyCard
        ready={{
          job: {
            ...JOB,
            presetId: "youtube-1440",
            destination: "youtube",
            width: 2560,
            height: 1440,
          },
          recording: { ...RECORDING, sizeBytes: 566_000_000 },
        }}
      />,
    );
    expect(screen.getByText("Your YouTube copy is ready")).toBeInTheDocument();
    expect(screen.getByText(/2560 × 1440 · 566 MB/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open Demo (light) in your Library" }),
    ).toHaveTextContent("in your Library");
    // A POST copy says nothing about GitHub.
    expect(screen.queryByText(/GitHub/)).toBeNull();
  });

  it("calls an editor export 'your export', and says where a tier's copy fits on GitHub", () => {
    inRouter(<ExportReadyCard ready={{ job: JOB, recording: RECORDING }} />);
    expect(screen.getByText("Your export is ready")).toBeInTheDocument();
    // 8.1 MB: fits both plans.
    expect(screen.getByText("GitHub Free · 10 MB")).toHaveAttribute("data-fits", "true");
  });

  it("Drag to upload drags the file out under the item's title, and counts as seen", () => {
    const startFileDrag = vi.spyOn(window.electronAPI, "startFileDrag");
    noteFinishedCopy(RECORDING.assetId);
    inRouter(<ExportReadyCard ready={{ job: JOB, recording: RECORDING }} />);
    const drag = screen.getByRole("button", { name: "Drag Demo (light).mp4 out of Kaipu" });
    expect(drag).toHaveAttribute("draggable", "true");
    expect(drag).toHaveTextContent("Drag to upload");
    fireEvent.dragStart(drag);
    expect(startFileDrag).toHaveBeenCalledWith("new-rec", "Demo (light)");
    expect(getReadyCopies().copies).toEqual([]);
    startFileDrag.mockRestore();
  });

  it("Show in Finder reveals the file and counts as seen; 'in your Library' opens it", async () => {
    const reveal = vi.spyOn(window.electronAPI, "revealLocalRecording");
    noteFinishedCopy(RECORDING.assetId);
    const router = inRouter(<ExportReadyCard ready={{ job: JOB, recording: RECORDING }} />);
    fireEvent.click(screen.getByRole("button", { name: "Show in Finder" }));
    expect(reveal).toHaveBeenCalledWith("new-rec");
    expect(getReadyCopies().copies).toEqual([]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open Demo (light) in your Library" }));
    });
    expect(router.state.location.pathname).toBe("/library/asset-new");
    expect(getExportSnapshot().ready).toBeNull();
    reveal.mockRestore();
  });
});

describe("ExportStatusCards", () => {
  const t = ((key: string) => key) as unknown as Translator<"videoEditor">;

  async function startExport(): Promise<void> {
    vi.stubGlobal(
      "Worker",
      class {
        onmessage = null;
        onerror = null;
        postMessage = vi.fn();
        terminate = vi.fn();
      },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ blob: async () => new Blob(["mp4"]) })),
    );
    window.electronAPI.recordingCreate = vi.fn(async () => ({ tempPath: "/tmp/x.part" }));
    window.electronAPI.recordingAbort = vi.fn(async () => {});
    window.electronAPI.setExportActive = vi.fn();
    await act(async () => {
      await startVideoExport(
        {
          scene: {
            ...initialScene(78),
            items: [{ id: "a", kind: "clip", sourceStart: 0, sourceEnd: 78 }],
          },
          sourceId: "rec-1",
          title: "Demo",
          derivedFromAssetId: "asset-src",
          sourceSizeBytes: 119_000_000,
          videoWidth: 1920,
          videoHeight: 1080,
          previewWidth: 1920,
          slideAssets: createSlideAssetStore(),
          cameraPath: null,
          presetId: "youtube-1440",
          destination: "youtube",
          onSaved: vi.fn(),
        },
        t,
      );
    });
  }

  afterEach(() => vi.unstubAllGlobals());

  it("✕ hides the progress card and the export keeps running; Cancel stops it", async () => {
    await startExport();
    inRouter(<ExportStatusCards />);
    expect(screen.getByText("Preparing your YouTube copy…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide — it keeps going" }));
    expect(screen.queryByText("Preparing your YouTube copy…")).toBeNull();
    expect(getExportSnapshot().status).toBe("exporting");

    __resetExportRunnerForTests();
    await startExport();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(getExportSnapshot().status).toBe("idle");
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
