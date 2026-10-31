import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryItem } from "@shared/types/library-item";
import { dismissToast, getToasts } from "@renderer/ui/toast-store";
import { wholeFingerprint } from "@renderer/features/video-editor/export/export-reuse";
import { seedWebcamScene } from "@renderer/features/video-editor/webcam/webcam-model";
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

describe("PreparePage (NIW2-578, layout NIW2-583)", () => {
  it("always has a destination: YouTube when the URL names none, with what changes and why", async () => {
    renderPrepare();
    expect(await screen.findByRole("heading", { name: "For YouTube", level: 1 })).toBeVisible();
    expect(screen.getByText("From your recording · 3:02 · 1916 × 1048 · 119 MB")).toBeVisible();

    expect(screen.getByText("Post · they re-compress it · send more")).toBeVisible();
    expect(screen.getByText("Send · they play it as-is · keep it light")).toBeVisible();
    expect(screen.getByText("Keep · a full-quality copy")).toBeVisible();
    const youtube = screen.getByRole("radio", { name: /^YouTube/ });
    expect(youtube).toHaveAttribute("aria-checked", "true");
    // A fixed-canvas estimate is a ceiling: the list says "up to" above the number.
    expect(within(youtube).getByText("up to")).toBeVisible();
    expect(within(youtube).getByText(/^~\d+ MB$/)).toBeVisible();
    for (const name of [
      /^Reels · TikTok · Shorts/,
      /^LinkedIn · Feeds/,
      /^GitHub · Jira · Linear/,
      /^Slack · Discord · Email/,
      /^Archive copy/,
    ]) {
      expect(screen.getByRole("radio", { name })).toHaveAttribute("aria-checked", "false");
    }

    const changes = screen.getByRole("region", { name: "What changes" });
    expect(within(changes).getByText(/^119 MB → up to ~\d+ MB$/)).toBeVisible();
    expect(within(changes).getByText("1916 × 1048 → 2560 × 1440")).toBeVisible();
    expect(within(changes).getByText("studio quality")).toBeVisible();
    expect(within(changes).getByText("3:02 · nothing cut")).toBeVisible();
    expect(within(changes).queryByText(/bitrate|fps/i)).toBeNull();

    const why = screen.getByRole("region", { name: "Why it gets bigger" });
    expect(within(why).getByText(/YouTube compresses every video again/)).toBeVisible();
    expect(screen.queryByText("Pick where it's going")).toBeNull();
  });

  it("?to=youtube: 1440p by default, and one button starts the copy in the background", async () => {
    const router = renderPrepare("/prepare/asset-1?to=youtube");
    expect(await screen.findByRole("radio", { name: /^1440p/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: /^4K/ })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("If you uploaded 1080p")).toBeVisible();
    expect(screen.getByText("With this copy · 1440p")).toBeVisible();

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

  it("composes the recording's webcam at its recorded layout and fingerprints it apart (NIW2-576)", async () => {
    const webcam = {
      startOffsetMs: 40,
      offsetQuality: "exact" as const,
      width: 1280,
      height: 720,
      fps: 30,
      recordedLayout: {
        shape: "circle" as const,
        mirrored: true,
        size: 200,
        framing: { enabled: false, zoom: 1, x: 0.5, y: 0.5 },
        position: { x: 0.85, y: 0.8 },
        sizeFraction: 0.25,
      },
    };
    // A faceless "whole" copy of the same preset exists: it is not this copy.
    const facelessCopy: LibraryItem = {
      ...preparedCopy,
      local: { ...preparedCopy.local!, export: { preset: "youtube-1440", fingerprint: "whole" } },
    };
    list(recording({ local: { ...recording().local!, webcam } }), facelessCopy);
    renderPrepare("/prepare/asset-1?to=youtube");
    fireEvent.click(
      await screen.findByRole("button", { name: /^Prepare for YouTube · up to ~\d+ MB$/ }),
    );

    const args = startArgs() as unknown as {
      scene: { webcam: { layout: { position: { x: number; y: number } } } | null };
      webcamTrack: { startOffsetMs: number } | null;
      fingerprint: string;
    };
    expect(args.scene.webcam?.layout.position).toEqual({ x: 0.85, y: 0.8 });
    expect(args.webcamTrack).toEqual(webcam);
    expect(args.fingerprint).toBe(wholeFingerprint(seedWebcamScene(webcam)));
    expect(args.fingerprint).not.toBe(wholeFingerprint(null));
  });

  it("4K is a choice inside YouTube", async () => {
    renderPrepare("/prepare/asset-1?to=youtube");
    fireEvent.click(await screen.findByRole("radio", { name: /^4K/ }));
    expect(screen.getByText("With this copy · 4K")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /^Prepare for YouTube/ }));
    expect(startArgs()).toMatchObject({ presetId: "youtube-4k" });
  });

  describe("Enter prepares", () => {
    it("from anywhere on the page, including a destination row, which it does not re-select", async () => {
      renderPrepare("/prepare/asset-1?to=github");
      const youtube = await screen.findByRole("radio", { name: /^YouTube/ });
      fireEvent.keyDown(youtube, { key: "Enter" });
      expect(startArgs()).toMatchObject({ presetId: "light" });
      expect(youtube).toHaveAttribute("aria-checked", "false");
    });

    it("from the page body", async () => {
      renderPrepare("/prepare/asset-1?to=youtube");
      await screen.findByRole("heading", { name: "For YouTube" });
      fireEvent.keyDown(document.body, { key: "Enter" });
      expect(startArgs()).toMatchObject({ presetId: "youtube-1440" });
    });

    it("not while typing in a field, not with a modifier, not on another button", async () => {
      renderPrepare("/prepare/asset-1?to=youtube");
      await screen.findByRole("heading", { name: "For YouTube" });
      const field = document.createElement("input");
      document.body.append(field);
      try {
        fireEvent.keyDown(field, { key: "Enter" });
        fireEvent.keyDown(document.body, { key: "Enter", metaKey: true });
        fireEvent.keyDown(screen.getByRole("button", { name: "Back to recording" }), {
          key: "Enter",
        });
        expect(exportController.start).not.toHaveBeenCalled();
      } finally {
        field.remove();
      }
    });
  });

  it("GitHub: the size bar says how much lighter, and the 10 MB limit only as it is", async () => {
    renderPrepare("/prepare/asset-1?to=github");
    const github = await screen.findByRole("radio", { name: /^GitHub · Jira · Linear/ });
    expect(within(github).getByText("Small copy that plays inline")).toBeVisible();
    expect(screen.getByRole("region", { name: "Why it gets lighter" })).toBeVisible();
    expect(screen.getByText(/% lighter · over GitHub's 10 MB free-plan limit$/)).toBeVisible();
    expect(screen.queryByText(/under the 10 MB limit/)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /^Prepare for GitHub · Jira · Linear · ~/ }),
    );
    expect(startArgs()).toMatchObject({ presetId: "light" });
  });

  it("a short recording fits GitHub's 10 MB, and the list and the bar say so", async () => {
    probe.mockResolvedValue({ ...PROBE, durationSec: 20 });
    renderPrepare("/prepare/asset-1?to=github");
    const github = await screen.findByRole("radio", { name: /^GitHub · Jira · Linear/ });
    expect(within(github).getByText("Under the 10 MB limit")).toBeVisible();
    expect(screen.getByText(/% lighter · under the 10 MB limit$/)).toBeVisible();
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

  it("Archive keeps the full size", async () => {
    renderPrepare("/prepare/asset-1?to=archive");
    expect(await screen.findByRole("region", { name: "Why keep one" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Prepare for Archive copy" }));
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

  it("a copy that exists reads Ready, and opening it replaces encoding it again — Enter too", async () => {
    list(recording(), preparedCopy);
    const router = renderPrepare();
    const chat = await screen.findByRole("radio", { name: /^Slack · Discord · Email/ });
    expect(within(chat).getByText("Ready")).toBeVisible();
    fireEvent.click(chat);
    expect(screen.getByRole("button", { name: "Prepare again" })).toBeVisible();
    fireEvent.keyDown(chat, { key: "Enter" });
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

  it("an unknown ?to= falls back to YouTube", async () => {
    renderPrepare("/prepare/asset-1?to=myspace");
    expect(await screen.findByRole("radio", { name: /^YouTube/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("Prepare another video opens the Library (dropping a file is NIW2-587)", async () => {
    const router = renderPrepare();
    fireEvent.click(await screen.findByRole("button", { name: /^Prepare another video/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/library"));
  });

  it("Back to recording returns to the recording", async () => {
    const router = renderPrepare();
    fireEvent.click(await screen.findByRole("button", { name: "Back to recording" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/library/asset-1"));
  });
});
