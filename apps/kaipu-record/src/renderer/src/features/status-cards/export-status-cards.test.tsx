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
import {
  __resetExportWidgetForTests,
  isExportWidgetMinimized,
  setExportWidgetMinimized,
} from "./export-widget-state";

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
  __resetExportWidgetForTests();
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
    expect(screen.getByText("Exporting for GitHub")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "64");
    expect(screen.getByText("64% · about 25 s left")).toBeInTheDocument();
    expect(screen.getByText("119 MB → ~9.2 MB")).toBeInTheDocument();
    expect(
      screen.getByText("Keep working. The copy lands in your Library when it’s done."),
    ).toBeInTheDocument();
  });

  it("names an Email copy in progress", () => {
    render(<ExportProgressCard {...props} job={{ ...JOB, destination: "email" }} />);
    expect(screen.getByText("Exporting for email")).toBeInTheDocument();
  });

  it("calls an editor export (no destination) 'your video'", () => {
    render(<ExportProgressCard {...props} />);
    expect(screen.getByText("Exporting your video")).toBeInTheDocument();
  });

  it("shows only the percent until the rate is known", () => {
    render(<ExportProgressCard {...props} fraction={0.01} now={() => 500} />);
    expect(screen.getByText("1%")).toBeInTheDocument();
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
    expect(screen.getByText("YouTube copy ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Drag .* out of Kaipu/ })).toHaveTextContent(
      "Drag to YouTube Studio",
    );
    expect(screen.getByText(/2560 × 1440 · 566 MB/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open Demo (light) in your Library" }),
    ).toHaveTextContent("in your Library");
    // A POST copy says nothing about GitHub.
    expect(screen.queryByText(/GitHub/)).toBeNull();
  });

  it("names an Email copy as such, not as 'your export'", () => {
    const job = { ...JOB, presetId: "balanced" as const, destination: "email" as const };
    inRouter(<ExportReadyCard ready={{ job, recording: RECORDING }} />);
    expect(screen.getByText("Email copy ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Drag .* out of Kaipu/ })).toHaveTextContent(
      "Drag to an email",
    );
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
    // Nothing for Enter or Space to do, so not a Tab stop; Show in Finder is.
    expect(drag).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("button", { name: "Show in Finder" })).not.toHaveAttribute("tabindex");
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

  const workers: Array<{ onmessage: ((e: MessageEvent) => void) | null }> = [];

  async function startExport(): Promise<void> {
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          workers.push(this);
        }
        onmessage: ((e: MessageEvent) => void) | null = null;
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

  it("minimizes to a pill with the percent and the export keeps running; the pill opens it again", async () => {
    await startExport();
    inRouter(<ExportStatusCards />);
    expect(screen.getByText("Exporting for YouTube")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Minimize — it keeps going" }));
    expect(screen.queryByText("Exporting for YouTube")).toBeNull();
    expect(screen.getByText("YouTube copy · 0%")).toBeInTheDocument();
    expect(getExportSnapshot().status).toBe("exporting");
    expect(isExportWidgetMinimized()).toBe(true);

    // Its name says what it shows, then what it does.
    fireEvent.click(
      screen.getByRole("button", { name: "YouTube copy · 0%. Show the export's progress" }),
    );
    expect(screen.getByText("Exporting for YouTube")).toBeInTheDocument();
    expect(isExportWidgetMinimized()).toBe(false);
  });

  it("the minimized choice holds for the session: the next export opens as a pill", async () => {
    setExportWidgetMinimized(true);
    expect(window.sessionStorage.getItem("kaipu.exportWidgetMinimized")).toBe("1");
    await startExport();
    inRouter(<ExportStatusCards />);
    expect(screen.getByText("YouTube copy · 0%")).toBeInTheDocument();
    expect(screen.queryByText("Exporting for YouTube")).toBeNull();
  });

  it("an error shows in full even while minimized", async () => {
    setExportWidgetMinimized(true);
    await startExport();
    inRouter(<ExportStatusCards />);
    act(() => {
      workers.at(-1)!.onmessage?.({ data: { type: "error", message: "boom" } } as MessageEvent);
    });
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("Cancel in the widget stops the export", async () => {
    await startExport();
    inRouter(<ExportStatusCards />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(getExportSnapshot().status).toBe("idle");
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
