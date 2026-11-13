import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LibraryVideo } from "@renderer/features/library/types";
import { buildLineage } from "@renderer/features/library/lineage";
import type { RunningCopy } from "@renderer/features/prepare/running-copy";
import {
  __resetReadyCopiesForTests,
  getReadyCopies,
  noteFinishedCopy,
  unseenCopyIds,
} from "@renderer/features/video-editor/export/ready-copies";
import { VersionsList } from "./versions-list";

const video = (overrides: Partial<LibraryVideo>): LibraryVideo => ({
  id: "x",
  assetId: "x",
  kind: "recording",
  title: "Take",
  createdAt: Date.now() - 3_600_000,
  durationSeconds: 182,
  fileSizeBytes: 22_000_000,
  cloudSizeBytes: null,
  availability: "local",
  comparison: "same",
  editing: "exported-only",
  transfer: { state: "idle" },
  derivedFromAssetId: null,
  sourceVideoAssetId: null,
  sourceTimeSeconds: null,
  editSavedAt: null,
  editExportedSavedAt: null,
  ...overrides,
});

const master = video({ id: "master", assetId: "master", title: "My master" });
const yt = video({
  id: "yt",
  assetId: "yt",
  title: "yt file",
  derivedFromAssetId: "master",
  export: { preset: "youtube-1440", fingerprint: "whole" },
});
const gh = video({
  id: "gh",
  assetId: "gh",
  title: "gh file",
  derivedFromAssetId: "master",
  export: { preset: "light", fingerprint: "whole" },
});

const probe = {
  width: 1920,
  height: 1080,
  durationSec: 182,
  fps: 30,
  hasAudio: true,
  sampleRate: 48000,
};

function renderList(
  item: LibraryVideo,
  all: LibraryVideo[],
  running: RunningCopy | null = null,
  canExport = false,
) {
  render(
    <MemoryRouter>
      <VersionsList
        item={item}
        lineage={buildLineage(all)}
        running={running}
        probe={probe}
        canExport={canExport}
        now={() => 100_000}
      />
    </MemoryRouter>,
  );
  return screen.getByRole("region", { name: "Versions" });
}

afterEach(() => {
  cleanup();
  __resetReadyCopiesForTests();
});

