import { act, render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryItem } from "@shared/types/library-item";
import { DEFAULT_SETTINGS } from "@shared/types";
import { dismissToast, getToasts } from "@renderer/ui/toast-store";
import { StatusStackProvider } from "@renderer/features/status-cards/status-stack";
import { LibraryDetailPage } from "./library-detail-page";

// The banner and the post-recording panel read the file through mediabunny; here only the
// facts it returns matter.
const probe = vi.hoisted(() =>
  vi.fn(async () => ({
    width: 2560,
    height: 1440,
    durationSec: 78,
    fps: 30,
    hasAudio: true,
    sampleRate: 48000,
  })),
);
vi.mock("@renderer/features/video-editor/export/probe-source", () => ({ probeSource: probe }));

/** A cloud-only screenshot: no local file at all. Exercises the actions that
 *  require a local copy (Reveal, Edit, Copy, Delete) and confirms they are all
 *  hidden — not merely disabled — for such an item. */
const cloudOnlyItem: LibraryItem = {
  assetId: "cloud-1",
  kind: "screenshot",
  title: "Cloud Screenshot",
  createdAt: 1000,
  durationSeconds: 0,
  derivedFromAssetId: null,
  editSavedAt: null,
  editExportedSavedAt: null,
  local: null,
  cloud: {
    assetId: "cloud-1",
    kind: "screenshot",
    title: "Cloud Screenshot",
    revisionId: "r1",
    contentType: "image/png",
    sizeBytes: 300,
    contentSha256: "hash",
    durationSeconds: 0,
    hasThumbnail: false,
    derivedFromAssetId: null,
    autoUploadExcluded: false,
    createdAt: 1000,
    lastVerifiedAt: 5,
    lastSeenLocalId: null,
  },
  availability: "cloud",
  transfer: { state: "idle" },
  comparison: "same",
  editing: "needs-source",
  sharing: "private",
  capture: null,
};

/** Local-and-cloud, identical bytes, an editor export with no editing project of
 *  its own — the one combination the plan says must show "Remove local
 *  download". */
const exportedOnlyItem: LibraryItem = {
  assetId: "asset-b",
  kind: "recording",
  title: "Exported Recording",
  createdAt: 2000,
  durationSeconds: 45,
  derivedFromAssetId: null,
  editSavedAt: null,
  editExportedSavedAt: null,
  local: {
    id: "local-b",
    assetId: "asset-b",
    kind: "recording",
    title: "Exported Recording",
    filePath: "/vault/b.mp4",
    createdAt: 2000,
    sizeBytes: 500,
    durationSeconds: 45,
    thumbnailUrl: null,
    derivedFromAssetId: null,
    contentSha256: "abc",
  },
  cloud: {
    assetId: "asset-b",
    kind: "recording",
    title: "Exported Recording",
    revisionId: "r2",
    contentType: "video/mp4",
    sizeBytes: 500,
    contentSha256: "abc",
    durationSeconds: 45,
    hasThumbnail: false,
    derivedFromAssetId: null,
    autoUploadExcluded: false,
    createdAt: 2000,
    lastVerifiedAt: 10,
    lastSeenLocalId: "local-b",
  },
  availability: "local-and-cloud",
  transfer: { state: "idle" },
  comparison: "same",
  editing: "exported-only",
  sharing: "private",
  capture: null,
};

/** Same shape as `exportedOnlyItem`, but with its own editing project still on
 *  this device. The button still shows for it — main's remove-local-copy
 *  policy is the one that refuses with `edit-project`, and the page just
 *  toasts the blocked-edit copy. */
const projectAvailableItem: LibraryItem = {
  ...exportedOnlyItem,
  assetId: "asset-c",
  local: { ...exportedOnlyItem.local!, id: "local-c", assetId: "asset-c" },
  cloud: { ...exportedOnlyItem.cloud!, assetId: "asset-c", lastSeenLocalId: "local-c" },
  editing: "project-available",
};

