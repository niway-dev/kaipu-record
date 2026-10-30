import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryItem } from "@shared/types/library-item";
import { dismissToast, getToasts } from "@renderer/ui/toast-store";
import { PreparePage } from "./prepare-page";

const probe = vi.hoisted(() => vi.fn());
vi.mock("@renderer/features/video-editor/export/probe-source", () => ({ probeSource: probe }));

// The worker pipeline itself is covered by use-video-export.test.ts; here only what Prepare
// hands it matters.
const exportController = vi.hoisted(() => ({
  status: "idle" as "idle" | "exporting" | "error",
  fraction: 0,
  error: null as string | null,
  start: vi.fn(async () => true),
  cancel: vi.fn(),
}));
vi.mock("@renderer/features/video-editor/export/use-video-export", () => ({
  useVideoExport: () => exportController,
}));

const busy = vi.hoisted(() => vi.fn(() => false));
vi.mock("@renderer/features/video-editor/export/export-runner", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isVideoExportBusy: busy,
}));

/** 3:02 of a 1916×1048 screen at 48 fps, with sound: 1440p is the YouTube default. */
const PROBE = {
  width: 1916,
  height: 1048,
  durationSec: 182,
  fps: 48,
  hasAudio: true,
  sampleRate: 48000,
};

const recording = (overrides: Partial<LibraryItem> = {}): LibraryItem => ({
  assetId: "asset-1",
  kind: "recording",
  title: "Demo",
  createdAt: 1000,
  durationSeconds: 182,
  derivedFromAssetId: null,
  editSavedAt: null,
  editExportedSavedAt: null,
  local: {
    id: "rec-1",
    assetId: "asset-1",
    kind: "recording",
    title: "Demo",
    filePath: "/vault/rec-1.mp4",
    createdAt: 1000,
    sizeBytes: 119_000_000,
    durationSeconds: 182,
    thumbnailUrl: null,
    derivedFromAssetId: null,
    contentSha256: "abc",
  },
  cloud: null,
  availability: "local",
  transfer: { state: "idle" },
  comparison: "same",
  editing: "project-available",
  sharing: "private",
  capture: null,
  ...overrides,
});

/** A Slack · Discord copy (Balanced) already made from the whole recording. */
const preparedCopy: LibraryItem = recording({
  assetId: "asset-2",
  title: "Demo (for sharing)",
  createdAt: 2000,
  derivedFromAssetId: "asset-1",
  local: {
    ...recording().local!,
    id: "rec-2",
    assetId: "asset-2",
    title: "Demo (for sharing)",
    sizeBytes: 22_000_000,
    derivedFromAssetId: "asset-1",
    export: { preset: "balanced", fingerprint: "whole#q30-24fps-kfi10" },
  },
});

function list(...items: LibraryItem[]): void {
  window.electronAPI.listLibraryItems = vi.fn(async () => ({
    items,
    vaultError: null,
    catalogVerifiedAt: null,
  }));
}

