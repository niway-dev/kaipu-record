import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { LibraryVideo } from "@renderer/features/library/types";
import type { ExportJobInfo } from "@renderer/features/video-editor/export/export-runner";
import { MasterCopiesPanel, type RunningCopy, runningCopyOf } from "./master-copies-panel";

const copy = (overrides: Partial<LibraryVideo>): LibraryVideo => ({
  id: "copy",
  assetId: "copy",
  kind: "recording",
  title: "Take (for sharing)",
  createdAt: 2_000,
  durationSeconds: 182,
  fileSizeBytes: 22_000_000,
  cloudSizeBytes: null,
  availability: "local",
  comparison: "same",
  editing: "exported-only",
  transfer: { state: "idle" },
  derivedFromAssetId: "master",
  editSavedAt: null,
  editExportedSavedAt: null,
  export: { preset: "balanced", fingerprint: "whole" },
  ...overrides,
});

const probe = {
  width: 1920,
  height: 1080,
  durationSec: 182,
  fps: 30,
  hasAudio: true,
  sampleRate: 48000,
};

function renderPanel(
  copies: LibraryVideo[],
  running: RunningCopy | null = null,
  { now = () => 100_000, onOpenExport }: { now?: () => number; onOpenExport?: () => void } = {},
) {
  render(
    <MemoryRouter>
      <MasterCopiesPanel
        copies={copies}
        running={running}
        probe={probe}
        onOpenExport={onOpenExport}
        now={now}
      />
    </MemoryRouter>,
  );
  return screen.getByRole("region", { name: "Copies from this original" });
}

describe("MasterCopiesPanel (Export v3, NIW2-585)", () => {
  it("names a destination copy by its destination, with its picture and file size", () => {
    const panel = renderPanel([
      copy({ assetId: "yt", export: { preset: "youtube-1440", fingerprint: "whole" } }),
      copy({
        assetId: "gh",
        fileSizeBytes: 9_000_000,
        export: { preset: "light", fingerprint: "whole" },
      }),
    ]);
    const youtube = within(panel).getByRole("link", { name: /^YouTube 1440p/ });
    expect(youtube).toHaveAttribute("href", "/library/yt");
    expect(within(youtube).getByText("2560 × 1440 · 22 MB")).toBeVisible();
    expect(within(youtube).getByText("Ready")).toBeVisible();
    expect(within(panel).getByRole("link", { name: /^GitHub · Jira · Linear/ })).toHaveAttribute(
      "href",
      "/library/gh",
    );
    expect(within(panel).getByText("9.0 MB", { exact: false })).toBeVisible();
  });

  it("reads the destination through the encode revision the sidecar stores", () => {
    // What a real YouTube copy records: the content fingerprint plus "#<revision>".
    const panel = renderPanel([
      copy({
        assetId: "yt",
        export: { preset: "youtube-1440", fingerprint: "whole#2560x1440-v1" },
      }),
    ]);
    expect(within(panel).getByRole("link", { name: /^YouTube 1440p/ })).toBeVisible();
  });

  it("an editor export or a GIF goes by its own title: it was not made for a destination", () => {
    const panel = renderPanel([
      copy({
        assetId: "ed",
        title: "Take (edited)",
        export: { preset: "balanced", fingerprint: "abc" },
      }),
      copy({
        assetId: "gif",
        kind: "gif",
        title: "Take (GIF)",
        export: null,
        gif: { width: 800, height: 450, fps: 12 },
      }),
    ]);
    expect(within(panel).getByRole("link", { name: /^Take \(edited\)/ })).toBeVisible();
    const gif = within(panel).getByRole("link", { name: /^Take \(GIF\)/ });
    expect(within(gif).getByText("800 × 450 · 22 MB")).toBeVisible();
    expect(within(panel).queryByText(/Slack/)).toBeNull();
  });

  it("Drag hands the real file to main for a native drag, under the copy's title", () => {
    const startFileDrag = vi.fn();
    window.electronAPI.startFileDrag = startFileDrag;
    const panel = renderPanel([copy({ id: "copy-file", title: "Take (for sharing)" })]);
    const drag = within(panel).getByRole("button", {
      name: "Drag Slack · Discord · Email into another app",
    });
    expect(drag).toHaveAttribute("draggable", "true");
    fireEvent.dragStart(drag);
    expect(startFileDrag).toHaveBeenCalledWith("copy-file", "Take (for sharing)");
  });

  it("a copy with no local file has nothing to drag", () => {
    const panel = renderPanel([copy({ id: null })]);
    expect(within(panel).queryByRole("button", { name: /^Drag/ })).toBeNull();
  });

  it("shows the running copy with its progress and time left, first", () => {
    // 38% after 70 s: about 114 s left, rounded to 2 min.
    const panel = renderPanel(
      [copy({ assetId: "chat" })],
      { presetId: "youtube-4k", wholeRecording: true, fraction: 0.38, attemptStartedAt: 30_000 },
      { now: () => 100_000 },
    );
    const rows = within(panel).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("YouTube 4K");
    expect(within(rows[0]!).getByText("Exporting · 38% · 2 min left")).toBeVisible();
    expect(within(rows[0]!).queryByRole("link")).toBeNull();
    expect(within(rows[0]!).queryByRole("button", { name: /^Drag/ })).toBeNull();
    expect(rows[1]).toHaveTextContent("Slack · Discord · Email");
  });

  it("shows only the percent until there is enough progress for a time estimate", () => {
    const panel = renderPanel([], {
      presetId: "light",
      wholeRecording: true,
      fraction: 0.01,
      attemptStartedAt: 99_000,
    });
    expect(within(panel).getByText("Exporting · 1%")).toBeVisible();
  });

  it("Open in Export → shows only where there is an export screen to open", () => {
    const onOpenExport = vi.fn();
    const panel = renderPanel([copy({})], null, { onOpenExport });
    fireEvent.click(within(panel).getByRole("button", { name: "Open in Export →" }));
    expect(onOpenExport).toHaveBeenCalledOnce();
  });
});

describe("runningCopyOf", () => {
  const job: ExportJobInfo = {
    presetId: "light",
    sourceTitle: "Take",
    sourceAssetId: "master",
    sourceSizeBytes: 119_000_000,
    estimateBytes: 9_000_000,
    width: 1280,
    height: 720,
    wholeRecording: true,
  };

  it("is the runner's export while it makes a copy of this recording", () => {
    expect(
      runningCopyOf({ status: "exporting", job, fraction: 0.5, attemptStartedAt: 10 }, "master"),
    ).toEqual({ presetId: "light", wholeRecording: true, fraction: 0.5, attemptStartedAt: 10 });
  });

  it("is null for another recording's export, or once it is not encoding", () => {
    const base = { job, fraction: 0.5, attemptStartedAt: 10 };
    expect(runningCopyOf({ ...base, status: "exporting" }, "other")).toBeNull();
    expect(runningCopyOf({ ...base, status: "error" }, "master")).toBeNull();
    expect(runningCopyOf({ ...base, status: "idle", job: null }, "master")).toBeNull();
  });

  it("an editor export (or a job without the flag) is not a destination copy", () => {
    const { wholeRecording: _omit, ...older } = job;
    expect(
      runningCopyOf(
        { status: "exporting", job: older, fraction: 0, attemptStartedAt: null },
        "master",
      )?.wholeRecording,
    ).toBe(false);
  });
});