function renderDetail(assetId: string) {
  const router = createMemoryRouter(
    [
      { path: "/library/:assetId", element: <LibraryDetailPage /> },
      { path: "/library", element: <div>library-page</div> },
      { path: "/editor/video/:assetId", element: <div>editor-video</div> },
      { path: "/prepare/:assetId", element: <div>prepare-page</div> },
    ],
    { initialEntries: [`/library/${assetId}`] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

async function waitForLoaded(): Promise<void> {
  await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
}

describe("LibraryDetailPage", () => {
  beforeEach(() => {
    window.electronAPI.removeLocalCopy = vi.fn(async () => ({ ok: true as const }));
    window.electronAPI.onLibraryChanged = () => () => {};
  });

  afterEach(() => {
    for (const t of getToasts()) dismissToast(t.id);
  });

  it("shows the cloud label and hides Reveal, Edit, Copy and Delete for a cloud-only item", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [cloudOnlyItem],
      vaultError: null,
      catalogVerifiedAt: null,
    }));

    renderDetail("cloud-1");
    await waitForLoaded();

    expect(screen.getByText("Cloud")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reveal/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^edit$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^copy$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /remove local download/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Prepare for…" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Prepare for YouTube" })).toBeNull();
  });

  it("shows how a recording was captured in the metadata line", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [
        {
          ...exportedOnlyItem,
          capture: {
            mode: "area" as const,
            width: 1234,
            height: 567,
            ratio: "free" as const,
          },
        },
      ],
      vaultError: null,
      catalogVerifiedAt: null,
    }));

    renderDetail("asset-b");
    await waitForLoaded();

    expect(screen.getByTestId("capture-meta")).toHaveTextContent("FRAME · 1234 × 567");
  });

  it("Prepare for… opens the Prepare screen with nothing preselected (NIW2-578)", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [exportedOnlyItem],
      vaultError: null,
      catalogVerifiedAt: null,
    }));

    const router = renderDetail("asset-b");
    await waitForLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Prepare for…" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/prepare/asset-b"));
    expect(router.state.location.search).toBe("");
  });

  it("the quick chips open Prepare on their destination", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [exportedOnlyItem],
      vaultError: null,
      catalogVerifiedAt: null,
    }));

    const router = renderDetail("asset-b");
    await waitForLoaded();
    expect(screen.getByRole("button", { name: "Prepare for TikTok · Reels" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Prepare for GitHub" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Prepare for YouTube" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/prepare/asset-b"));
    expect(router.state.location.search).toBe("?to=youtube");
  });

  it("Edit video lands on the recording's Editor URL", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [exportedOnlyItem],
      vaultError: null,
      catalogVerifiedAt: null,
    }));

    const router = renderDetail("asset-b");
    await waitForLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Edit video" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/editor/video/asset-b"));
  });

  it("shows Remove local download for a local-and-cloud, same-bytes, exported-only item", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [exportedOnlyItem],
      vaultError: null,
      catalogVerifiedAt: null,
    }));

    renderDetail("asset-b");
    await waitForLoaded();

    expect(screen.getByRole("button", { name: /remove local download/i })).toBeInTheDocument();
  });

  it("toasts the blocked-reason copy when removeLocalCopy refuses", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [exportedOnlyItem],
      vaultError: null,
      catalogVerifiedAt: null,
    }));
    window.electronAPI.removeLocalCopy = vi.fn(async () => ({
      ok: false,
      reason: "edit-project" as const,
    }));

    renderDetail("asset-b");
    await waitForLoaded();

    fireEvent.click(screen.getByRole("button", { name: /remove local download/i }));

    await waitFor(() =>
      expect(getToasts()).toContainEqual(
        expect.objectContaining({
          message:
            "This file is used by a local editing project. Keep its files to continue editing.",
        }),
      ),
    );
  });

  it("re-lists after removeLocalCopy succeeds", async () => {
    const listMock = vi.fn(async () => ({
      items: [exportedOnlyItem],
      vaultError: null,
      catalogVerifiedAt: null,
    }));
    window.electronAPI.listLibraryItems = listMock;
    window.electronAPI.removeLocalCopy = vi.fn(async () => ({ ok: true as const }));

    renderDetail("asset-b");
    await waitForLoaded();
    expect(listMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /remove local download/i }));
    });

    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
  });

  it("shows Remove local download for a project-available item, and toasts the blocked-edit copy when main refuses", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [projectAvailableItem],
      vaultError: null,
      catalogVerifiedAt: null,
    }));
    window.electronAPI.removeLocalCopy = vi.fn(async () => ({
      ok: false,
      reason: "edit-project" as const,
    }));

    renderDetail("asset-c");
    await waitForLoaded();

    fireEvent.click(screen.getByRole("button", { name: /remove local download/i }));

    await waitFor(() =>
      expect(getToasts()).toContainEqual(
        expect.objectContaining({
          message:
            "This file is used by a local editing project. Keep its files to continue editing.",
        }),
      ),
    );
  });
});