function renderPrepare(path = "/prepare/asset-1") {
  const router = createMemoryRouter(
    [
      { path: "/prepare/:assetId", element: <PreparePage /> },
      { path: "/library/:assetId", element: <div>recording-page</div> },
      { path: "/library", element: <div>library-page</div> },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

type StartArgs = Record<string, unknown> & { scene: { items: unknown[]; overlays: unknown[] } };
const startArgs = (): StartArgs =>
  (exportController.start.mock.calls[0] as unknown as [StartArgs])[0];

beforeEach(() => {
  probe.mockReset();
  probe.mockResolvedValue(PROBE);
  exportController.start.mockClear();
  busy.mockReturnValue(false);
  window.electronAPI.onLibraryChanged = () => () => {};
  list(recording());
});

afterEach(() => {
  for (const t of getToasts()) dismissToast(t.id);
});

describe("PreparePage (NIW2-578)", () => {
  it("shows the original, the destinations grouped by who compresses last, and asks to pick one", async () => {
    renderPrepare();
    expect(await screen.findByRole("heading", { name: "Where is it going?" })).toBeVisible();

    const original = screen.getByRole("complementary", { name: "Original" });
    expect(within(original).getByText("Demo")).toBeVisible();
    expect(within(original).getByText(/3:02 · 1916 × 1048/)).toBeVisible();
    expect(
      within(original).getByText(
        "Copies are made from this file. It is never changed or replaced.",
      ),
    ).toBeVisible();

    expect(screen.getByText("They re-compress it · send more")).toBeVisible();
    expect(screen.getByText("They play it as-is · keep it light")).toBeVisible();
    expect(screen.getByText("Keep")).toBeVisible();
    for (const name of [
      /^YouTube/,
      /^Reels · TikTok · Shorts/,
      /^LinkedIn · Feeds/,
      /^GitHub · Jira · Linear/,
      /^Slack · Discord · Email/,
      /^Archive copy/,
    ]) {
      expect(screen.getByRole("radio", { name })).toHaveAttribute("aria-checked", "false");
    }
    expect(screen.getByText("Pick where it's going")).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Prepare for/ })).toBeNull();
  });

  it("?to=youtube preselects YouTube: bigger on purpose, 1440p, and one button to start it", async () => {
    const router = renderPrepare("/prepare/asset-1?to=youtube");
    const youtube = await screen.findByRole("radio", { name: /^YouTube/ });
    expect(youtube).toHaveAttribute("aria-checked", "true");

    expect(screen.getByText("Bigger on purpose")).toBeVisible();
    expect(screen.getByText(/YouTube compresses every video again/)).toBeVisible();
    expect(screen.getByRole("radio", { name: /^1440p/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /^4K/ })).toHaveAttribute("aria-checked", "false");

    fireEvent.click(screen.getByRole("button", { name: /^Prepare for YouTube · up to ~\d+ MB$/ }));

    // The same pipeline as the editor, with a trivial plan: one clip over the whole file.
    expect(exportController.start).toHaveBeenCalledOnce();
    expect(startArgs()).toMatchObject({
      sourceId: "rec-1",
      title: "Demo",
      derivedFromAssetId: "asset-1",
      sourceSizeBytes: 119_000_000,
      videoWidth: 1916,
      videoHeight: 1048,
      cameraPath: null,
      presetId: "youtube-1440",
      framing: null,
      fingerprint: "whole",
    });
    expect(startArgs().scene.items).toEqual([
      expect.objectContaining({ kind: "clip", sourceStart: 0, sourceEnd: 182 }),
    ]);
    expect(startArgs().scene.overlays).toEqual([]);
    // It runs in the background: back to the recording, where the cards show progress.
    await waitFor(() => expect(router.state.location.pathname).toBe("/library/asset-1"));
  });

  it("4K is a choice inside YouTube", async () => {
    renderPrepare("/prepare/asset-1?to=youtube");
    fireEvent.click(await screen.findByRole("radio", { name: /^4K/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Prepare for YouTube/ }));
    expect(startArgs()).toMatchObject({ presetId: "youtube-4k" });
  });

  it("GitHub promises the 10 MB limit only when the copy fits it", async () => {
    renderPrepare("/prepare/asset-1?to=github");
    const github = await screen.findByRole("radio", { name: /^GitHub · Jira · Linear/ });
    expect(within(github).getByText("Small copy that plays inline")).toBeVisible();
    expect(screen.getByText(/% lighter$/)).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: /^Prepare for GitHub · Jira · Linear · ~/ }),
    );
    expect(startArgs()).toMatchObject({ presetId: "light" });
  });

  it("a short recording fits GitHub's 10 MB, and the list says so", async () => {
    probe.mockResolvedValue({ ...PROBE, durationSec: 20 });
    renderPrepare();
    const github = await screen.findByRole("radio", { name: /^GitHub · Jira · Linear/ });
    expect(within(github).getByText("Under the 10 MB limit")).toBeVisible();
  });

  it("Reels offers Fill or Fit, and the copy uses the one picked", async () => {
    renderPrepare("/prepare/asset-1?to=vertical");
    const fit = await screen.findByRole("radio", { name: "Fit · show all" });
    expect(screen.getByRole("radio", { name: "Fill · crop the sides" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(fit);
    fireEvent.click(screen.getByRole("button", { name: /^Prepare for Reels/ }));
    expect(startArgs()).toMatchObject({ presetId: "vertical", framing: "fit" });
  });

  it("'What changes in the copy' unfolds into picture, smoothness and sound, in words", async () => {
    renderPrepare("/prepare/asset-1?to=youtube");
    const toggle = await screen.findByRole("button", { name: "What changes in the copy" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("2560 × 1440")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("2560 × 1440")).toBeVisible();
    expect(screen.getByText(/scaled up cleanly/)).toBeVisible();
    expect(screen.getByText("same as the recording")).toBeVisible();
    expect(screen.getByText("studio quality")).toBeVisible();
    expect(screen.queryByText(/bitrate|fps/i)).toBeNull();
  });

  it("Archive keeps the full size", async () => {
    renderPrepare("/prepare/asset-1?to=archive");
    fireEvent.click(await screen.findByRole("button", { name: "Prepare for Archive copy" }));
    expect(startArgs()).toMatchObject({ presetId: "maximum" });
  });

  it("one export at a time: while one runs, Prepare says so and stays", async () => {
    busy.mockReturnValue(true);
    const router = renderPrepare("/prepare/asset-1?to=youtube");
    fireEvent.click(await screen.findByRole("button", { name: /^Prepare for YouTube/ }));
    expect(getToasts()).toContainEqual(
      expect.objectContaining({ message: expect.stringMatching(/^Already exporting/) }),
    );
    expect(exportController.start).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe("/prepare/asset-1");
  });

  it("an unreadable file: says so and goes back to the recording", async () => {
    probe.mockResolvedValue(null);
    const router = renderPrepare("/prepare/asset-1?to=youtube");
    await waitFor(() => expect(router.state.location.pathname).toBe("/library/asset-1"));
    expect(getToasts()).toContainEqual(
      expect.objectContaining({ message: "Couldn't read this recording to prepare a file." }),
    );
    expect(exportController.start).not.toHaveBeenCalled();
  });

  it("screenshots are not preparable", async () => {
    list(recording({ kind: "screenshot", local: { ...recording().local!, kind: "screenshot" } }));
    renderPrepare();
    expect(await screen.findByText("Only recordings can be prepared")).toBeVisible();
    expect(probe).not.toHaveBeenCalled();
  });

  it("lists what is already prepared, and opens that copy instead of encoding it again", async () => {
    list(recording(), preparedCopy);
    const router = renderPrepare();
    const already = await screen.findByRole("region", { name: "Already prepared" });
    expect(within(already).getByText("Slack · Discord · Email")).toBeVisible();
    expect(within(already).getByText(/^22 MB · /)).toBeVisible();

    const chat = screen.getByRole("radio", { name: /^Slack · Discord · Email/ });
    expect(within(chat).getByText("Ready")).toBeVisible();
    fireEvent.click(chat);
    fireEvent.click(screen.getByRole("button", { name: "Open the copy you have" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/library/asset-2"));
    expect(exportController.start).not.toHaveBeenCalled();
  });

  it("warns that unexported edits are not in the original", async () => {
    list(recording({ editSavedAt: 5 }));
    renderPrepare();
    expect(
      await screen.findByText(
        "Your edits are not in this file. To send them, use Export in the editor.",
      ),
    ).toBeVisible();
  });

  it("an unknown ?to= preselects nothing", async () => {
    renderPrepare("/prepare/asset-1?to=myspace");
    await act(async () => {});
    expect(await screen.findByText("Pick where it's going")).toBeVisible();
  });
});
