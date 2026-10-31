import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryItem } from "@shared/types/library-item";
import { dismissToast, getToasts } from "@renderer/ui/toast-store";
import { ExportPage, LegacyPrepareRedirect } from "./export-page";

const probe = vi.hoisted(() => vi.fn());
vi.mock("@renderer/features/video-editor/export/probe-source", () => ({ probeSource: probe }));

// The worker pipeline itself is covered by use-video-export.test.ts; here only what Export
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

function renderExport(path = "/export/asset-1") {
  const router = createMemoryRouter(
    [
      { path: "/export/:assetId", element: <ExportPage /> },
      { path: "/export", element: <ExportPage /> },
      { path: "/prepare/:assetId", element: <LegacyPrepareRedirect /> },
      { path: "/prepare", element: <LegacyPrepareRedirect /> },
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

const card = (name: RegExp): HTMLElement => screen.getByRole("radio", { name });

describe("ExportPage", () => {
  it("keeps the video in view: thumbnail, title, ORIGINAL and its real facts", async () => {
    renderExport();
    expect(await screen.findByRole("heading", { name: "Demo", level: 1 })).toBeVisible();
    expect(screen.getByText("Original")).toBeVisible();
    expect(
      screen.getByText(
        "3:02 · 1916 × 1048 · 119 MB · copies are made from this file; it never changes",
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /Change video/ })).toBeVisible();
  });

  it("with nothing picked: the question, and seven cards in one row, none selected", async () => {
    renderExport();
    expect(
      await screen.findByRole("heading", { name: "Where is it going?", level: 2 }),
    ).toBeVisible();
    const row = screen.getByRole("radiogroup", { name: "Where is it going?" });
    const cards = within(row).getAllByRole("radio");
    expect(cards.map((c) => c.textContent?.replace(/~.*|Full size|Ready/, ""))).toEqual([
      "YouTube",
      "TikTok · Reels",
      "LinkedIn · Feeds",
      "GitHub · Jira",
      "Slack · Discord",
      "Email · anywhere",
      "Keep full quality",
    ]);
    for (const c of cards) expect(c).toHaveAttribute("aria-checked", "false");
    expect(within(card(/^YouTube/)).getByText(/^~\d+ MB$/)).toBeVisible();
    expect(within(card(/^Keep full quality/)).getByText("Full size")).toBeVisible();
    // Enter with nothing picked does nothing.
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(exportController.start).not.toHaveBeenCalled();
  });

  it("?to=youtube: 1440p by default with real estimates, and one button starts the copy", async () => {
    const router = renderExport("/export/asset-1?to=youtube");
    expect(await screen.findByRole("heading", { name: "For YouTube" })).toBeVisible();
    expect(screen.getByText(/^They compress every upload again/)).toBeVisible();
    expect(screen.getByRole("radio", { name: /^1440p · up to ~\d+ MB$/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: /^4K · up to ~\d+ MB$/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(
      screen.getByText("Your recording is 1916 × 1048. We scale it up cleanly."),
    ).toBeVisible();
    expect(screen.getByText("Uploaded at 1080p")).toBeVisible();
    expect(screen.getByText("Uploaded at 1440p")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /^Export for YouTube · up to ~\d+ MB$/ }));

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
      destination: "youtube",
    });
    expect(startArgs().scene.items).toEqual([
      expect.objectContaining({ kind: "clip", sourceStart: 0, sourceEnd: 182 }),
    ]);
    expect(startArgs().scene.overlays).toEqual([]);
    // It runs in the background: the screen stays, ready for another destination.
    expect(router.state.location.pathname).toBe("/export/asset-1");
    expect(
      screen.getByText("Runs in the background — we'll tell you when it's ready."),
    ).toBeVisible();
  });

  it("4K is a choice inside YouTube", async () => {
    renderExport("/export/asset-1?to=youtube");
    fireEvent.click(await screen.findByRole("radio", { name: /^4K/ }));
    expect(screen.getByText("Uploaded at 4K")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /^Export for YouTube/ }));
    expect(startArgs()).toMatchObject({ presetId: "youtube-4k" });
  });

  it("TikTok · Reels: its one upload size, Fill or Fit, and the copy uses the one picked", async () => {
    renderExport("/export/asset-1?to=vertical");
    expect(await screen.findByText(/^1080 × 1920 · up to ~\d+ MB$/)).toBeVisible();
    expect(screen.getByRole("radio", { name: "Fill · crop the sides" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(screen.getByRole("radio", { name: "Fit · show all" }));
    fireEvent.click(screen.getByRole("button", { name: /^Export for TikTok · Reels/ }));
    expect(startArgs()).toMatchObject({ presetId: "vertical", framing: "fit" });
  });

  it("GitHub: the size bar is drawn against the 10 MB free limit and says when it is over", async () => {
    renderExport("/export/asset-1?to=github");
    expect(await screen.findByRole("heading", { name: "For GitHub · Jira" })).toBeVisible();
    expect(screen.getByText(/^What you send is what they watch/)).toBeVisible();
    expect(screen.getByText("Original 119 MB")).toBeVisible();
    expect(screen.getByText(/over GitHub's 10 MB free-plan limit$/)).toBeVisible();
    // The verdict is read out: no image role swallows the bar's text.
    expect(
      screen.getByText(/over GitHub's 10 MB free-plan limit$/).closest("[role='img']"),
    ).toBeNull();
    expect(screen.queryByRole("img", { name: /Your recording/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Export for GitHub · Jira · ~/ }));
    expect(startArgs()).toMatchObject({ presetId: "light", destination: "github" });
  });

  it("a short recording fits GitHub's 10 MB, and the bar says so", async () => {
    probe.mockResolvedValue({ ...PROBE, durationSec: 20 });
    renderExport("/export/asset-1?to=github");
    expect(await screen.findByText(/fits the 10 MB limit$/)).toBeVisible();
  });

  it("Email is its own card over the chat preset, and the cards say where it went", async () => {
    renderExport("/export/asset-1?to=email");
    expect(await screen.findByText(/% lighter$/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /^Export for Email · anywhere/ }));
    expect(startArgs()).toMatchObject({ presetId: "balanced", destination: "email" });
  });

  it("Keep full quality keeps the full size", async () => {
    renderExport("/export/asset-1?to=archive");
    fireEvent.click(await screen.findByRole("button", { name: "Export for Keep full quality" }));
    expect(startArgs()).toMatchObject({ presetId: "maximum" });
  });

  describe("keyboard", () => {
    it("the arrows move the selection along the row, and stop at its ends", async () => {
      renderExport();
      await screen.findByRole("heading", { name: "Where is it going?" });
      fireEvent.keyDown(document.body, { key: "ArrowRight" });
      expect(card(/^YouTube/)).toHaveAttribute("aria-checked", "true");
      fireEvent.keyDown(document.body, { key: "ArrowRight" });
      expect(card(/^TikTok/)).toHaveAttribute("aria-checked", "true");
      fireEvent.keyDown(document.body, { key: "ArrowLeft" });
      fireEvent.keyDown(document.body, { key: "ArrowLeft" });
      expect(card(/^YouTube/)).toHaveAttribute("aria-checked", "true");
      expect(screen.getByRole("heading", { name: "For YouTube" })).toBeVisible();
    });

    it("inside YouTube's 1440p / 4K choice the arrows move that choice, not the row", async () => {
      renderExport("/export/asset-1?to=youtube");
      const r1440 = await screen.findByRole("radio", { name: /^1440p/ });
      const r4k = screen.getByRole("radio", { name: /^4K/ });
      expect(r1440).toHaveAttribute("tabindex", "0");
      expect(r4k).toHaveAttribute("tabindex", "-1");

      fireEvent.keyDown(r1440, { key: "ArrowRight" });

      expect(card(/^YouTube/)).toHaveAttribute("aria-checked", "true");
      expect(r4k).toHaveAttribute("aria-checked", "true");
      expect(r4k).toHaveAttribute("tabindex", "0");
      expect(r1440).toHaveAttribute("tabindex", "-1");
      expect(r4k).toHaveFocus();
      // It stops at the end, like the row.
      fireEvent.keyDown(r4k, { key: "ArrowRight" });
      expect(r4k).toHaveAttribute("aria-checked", "true");
    });

    it("the arrows move Fill / Fit too", async () => {
      renderExport("/export/asset-1?to=vertical");
      const fill = await screen.findByRole("radio", { name: /^Fill/ });
      const fit = screen.getByRole("radio", { name: /^Fit/ });
      expect(fill).toHaveAttribute("aria-checked", "true");
      expect(fill).toHaveAttribute("tabindex", "0");
      fireEvent.keyDown(fill, { key: "ArrowRight" });
      expect(fit).toHaveAttribute("aria-checked", "true");
      expect(fit).toHaveFocus();
      expect(card(/^TikTok/)).toHaveAttribute("aria-checked", "true");
    });

    it("Enter exports, from the page or a card, without re-selecting the card", async () => {
      renderExport("/export/asset-1?to=github");
      await screen.findByRole("heading", { name: "For GitHub · Jira" });
      // false: the default was prevented, so Enter cannot also click (select) the card.
      expect(fireEvent.keyDown(card(/^YouTube/), { key: "Enter" })).toBe(false);
      expect(startArgs()).toMatchObject({ presetId: "light" });
      expect(card(/^YouTube/)).toHaveAttribute("aria-checked", "false");
    });

    it("not while typing in a field, not with a modifier, not on another button", async () => {
      renderExport("/export/asset-1?to=youtube");
      await screen.findByRole("heading", { name: "For YouTube" });
      const field = document.createElement("input");
      document.body.append(field);
      try {
        fireEvent.keyDown(field, { key: "Enter" });
        fireEvent.keyDown(document.body, { key: "Enter", metaKey: true });
        fireEvent.keyDown(screen.getByRole("button", { name: /Change video/ }), { key: "Enter" });
        expect(exportController.start).not.toHaveBeenCalled();
      } finally {
        field.remove();
      }
    });
  });

  it("Change video lists the Library's recordings and opens the one picked, keeping the destination", async () => {
    list(recording(), recording({ assetId: "asset-3", title: "Other take", createdAt: 3000 }));
    const router = renderExport("/export/asset-1?to=github");
    fireEvent.click(await screen.findByRole("button", { name: /Change video/ }));
    const picker = screen.getByRole("dialog", { name: "Pick a video from your Library" });
    fireEvent.click(within(picker).getByRole("button", { name: /Other take/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/export/asset-3"));
    expect(router.state.location.search).toBe("?to=github");
  });

  it("one export at a time: while one runs, Export says so", async () => {
    busy.mockReturnValue(true);
    renderExport("/export/asset-1?to=youtube");
    fireEvent.click(await screen.findByRole("button", { name: /^Export for YouTube/ }));
    expect(getToasts()).toContainEqual(
      expect.objectContaining({ message: expect.stringMatching(/^Already exporting/) }),
    );
    expect(exportController.start).not.toHaveBeenCalled();
  });

  it("an unreadable file: says so and goes to Export with no video", async () => {
    probe.mockResolvedValue(null);
    const router = renderExport("/export/asset-1?to=youtube");
    await waitFor(() => expect(router.state.location.pathname).toBe("/export"));
    expect(getToasts()).toContainEqual(
      expect.objectContaining({ message: "Couldn't read this recording to prepare a file." }),
    );
    expect(exportController.start).not.toHaveBeenCalled();
  });

  it("screenshots are not exportable", async () => {
    list(recording({ kind: "screenshot", local: { ...recording().local!, kind: "screenshot" } }));
    renderExport();
    expect(await screen.findByText("Only recordings can be exported")).toBeVisible();
    expect(probe).not.toHaveBeenCalled();
  });

  it("a copy that exists reads Ready, and opening it replaces encoding it again — Enter too", async () => {
    list(recording(), preparedCopy);
    const router = renderExport();
    const chat = await screen.findByRole("radio", { name: /^Slack · Discord/ });
    expect(within(chat).getByText("Ready")).toBeVisible();
    fireEvent.click(chat);
    expect(screen.getByRole("button", { name: "Export again" })).toBeVisible();
    expect(fireEvent.keyDown(chat, { key: "Enter" })).toBe(false);
    await waitFor(() => expect(router.state.location.pathname).toBe("/library/asset-2"));
    expect(exportController.start).not.toHaveBeenCalled();
  });

  it("warns that unexported edits are not in the original", async () => {
    list(recording({ editSavedAt: 5 }));
    renderExport("/export/asset-1?to=youtube");
    expect(
      await screen.findByText(
        "Your edits are not in this file. To send them, use Export in the editor.",
      ),
    ).toBeVisible();
  });

  it("an unknown ?to= picks nothing", async () => {
    renderExport("/export/asset-1?to=myspace");
    expect(await screen.findByRole("heading", { name: "Where is it going?" })).toBeVisible();
  });
});

describe("Old Prepare URLs", () => {
  it("land on Export with the recording and the query", async () => {
    const router = renderExport("/prepare/asset-1?to=github");
    await waitFor(() => expect(router.state.location.pathname).toBe("/export/asset-1"));
    expect(router.state.location.search).toBe("?to=github");
    expect(await screen.findByRole("heading", { name: "For GitHub · Jira" })).toBeVisible();
  });

  it("with no recording, land on Export with no video", async () => {
    const router = renderExport("/prepare?to=youtube");
    await waitFor(() => expect(router.state.location.pathname).toBe("/export"));
    expect(router.state.location.search).toBe("?to=youtube");
  });
});

/** A video that came in from outside (NIW2-579): a recording whose capture mode is "import". */
const imported = (assetId: string): LibraryItem =>
  recording({
    assetId,
    title: `Imported ${assetId}`,
    capture: { mode: "import", width: 1080, height: 1920, ratio: null },
    local: {
      ...recording().local!,
      id: `imported-${assetId}`,
      assetId,
      title: `Imported ${assetId}`,
    },
  });

const importResult = (...assetIds: string[]) => ({
  imported: assetIds.map((id) => imported(id).local!),
  failed: [],
  canceled: false,
});

/** Drag files from the OS over an element and drop them; whether the drop was handled. */
function dropFiles(target: Element, ...names: string[]): boolean {
  const files = names.map((name) => new File(["x"], name));
  const dataTransfer = { types: ["Files"], files };
  fireEvent.dragEnter(target, { dataTransfer });
  // fireEvent answers false when a listener called preventDefault: Electron does not
  // navigate the window to the file.
  return !fireEvent.drop(target, { dataTransfer });
}

describe("ExportPage with no video", () => {
  beforeEach(() => {
    window.electronAPI.pathForFile = vi.fn((f: File) => `/Users/me/Movies/${f.name}`);
  });

  it("a drop zone, Pick from Library, Browse files and the recent exports", async () => {
    list(recording(), preparedCopy);
    const router = renderExport("/export");
    expect(await screen.findByRole("heading", { name: "Export", level: 1 })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Drop a video here" })).toBeVisible();
    expect(
      screen.getByText(/^Any MP4, MOV, M4V or WebM, from Kaipu or from somewhere else/),
    ).toBeVisible();

    const recent = await screen.findByRole("region", { name: "Recent exports" });
    const row = within(recent).getByRole("button", { name: /Slack · Discord/ });
    expect(row).toHaveTextContent("Ready");
    fireEvent.click(row);
    await waitFor(() => expect(router.state.location.pathname).toBe("/library/asset-2"));
  });

  it("Pick from Library lists the originals, not their copies, and opens the one picked", async () => {
    list(recording(), preparedCopy);
    const router = renderExport("/export?to=github");
    fireEvent.click(await screen.findByRole("button", { name: "Pick from Library" }));
    const picker = screen.getByRole("dialog");
    expect(within(picker).getAllByRole("button")).toHaveLength(1);
    fireEvent.click(within(picker).getByRole("button", { name: /Demo/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/export/asset-1"));
    expect(router.state.location.search).toBe("?to=github");
  });

  it("Browse files opens the import dialog", async () => {
    window.electronAPI.importVideos = vi.fn(async () => ({
      imported: [],
      failed: [],
      canceled: true,
    }));
    renderExport("/export");
    fireEvent.click(await screen.findByRole("button", { name: "Browse files…" }));
    await waitFor(() => expect(window.electronAPI.importVideos).toHaveBeenCalledOnce());
  });

  it("a dropped video is imported and opened, with the destination from the URL", async () => {
    window.electronAPI.importVideoFiles = vi.fn(async () => importResult("asset-9"));
    const router = renderExport("/export?to=github");
    await screen.findByTestId("export-drop-zone");
    // The library re-lists with the new video in it.
    list(recording(), imported("asset-9"));

    expect(dropFiles(document.body, "Zoom Meeting.mov")).toBe(true);

    await waitFor(() => expect(router.state.location.pathname).toBe("/export/asset-9"));
    expect(router.state.location.search).toBe("?to=github");
    expect(window.electronAPI.importVideoFiles).toHaveBeenCalledWith([
      "/Users/me/Movies/Zoom Meeting.mov",
    ]);
    expect(await screen.findByRole("heading", { name: "For GitHub · Jira" })).toBeVisible();
  });

  it("the drop zone lights up while a file is dragged over the window", async () => {
    renderExport("/export");
    const zone = await screen.findByTestId("export-drop-zone");
    fireEvent.dragEnter(document.body, { dataTransfer: { types: ["Files"], files: [] } });
    expect(zone).toHaveAttribute("data-active", "true");
    expect(screen.getByRole("heading", { name: "Drop it to bring it in" })).toBeVisible();
  });

  it("while an import runs, neither Pick from Library nor Browse files can start another", async () => {
    window.electronAPI.importVideoFiles = vi.fn(() => new Promise<never>(() => {}));
    renderExport("/export");
    await screen.findByTestId("export-drop-zone");

    dropFiles(document.body, "clip.mp4");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Pick from Library" })).toBeDisabled(),
    );
    expect(screen.getByRole("button", { name: "Browse files…" })).toBeDisabled();
  });

  it("with a video open: a video dropped anywhere opens Export on it, keeping the selected destination", async () => {
    window.electronAPI.importVideoFiles = vi.fn(async () => importResult("asset-9"));
    const router = renderExport("/export/asset-1");
    fireEvent.click(await screen.findByRole("radio", { name: /^Slack/ }));
    list(recording(), imported("asset-9"));

    expect(dropFiles(document.body, "clip.mp4")).toBe(true);

    await waitFor(() => expect(router.state.location.pathname).toBe("/export/asset-9"));
    expect(router.state.location.search).toBe("?to=chat");
  });

  it("several videos: all are imported, Export opens on the first, and a toast names the rest", async () => {
    window.electronAPI.importVideoFiles = vi.fn(async () =>
      importResult("asset-7", "asset-8", "asset-9"),
    );
    const router = renderExport("/export");
    await screen.findByTestId("export-drop-zone");
    list(recording(), imported("asset-7"), imported("asset-8"), imported("asset-9"));

    dropFiles(document.body, "a.mp4", "b.mov", "c.mp4");

    await waitFor(() => expect(router.state.location.pathname).toBe("/export/asset-7"));
    expect(getToasts().map((t) => t.message)).toContain("2 more videos are in your Library");
  });

  it("a file that is not a video is not imported, and the window does not open it", async () => {
    window.electronAPI.importVideoFiles = vi.fn(async () => importResult());
    const router = renderExport("/export");
    await screen.findByTestId("export-drop-zone");

    expect(dropFiles(document.body, "notes.pdf")).toBe(true);

    await waitFor(() =>
      expect(getToasts().map((t) => t.message)).toContain(
        "Only videos can be imported (MP4, MOV, M4V or WebM). Skipped: notes.pdf",
      ),
    );
    expect(window.electronAPI.importVideoFiles).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe("/export");
  });
});