describe("LibraryDetailPage — lineage and edit badge", () => {
  beforeEach(() => {
    window.electronAPI.removeLocalCopy = vi.fn(async () => ({ ok: true as const }));
    window.electronAPI.onLibraryChanged = () => () => {};
  });

  afterEach(() => {
    for (const t of getToasts()) dismissToast(t.id);
  });

  const base = {
    kind: "recording" as const,
    createdAt: 1_000,
    durationSeconds: 10,
    local: null,
    cloud: null,
    availability: "local" as const,
    transfer: { state: "idle" as const },
    comparison: "same" as const,
    editing: "project-available" as const,
    sharing: "private" as const,
    capture: null,
    derivedFromAssetId: null,
    editSavedAt: null,
    editExportedSavedAt: null,
  };
  const local = (id: string) => ({
    id,
    assetId: id,
    kind: "recording" as const,
    title: id,
    filePath: `/vault/${id}.mp4`,
    createdAt: 1_000,
    sizeBytes: 1,
    durationSeconds: 10,
    derivedFromAssetId: null,
    contentSha256: null,
  });

  it("links an export to its source and lists exports on the source", async () => {
    const items = [
      { ...base, assetId: "src", title: "Original take", local: local("src") },
      {
        ...base,
        assetId: "exp",
        title: "Original take (export)",
        createdAt: 2_000,
        derivedFromAssetId: "src",
        local: { ...local("exp"), derivedFromAssetId: "src" },
      },
    ];
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items,
      vaultError: null,
      catalogVerifiedAt: null,
    }));
    renderDetail("exp");
    await waitForLoaded();
    const link = await screen.findByRole("link", { name: /original take$/i });
    expect(link).toHaveAttribute("href", "/library/src");

    renderDetail("src");
    await waitForLoaded();
    expect(await screen.findByText(/^exports$/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /original take \(export\)/i })).toBeInTheDocument();
  });

  it("says the source was deleted when the parent is not in the list", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [
        {
          ...base,
          assetId: "exp",
          title: "Orphan",
          derivedFromAssetId: "gone",
          local: local("exp"),
        },
      ],
      vaultError: null,
      catalogVerifiedAt: null,
    }));
    renderDetail("exp");
    await waitForLoaded();
    expect(await screen.findByText(/source recording was deleted/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /gone/ })).toBeNull();
  });

  it("links to a cloud-only source (no local id)", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [
        {
          ...base,
          assetId: "src",
          title: "In the cloud",
          availability: "cloud" as const,
          editing: "needs-source" as const,
        },
        {
          ...base,
          assetId: "exp",
          title: "Export",
          derivedFromAssetId: "src",
          local: local("exp"),
        },
      ],
      vaultError: null,
      catalogVerifiedAt: null,
    }));
    renderDetail("exp");
    await waitForLoaded();
    expect(await screen.findByRole("link", { name: /in the cloud/i })).toHaveAttribute(
      "href",
      "/library/src",
    );
  });

  it("shows 'Edited · not exported' instead of the editing line when a session has no export", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [{ ...base, assetId: "src", title: "Take", local: local("src"), editSavedAt: 5_000 }],
      vaultError: null,
      catalogVerifiedAt: null,
    }));
    renderDetail("src");
    await waitForLoaded();
    expect(await screen.findByText(/edited · not exported/i)).toBeInTheDocument();
    expect(screen.queryByText(/editing project available/i)).toBeNull();
  });

  it("says the latest edits are unexported — not 'not exported' — above an Exports list", async () => {
    // The screenshot that started this: "Edited · not exported" sitting directly above
    // a populated EXPORTS section reads as a contradiction. An export exists; what is
    // missing from a file is only the edits made after it.
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [
        {
          ...base,
          assetId: "src",
          title: "Take",
          local: local("src"),
          editSavedAt: 9_000,
          editExportedSavedAt: 5_000,
        },
        { ...base, assetId: "exp", title: "Take (edited)", derivedFromAssetId: "src" },
      ],
      vaultError: null,
      catalogVerifiedAt: null,
    }));
    renderDetail("src");
    await waitForLoaded();
    expect(await screen.findByText(/latest edits not exported/i)).toBeInTheDocument();
    expect(screen.queryByText(/edited · not exported/i)).toBeNull();
  });

  it("drops the badge once the stamp matches the session, even with an older export date", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [
        {
          ...base,
          assetId: "src",
          title: "Take",
          local: local("src"),
          createdAt: 9_999,
          editSavedAt: 5_000,
          editExportedSavedAt: 5_000,
        },
        // createdAt BEFORE the session's savedAt — the real shape of every export, and
        // what the old date comparison mistook for a stale export.
        {
          ...base,
          assetId: "exp",
          title: "Take (edited)",
          derivedFromAssetId: "src",
          createdAt: 1,
        },
      ],
      vaultError: null,
      catalogVerifiedAt: null,
    }));
    renderDetail("src");
    await waitForLoaded();
    expect(await screen.findByText(/^edited$/i)).toBeInTheDocument();
    expect(screen.queryByText(/not exported/i)).toBeNull();
  });

  /** An original and an export of it, both with a local file to play. */
  const pair = () =>
    vi.fn(async () => ({
      items: [
        { ...base, assetId: "src", title: "Take", local: local("src") },
        {
          ...base,
          assetId: "exp",
          title: "Take (edited)",
          derivedFromAssetId: "src",
          local: local("exp"),
        },
      ],
      vaultError: null,
      catalogVerifiedAt: null,
    }));

  it("labels the player on an original as showing the unedited file", async () => {
    // The player streams the vault file, which ADR 0003 keeps untouched — so it never
    // shows the edits. Nothing said so, which is what made the badge above it read as
    // a contradiction.
    window.electronAPI.listLibraryItems = pair();
    renderDetail("src");
    await waitForLoaded();
    expect(await screen.findByText(/edits are not shown here/i)).toBeInTheDocument();
  });

  it("omits that label on an export, where the player IS the edited video", async () => {
    window.electronAPI.listLibraryItems = pair();
    renderDetail("exp");
    await waitForLoaded();
    expect(screen.queryByText(/edits are not shown here/i)).toBeNull();
  });
});

