import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
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

function renderPanel(
  copies: LibraryVideo[],
  running: RunningCopy | null = null,
  now = () => 100_000,
) {
  render(
    <MemoryRouter>
      <MasterCopiesPanel copies={copies} running={running} now={now} />
    </MemoryRouter>,
  );
  return screen.getByRole("region", { name: "Copies from this master" });
}

describe("MasterCopiesPanel (NIW2-585)", () => {
  it("says there are no copies yet in one muted line", () => {
    const panel = renderPanel([]);
    expect(
      within(panel).getByText("No copies yet. Each one you make shows up here."),
    ).toBeVisible();
    expect(within(panel).queryByRole("list")).toBeNull();
  });

  it("names a destination copy by its destination and links a ready one to its page", () => {
    const panel = renderPanel([
      copy({ assetId: "yt", export: { preset: "youtube-1440", fingerprint: "whole" } }),
      copy({
        assetId: "gh",
        fileSizeBytes: 9_000_000,
        export: { preset: "light", fingerprint: "whole" },
      }),
    ]);
    const youtube = within(panel).getByRole("link", { name: /^YouTube 1440p · 22 MB/ });
    expect(youtube).toHaveAttribute("href", "/library/yt");
    expect(within(youtube).getByText("Ready")).toBeVisible();
    expect(
      within(panel).getByRole("link", { name: /^GitHub · Jira · Linear · 9.0 MB/ }),
    ).toHaveAttribute("href", "/library/gh");
  });

  it("an editor export or a GIF goes by its own title: it was not made for a destination", () => {
    const panel = renderPanel([
      copy({
        assetId: "ed",
        title: "Take (edited)",
        export: { preset: "balanced", fingerprint: "abc" },
      }),
      copy({ assetId: "gif", kind: "gif", title: "Take (GIF)", export: null }),
    ]);
    expect(within(panel).getByRole("link", { name: /^Take \(edited\)/ })).toBeVisible();
    expect(within(panel).getByRole("link", { name: /^Take \(GIF\)/ })).toBeVisible();
    expect(within(panel).queryByText(/Slack/)).toBeNull();
  });

  it("shows the running copy with its progress and time left, above the ready ones", () => {
    // 38% after 70 s: about 114 s left, rounded to 2 min.
    const panel = renderPanel(
      [copy({ assetId: "chat" })],
      { presetId: "youtube-4k", wholeRecording: true, fraction: 0.38, attemptStartedAt: 30_000 },
      () => 100_000,
    );
    const rows = within(panel).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("YouTube 4K");
    expect(within(rows[0]!).getByText("38% · 2 min")).toBeVisible();
    expect(within(rows[0]!).queryByRole("link")).toBeNull();
    expect(rows[1]).toHaveTextContent("Slack · Discord · Email");
  });

  it("shows only the percent until there is enough progress for a time estimate", () => {
    const panel = renderPanel([], {
      presetId: "light",
      wholeRecording: true,
      fraction: 0.01,
      attemptStartedAt: 99_000,
    });
    expect(within(panel).getByText("1%")).toBeVisible();
    expect(within(panel).queryByText(/No copies yet/)).toBeNull();
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