describe("VersionsList", () => {
  it("lists the master and its copies, with Viewing on the master", () => {
    const region = renderList(master, [master, yt, gh]);
    const rows = within(region).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText("Viewing")).toBeTruthy();
    expect(within(rows[0]!).getByText("Original")).toBeTruthy();
    expect(within(rows[0]!).getByRole("img", { name: "Never changes" })).toBeTruthy();
    expect(within(rows[1]!).getByText("YouTube 1440p")).toBeTruthy();
    expect(within(rows[1]!).getByRole("link").getAttribute("href")).toBe("/library/yt");
    expect(rows[1]!.textContent).toContain("Exported copy");
    expect(rows[2]!.textContent).toContain("Exported copy");
    expect(within(region).getByText("3")).toBeTruthy();
  });

  it("shows the edited project row when the original has an edit session", () => {
    const edited = { ...master, editSavedAt: Date.now() - 60_000 };
    const region = renderList(edited, [edited, yt]);
    expect(within(region).getByText("Edited project")).toBeTruthy();
  });

  it("on a copy, shows the source as a link and Viewing on the copy", () => {
    const region = renderList(yt, [master, yt, gh]);
    const source = within(region).getByRole("link", { name: /My master/ });
    expect(source.getAttribute("href")).toBe("/library/master");
    const viewing = within(region).getByText("Viewing").closest("li")!;
    expect(within(viewing).getByText("YouTube 1440p")).toBeTruthy();
    expect(within(region).queryByRole("link", { name: /YouTube/ })).toBeNull();
  });

  it("shows the running copy with its progress", () => {
    const region = renderList(master, [master], {
      presetId: "light",
      wholeRecording: true,
      fraction: 0.4,
      attemptStartedAt: null,
    });
    expect(within(region).getByText("GitHub · Jira · Linear")).toBeTruthy();
    expect(within(region).getByText("Exporting · 40%")).toBeTruthy();
    expect(within(region).queryByText(/Pick a place/)).toBeNull();
  });

  it("says the source was deleted when a copy lost it", () => {
    const region = renderList(yt, [yt]);
    expect(within(region).getByText("Source recording was deleted")).toBeTruthy();
    expect(within(region).getByText("Viewing")).toBeTruthy();
  });

  it("shows each row's name and its kind with facts on one muted line", () => {
    const region = renderList(master, [master, yt]);
    const rows = within(region).getAllByRole("listitem");
    expect(within(rows[0]!).getByText("My master")).toBeTruthy();
    expect(rows[0]!.textContent).toMatch(/Original · .*3:02.* · /);
    expect(within(rows[0]!).getByText("Viewing")).toBeTruthy();
    expect(within(rows[1]!).getByText("YouTube 1440p")).toBeTruthy();
    expect(rows[1]!.textContent).toMatch(/Exported copy · .*3:02/);
  });

  it("suggests where it is going when a local recording has no copies", () => {
    const region = renderList(master, [master], null, true);
    expect(within(region).getByText(/Pick a place/)).toBeTruthy();
  });

  it("does not point to a tab the item lacks", () => {
    const region = renderList(master, [master], null, false);
    expect(within(region).queryByText(/Pick a place/)).toBeNull();
    expect(within(region).getByText("No copies yet.")).toBeTruthy();
  });

  it("walks a copy of a copy up to the root original, and shows the same family from any member", () => {
    const a = video({ id: "a", assetId: "a", title: "Root A", createdAt: 1000 });
    const b = video({
      id: "b",
      assetId: "b",
      title: "Copy B",
      derivedFromAssetId: "a",
      createdAt: 2000,
    });
    const c = video({
      id: "c",
      assetId: "c",
      title: "Copy C",
      derivedFromAssetId: "b",
      createdAt: 3000,
    });
    const all = [a, b, c];
    for (const opened of [c, b, a]) {
      const region = renderList(opened, all);
      const rows = within(region).getAllByRole("listitem");
      expect(rows).toHaveLength(3);
      expect(within(rows[0]!).getByText("Original")).toBeTruthy();
      expect(within(rows[0]!).getByText("Root A")).toBeTruthy();
      expect(rows[1]!.textContent).toContain("Copy B");
      expect(rows[2]!.textContent).toContain("Copy C");
      cleanup();
    }
  });

  it("a broken link higher up shows the source as deleted from every member", () => {
    const b = video({ id: "b", assetId: "b", title: "Copy B", derivedFromAssetId: "gone" });
    const c = video({ id: "c", assetId: "c", title: "Copy C", derivedFromAssetId: "b" });
    for (const opened of [c, b]) {
      const region = renderList(opened, [b, c]);
      expect(within(region).queryByText("Original")).toBeNull();
      // The same family, in the same order, whichever member is open. Only the Viewing row
      // moves, so rows are compared by what they name, not by their state.
      const rows = within(region).getAllByRole("listitem");
      expect(rows).toHaveLength(3);
      expect(within(rows[0]!).getByText("Source recording was deleted")).toBeTruthy();
      expect(within(rows[1]!).getByText("Copy B")).toBeTruthy();
      expect(within(rows[2]!).getByText("Copy C")).toBeTruthy();
      cleanup();
    }
  });

  it("computes copy dimensions from the master's probe only, not from a copy's", () => {
    const dims = /\d+ × \d+/;
    const fromCopy = renderList(gh, [master, yt, gh]);
    const ytRow = within(fromCopy).getByText("YouTube 1440p").closest("li")!;
    expect(ytRow.textContent).not.toMatch(dims);
    cleanup();
    const fromMaster = renderList(master, [master, yt, gh]);
    const ytRow2 = within(fromMaster).getByText("YouTube 1440p").closest("li")!;
    expect(ytRow2.textContent).toMatch(dims);
  });

  it("does not loop on a cyclic lineage", () => {
    const x = video({ id: "x", assetId: "x", title: "X", derivedFromAssetId: "y" });
    const y = video({ id: "y", assetId: "y", title: "Y", derivedFromAssetId: "x" });
    const region = renderList(x, [x, y]);
    expect(within(region).getAllByRole("listitem").length).toBeGreaterThan(0);
  });

  it("shows the time left on a running export", () => {
    // 38% after 70 s: about 114 s left, rounded to 2 min.
    const region = renderList(master, [master], {
      presetId: "youtube-4k",
      wholeRecording: true,
      fraction: 0.38,
      attemptStartedAt: 30_000,
    });
    expect(within(region).getByText("Exporting · 38% · 2 min left")).toBeVisible();
  });

  it("dragging a copy hands the real file to main and marks it as seen", () => {
    const startFileDrag = vi.fn();
    window.electronAPI = { ...window.electronAPI, startFileDrag } as typeof window.electronAPI;
    noteFinishedCopy("yt");
    expect(unseenCopyIds(getReadyCopies()).has("yt")).toBe(true);
    const region = renderList(master, [master, yt]);
    const drag = within(region).getByRole("button", { name: /^Drag YouTube 1440p/ });
    expect(drag).toHaveAttribute("draggable", "true");
    fireEvent.dragStart(drag);
    expect(startFileDrag).toHaveBeenCalledWith("yt", "yt file");
    expect(unseenCopyIds(getReadyCopies()).has("yt")).toBe(false);
  });

  it("names an Email copy by its stored destination, not by its Balanced preset", () => {
    const email = video({
      id: "em",
      assetId: "em",
      title: "em file",
      derivedFromAssetId: "master",
      export: { preset: "balanced", fingerprint: "whole", destination: "email" },
    });
    const region = renderList(master, [master, email]);
    expect(within(region).getByText("Email · anywhere")).toBeVisible();
    expect(within(region).queryByText(/Slack/)).toBeNull();
  });

  it("a GIF or an editor export falls back to its own title", () => {
    const gif = video({
      id: "g",
      assetId: "g",
      kind: "gif",
      title: "Take (GIF)",
      derivedFromAssetId: "master",
      export: null,
      gif: { width: 800, height: 450, fps: 12 },
    });
    const edited = video({
      id: "ed",
      assetId: "ed",
      title: "Take (edited)",
      derivedFromAssetId: "master",
      export: { preset: "balanced", fingerprint: "abc" },
    });
    const region = renderList(master, [master, gif, edited]);
    expect(within(region).getByText("Take (GIF)")).toBeVisible();
    expect(within(region).getByText(/800 × 450/)).toBeVisible();
    expect(within(region).getByText("Take (edited)")).toBeVisible();
    expect(within(region).queryByText(/Slack/)).toBeNull();
  });

  it("a copy with no local file has no drag handle", () => {
    const cloudOnly = video({ id: null, assetId: "co", derivedFromAssetId: "master" } as never);
    const region = renderList(master, [master, cloudOnly]);
    expect(within(region).queryByRole("button", { name: /^Drag/ })).toBeNull();
  });
});
