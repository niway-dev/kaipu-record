import { act, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalRecording } from "@shared/types/library-storage";
import {
  __resetExportRunnerForTests,
  getExportSnapshot,
  type ExportJobInfo,
} from "@renderer/features/video-editor/export/export-runner";
import { ExportProgressCard, ExportReadyCard } from "./export-status-cards";

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

afterEach(() => __resetExportRunnerForTests());

describe("ExportProgressCard", () => {
  const props = {
    job: JOB,
    status: "exporting" as const,
    fraction: 0.64,
    error: null,
    attemptStartedAt: 0,
    now: () => 36_000,
  };

  it("shows what it makes, how far along, about how long is left, and where the size is heading", () => {
    render(<ExportProgressCard {...props} />);
    expect(screen.getByText("Making a lighter copy…")).toBeInTheDocument();
    expect(screen.getByText("Light · 1280×720")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "64");
    expect(screen.getByText("64% · about 25 s left")).toBeInTheDocument();
    expect(screen.getByText("119 MB → ~9.2 MB")).toBeInTheDocument();
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
  it("reports the real size against the original, and that a tier's copy fits GitHub", () => {
    inRouter(<ExportReadyCard ready={{ job: JOB, recording: RECORDING }} />);
    expect(screen.getByText("Ready to share · 8.1 MB")).toBeInTheDocument();
    expect(screen.getByText("93% lighter than the original.")).toBeInTheDocument();
    expect(screen.getByText("Original 119 MB")).toBeInTheDocument();
    // 8.1 MB: fits both plans.
    expect(screen.getByText("GitHub Free · 10 MB")).toHaveAttribute("data-fits", "true");
    expect(screen.getByText("GitHub Pro / Team / Enterprise · 100 MB")).toBeInTheDocument();
  });

  it("says nothing about GitHub for a POST row, and warns when a tier's copy is over 100 MB", () => {
    const { unmount } = render(
      <RouterProvider
        router={createMemoryRouter([
          {
            path: "/",
            element: (
              <ExportReadyCard
                ready={{ job: { ...JOB, presetId: "youtube-1440" }, recording: RECORDING }}
              />
            ),
          },
        ])}
      />,
    );
    expect(screen.queryByText(/GitHub/)).toBeNull();
    unmount();
    inRouter(
      <ExportReadyCard
        ready={{
          job: { ...JOB, sourceSizeBytes: 900_000_000 },
          recording: { ...RECORDING, sizeBytes: 140_000_000 },
        }}
      />,
    );
    expect(screen.getByText("Too big for GitHub — export a shorter part")).toHaveAttribute(
      "data-warn",
      "true",
    );
  });

  it("drags the file out under the item's title, not its vault id", () => {
    const startFileDrag = vi.spyOn(window.electronAPI, "startFileDrag");
    inRouter(<ExportReadyCard ready={{ job: JOB, recording: RECORDING }} />);
    const chip = screen.getByRole("button", { name: "Drag Demo (light).mp4 out of Kaipu" });
    expect(chip).toHaveAttribute("draggable", "true");
    expect(screen.getByText("Drag it into a GitHub or Jira comment")).toBeInTheDocument();
    fireEvent.dragStart(chip);
    expect(startFileDrag).toHaveBeenCalledWith("new-rec", "Demo (light)");
    startFileDrag.mockRestore();
  });

  it("View file opens the exported item's page; Show in Finder reveals it; Done closes", async () => {
    const reveal = vi.spyOn(window.electronAPI, "revealLocalRecording");
    const router = inRouter(<ExportReadyCard ready={{ job: JOB, recording: RECORDING }} />);
    fireEvent.click(screen.getByRole("button", { name: "Show in Finder" }));
    expect(reveal).toHaveBeenCalledWith("new-rec");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "View file" }));
    });
    expect(router.state.location.pathname).toBe("/library/asset-new");
    expect(getExportSnapshot().ready).toBeNull();
    reveal.mockRestore();
  });
});