describe("LibraryDetailPage — heavy to send (NIW2-218)", () => {
  const withSize = (sizeBytes: number): LibraryItem => ({
    ...exportedOnlyItem,
    local: { ...exportedOnlyItem.local!, sizeBytes },
    cloud: null,
    availability: "local",
  });

  beforeEach(() => {
    window.electronAPI.onLibraryChanged = () => () => {};
    window.electronAPI.getSettings = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);
    probe.mockClear();
  });

  it("over 25 MB: amber size, and a banner with the Light estimate that opens Prepare on GitHub", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [withSize(119_000_000)],
      vaultError: null,
      catalogVerifiedAt: null,
    }));
    const router = renderDetail("asset-b");
    await waitForLoaded();

    expect(screen.getByText("119 MB")).toHaveAttribute("data-heavy", "true");
    expect(screen.getByText("119 MB is heavy to send.")).toBeInTheDocument();
    // The Light row's estimate for 78 s, which fits GitHub's 100 MB.
    expect(
      await screen.findByText(/about 7.6 MB, small enough for GitHub or Jira/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Prepare a light copy →" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/prepare/asset-b"));
    expect(router.state.location.search).toBe("?to=github");
  });

  it("up to 25 MB: no banner, no amber, and the file isn't read on this page", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [withSize(20_000_000)],
      vaultError: null,
      catalogVerifiedAt: null,
    }));
    renderDetail("asset-b");
    await waitForLoaded();

    expect(screen.queryByText(/heavy to send/)).toBeNull();
    expect(screen.getByText("20 MB")).toHaveAttribute("data-heavy", "false");
    expect(probe).not.toHaveBeenCalled();
  });
});

describe("LibraryDetailPage — where is it going? (NIW2-578)", () => {
  // Small on purpose: the panel shows after every recording, not only a heavy one.
  const fresh: LibraryItem = {
    ...exportedOnlyItem,
    local: { ...exportedOnlyItem.local!, sizeBytes: 4_000_000 },
    cloud: null,
    availability: "local",
  };
  const PANEL = { name: "Where is your video going?" };

  function renderFresh(fromRecording: boolean) {
    const router = createMemoryRouter(
      [
        { path: "/library/:assetId", element: <LibraryDetailPage /> },
        { path: "/prepare/:assetId", element: <div>prepare-page</div> },
      ],
      { initialEntries: [{ pathname: "/library/asset-b", state: { fromRecording } }] },
    );
    render(
      <StatusStackProvider>
        <RouterProvider router={router} />
      </StatusStackProvider>,
    );
    return router;
  }

  beforeEach(() => {
    window.electronAPI.onLibraryChanged = () => () => {};
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [fresh],
      vaultError: null,
      catalogVerifiedAt: null,
    }));
  });

  it("right after recording, asks where it is going; a shortcut opens Prepare on it", async () => {
    window.electronAPI.getSettings = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);
    const router = renderFresh(true);
    const panel = await screen.findByRole("region", PANEL);
    expect(within(panel).getByText("Your video is ready. Where is it going?")).toBeVisible();
    // The file's own size and picture, once read.
    expect(
      await within(panel).findByText("1:18 · 2560 × 1440 · 4.0 MB · the original stays as it is"),
    ).toBeVisible();
    for (const name of [/^YouTube/, /^TikTok · Reels/, /^GitHub · Jira/, /^Slack · Discord/]) {
      expect(within(panel).getByRole("button", { name })).toBeVisible();
    }

    fireEvent.click(within(panel).getByRole("button", { name: /^YouTube/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/prepare/asset-b"));
    expect(router.state.location.search).toBe("?to=youtube");
  });

  it("More places opens Prepare with nothing preselected", async () => {
    window.electronAPI.getSettings = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);
    const router = renderFresh(true);
    const panel = await screen.findByRole("region", PANEL);
    fireEvent.click(within(panel).getByRole("button", { name: "More places" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/prepare/asset-b"));
    expect(router.state.location.search).toBe("");
  });

  it("Not now dismisses it, and Prepare for… stays on the page", async () => {
    window.electronAPI.getSettings = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);
    renderFresh(true);
    const panel = await screen.findByRole("region", PANEL);
    fireEvent.click(
      within(panel).getByRole("button", { name: "Not now — keep it in the Library" }),
    );
    expect(screen.queryByRole("region", PANEL)).toBeNull();
    expect(screen.getByRole("button", { name: "Prepare for…" })).toBeVisible();
  });

  it("not when Settings turned it off", async () => {
    window.electronAPI.getSettings = vi
      .fn()
      .mockResolvedValue({ ...DEFAULT_SETTINGS, showRecordingSavedCard: false });
    renderFresh(true);
    await waitForLoaded();
    await act(async () => {});
    expect(screen.queryByRole("region", PANEL)).toBeNull();
  });

  it("not when the page was opened from the Library", async () => {
    window.electronAPI.getSettings = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);
    renderFresh(false);
    await waitForLoaded();
    await act(async () => {});
    expect(screen.queryByRole("region", PANEL)).toBeNull();
  });
});
