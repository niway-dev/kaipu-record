import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useLocalLibrary } from "./use-local-library";
import { reportError } from "@renderer/features/analytics";
import type { LibraryItem } from "@shared/types/library-item";
import {
  AMBIGUOUS_IDENTITY_MARKER,
  ITEM_NOT_FOUND_MARKER,
  UNREADABLE_RECORD_MARKER,
} from "@shared/types/library-storage";
import { dismissToast, getToasts } from "@renderer/ui/toast-store";

vi.mock("@renderer/features/analytics", () => ({ reportError: vi.fn() }));

const ASSET_A = "00000000-0000-0000-0000-000000000001";

function localItem(
  over: Partial<LibraryItem> & { assetId: string; local: NonNullable<LibraryItem["local"]> },
): LibraryItem {
  return {
    kind: "recording",
    title: over.local.title,
    createdAt: over.local.createdAt,
    durationSeconds: over.local.durationSeconds,
    derivedFromAssetId: null,
    sourceVideoAssetId: null,
    sourceTimeSeconds: null,
    editSavedAt: null,
    editExportedSavedAt: null,
    cloud: null,
    availability: "local",
    transfer: { state: "idle" },
    comparison: "same",
    editing: "project-available",
    sharing: "private",
    capture: null,
    ...over,
  };
}

const items: LibraryItem[] = [
  localItem({
    assetId: "00000000-0000-0000-0000-000000000001",
    local: {
      id: "a",
      assetId: "00000000-0000-0000-0000-000000000001",
      kind: "recording",
      title: "A",
      filePath: "/vault/a.webm",
      createdAt: 2000,
      sizeBytes: 100,
      durationSeconds: 10,
      thumbnailUrl: null,
      derivedFromAssetId: null,
      sourceVideoAssetId: null,
      sourceTimeSeconds: null,
      contentSha256: null,
    },
  }),
  localItem({
    assetId: "00000000-0000-0000-0000-000000000002",
    local: {
      id: "b",
      assetId: "00000000-0000-0000-0000-000000000002",
      kind: "recording",
      title: "B",
      filePath: "/vault/b.webm",
      createdAt: 1000,
      sizeBytes: 200,
      durationSeconds: 20,
      thumbnailUrl: null,
      derivedFromAssetId: null,
      sourceVideoAssetId: null,
      sourceTimeSeconds: null,
      contentSha256: null,
    },
  }),
];

const cloudOnlyItem: LibraryItem = {
  assetId: "00000000-0000-0000-0000-000000000009",
  kind: "recording",
  title: "Cloud only",
  createdAt: 500,
  durationSeconds: 30,
  derivedFromAssetId: null,
  sourceVideoAssetId: null,
  sourceTimeSeconds: null,
  editSavedAt: null,
  editExportedSavedAt: null,
  local: null,
  cloud: {
    assetId: "00000000-0000-0000-0000-000000000009",
    kind: "recording",
    title: "Cloud only",
    revisionId: "r1",
    contentType: "video/mp4",
    sizeBytes: 300,
    contentSha256: "hash",
    durationSeconds: 30,
    hasThumbnail: false,
    derivedFromAssetId: null,
    autoUploadExcluded: false,
    createdAt: 500,
    lastVerifiedAt: 5,
    lastSeenLocalId: null,
  },
  availability: "cloud",
  transfer: { state: "idle" },
  comparison: "same",
  editing: "project-available",
  sharing: "private",
  capture: null,
};

describe("useLocalLibrary", () => {
  beforeEach(() => {
    vi.mocked(reportError).mockClear();
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items,
      vaultError: null,
      catalogVerifiedAt: null,
    }));
    window.electronAPI.deleteLocalRecording = vi.fn(async () => {});
    window.electronAPI.renameLocalRecording = vi.fn(
      async (id: string, _assetId: string, title: string) => ({
        file: "unchanged" as const,
        recording: { ...items[0]!.local!, id, title },
      }),
    );
    window.electronAPI.removeLocalCopy = vi.fn(async () => ({ ok: true as const }));
    window.electronAPI.onLibraryChanged = () => () => {};
  });

  it("maps library items to library videos", async () => {
    const { result } = renderHook(() => useLocalLibrary());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.videos).toHaveLength(2);
    expect(result.current.videos[0]).toMatchObject({
      id: "a",
      title: "A",
      fileSizeBytes: 100,
      durationSeconds: 10,
      availability: "local",
    });
  });

  it("kicks off a cloud catalog refresh on mount", async () => {
    const refreshCloudCatalog = vi.fn(async () => ({
      ok: true as const,
      verifiedAt: 1,
      changed: false,
    }));
    window.electronAPI.refreshCloudCatalog = refreshCloudCatalog;

    const { result } = renderHook(() => useLocalLibrary());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(refreshCloudCatalog).toHaveBeenCalledTimes(1);
  });

  it("keeps the list visible and isLoading false during a background re-list", async () => {
    let notify: (() => void) | null = null;
    window.electronAPI.onLibraryChanged = (cb: () => void) => {
      notify = cb;
      return () => {};
    };
    const { result } = renderHook(() => useLocalLibrary());
    await waitFor(() => expect(result.current.videos).toHaveLength(2));
    expect(result.current.isLoading).toBe(false);

    let resolve!: (value: Awaited<ReturnType<typeof window.electronAPI.listLibraryItems>>) => void;
    window.electronAPI.listLibraryItems = vi.fn(
      () => new Promise((r) => (resolve = r)),
    ) as typeof window.electronAPI.listLibraryItems;
    await act(async () => notify?.());

    expect(result.current.isLoading).toBe(false);
    expect(result.current.isRefreshing).toBe(true);
    expect(result.current.videos).toHaveLength(2);

    await act(async () => resolve({ items: [], vaultError: null, catalogVerifiedAt: null }));
    expect(result.current.isRefreshing).toBe(false);
    expect(result.current.videos).toHaveLength(0);
  });

  it("an older list resolving last cannot overwrite a newer one", async () => {
    type ListResult = Awaited<ReturnType<typeof window.electronAPI.listLibraryItems>>;
    const resolvers: Array<(value: ListResult) => void> = [];
    window.electronAPI.listLibraryItems = vi.fn(
      () => new Promise<ListResult>((r) => resolvers.push(r)),
    ) as typeof window.electronAPI.listLibraryItems;
    const { result } = renderHook(() => useLocalLibrary());
    await waitFor(() => expect(resolvers).toHaveLength(1));
    // A second re-list starts while the first is still scanning.
    await act(async () => void result.current.refresh());
    expect(resolvers).toHaveLength(2);

    // The newer list lands first, then the stale one resolves last.
    await act(async () =>
      resolvers[1]!({ items: [items[0]!], vaultError: null, catalogVerifiedAt: 7 }),
    );
    expect(result.current.isLoading).toBe(false);
    await act(async () => resolvers[0]!({ items, vaultError: null, catalogVerifiedAt: null }));

    expect(result.current.videos).toHaveLength(1);
    expect(result.current.catalogVerifiedAt).toBe(7);
    expect(result.current.isRefreshing).toBe(false);
  });

  it("a superseded refresh() resolves only once the newer list is on screen", async () => {
    type ListResult = Awaited<ReturnType<typeof window.electronAPI.listLibraryItems>>;
    const resolvers: Array<(value: ListResult) => void> = [];
    window.electronAPI.listLibraryItems = vi.fn(
      () => new Promise<ListResult>((r) => resolvers.push(r)),
    ) as typeof window.electronAPI.listLibraryItems;
    const { result } = renderHook(() => useLocalLibrary());
    await waitFor(() => expect(resolvers).toHaveLength(1));
    await act(async () => resolvers[0]!({ items: [], vaultError: null, catalogVerifiedAt: null }));

    // A caller awaits its re-list (the detail page's retry); a broadcast starts a newer one.
    let older: Promise<void> | undefined;
    let olderDone = false;
    await act(async () => {
      older = result.current.refresh().then(() => void (olderDone = true));
    });
    await act(async () => void result.current.refresh());
    expect(resolvers).toHaveLength(3);

    // The older call's own list resolves first and is dropped: it must not resolve yet.
    await act(async () => resolvers[1]!({ items, vaultError: null, catalogVerifiedAt: null }));
    expect(olderDone).toBe(false);

    await act(async () =>
      resolvers[2]!({ items: [items[0]!], vaultError: null, catalogVerifiedAt: null }),
    );
    await act(async () => older);
    expect(olderDone).toBe(true);
    expect(result.current.videos).toHaveLength(1);
  });

  it("stays loading when the first list is superseded until the newer one lands", async () => {
    type ListResult = Awaited<ReturnType<typeof window.electronAPI.listLibraryItems>>;
    const resolvers: Array<(value: ListResult) => void> = [];
    window.electronAPI.listLibraryItems = vi.fn(
      () => new Promise<ListResult>((r) => resolvers.push(r)),
    ) as typeof window.electronAPI.listLibraryItems;
    const { result } = renderHook(() => useLocalLibrary());
    await waitFor(() => expect(resolvers).toHaveLength(1));
    await act(async () => void result.current.refresh());

    await act(async () => resolvers[0]!({ items, vaultError: null, catalogVerifiedAt: null }));
    expect(result.current.isLoading).toBe(true);
    await act(async () =>
      resolvers[1]!({ items: [items[1]!], vaultError: null, catalogVerifiedAt: null }),
    );
    expect(result.current.isLoading).toBe(false);
    expect(result.current.videos).toHaveLength(1);
  });

  it("sync() forces the cloud refresh and re-lists locally", async () => {
    const { result } = renderHook(() => useLocalLibrary());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const listed = vi.mocked(window.electronAPI.listLibraryItems).mock.calls.length;

    await act(async () => {
      await result.current.sync();
    });

    expect(window.electronAPI.refreshCloudCatalog).toHaveBeenCalledWith(true);
    expect(vi.mocked(window.electronAPI.listLibraryItems).mock.calls.length).toBe(listed + 1);
  });

  it("refreshCloud() is not forced unless asked", async () => {
    const refreshCloudCatalog = vi.fn(async () => ({
      ok: false as const,
      reason: "signed-out" as const,
    }));
    window.electronAPI.refreshCloudCatalog = refreshCloudCatalog;
    const { result } = renderHook(() => useLocalLibrary());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(refreshCloudCatalog).toHaveBeenLastCalledWith(false);
    await act(async () => {
      await result.current.refreshCloud(true);
    });
    expect(refreshCloudCatalog).toHaveBeenLastCalledWith(true);
  });

  it("a rejecting cloud refresh never blanks or blocks the local list", async () => {
    window.electronAPI.refreshCloudCatalog = vi.fn(async () => {
      throw new Error("ipc blew up");
    });
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const { result } = renderHook(() => useLocalLibrary());
      await waitFor(() => expect(result.current.videos).toHaveLength(2));
      expect(result.current.isLoading).toBe(false);

      // Sync: the cloud half fails, the local re-list still lands and nothing rejects.
      await act(async () => {
        await result.current.sync();
      });
      expect(result.current.videos).toHaveLength(2);
      expect(reportError).not.toHaveBeenCalled();
      await new Promise((r) => setTimeout(r, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("does not wait for the cloud before listing the local items", async () => {
    window.electronAPI.refreshCloudCatalog = vi.fn(() => new Promise<never>(() => {}));
    const { result } = renderHook(() => useLocalLibrary());
    await waitFor(() => expect(result.current.videos).toHaveLength(2));
    expect(result.current.isLoading).toBe(false);
  });

  it("removes a recording from state after delete resolves", async () => {
    const { result } = renderHook(() => useLocalLibrary());
    await waitFor(() => expect(result.current.videos).toHaveLength(2));

    await act(async () => {
      await result.current.remove("a");
    });

    expect(window.electronAPI.deleteLocalRecording).toHaveBeenCalledWith("a");
    expect(result.current.videos.map((v) => v.id)).toEqual(["b"]);
  });

  it("flags a vault error without blanking the list, keeping cloud items", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [cloudOnlyItem],
      vaultError: "EACCES",
      catalogVerifiedAt: 10,
    }));
    const { result } = renderHook(() => useLocalLibrary());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasError).toBe(true);
    expect(result.current.videos).toHaveLength(1);
    expect(result.current.videos[0]).toMatchObject({ id: null, availability: "cloud" });
    expect(result.current.catalogVerifiedAt).toBe(10);
  });

  it("reports a failed delete instead of silently swallowing it, keeping the item", async () => {
    window.electronAPI.deleteLocalRecording = vi.fn(async () => {
      throw new Error("EACCES");
    });
    const { result } = renderHook(() => useLocalLibrary());
    await waitFor(() => expect(result.current.videos).toHaveLength(2));

    await act(async () => {
      await result.current.remove("a");
    });

    expect(reportError).toHaveBeenCalledWith(
      expect.stringMatching(/delete/i),
      expect.any(Error),
      expect.anything(),
    );
    // The item stays — the delete didn't happen.
    expect(result.current.videos.map((v) => v.id)).toEqual(["a", "b"]);
  });

  it("reports a failed rename instead of swallowing it", async () => {
    window.electronAPI.renameLocalRecording = vi.fn(async () => {
      throw new Error("EACCES");
    });
    const { result } = renderHook(() => useLocalLibrary());
    await waitFor(() => expect(result.current.videos).toHaveLength(2));

    await act(async () => {
      await result.current.rename("a", ASSET_A, "New");
    });

    expect(reportError).toHaveBeenCalledWith(
      expect.stringMatching(/rename/i),
      expect.any(Error),
      expect.anything(),
    );
  });

  it("a rename refused while files are fixed is a plain toast, not an error report", async () => {
    window.electronAPI.renameLocalRecording = vi.fn(async () => {
      throw new Error("vault-maintenance: Kaipu is fixing your files");
    });
    const { result } = renderHook(() => useLocalLibrary());
    await waitFor(() => expect(result.current.videos).toHaveLength(2));
    await act(async () => {
      await result.current.rename("a", ASSET_A, "New");
    });
    expect(reportError).not.toHaveBeenCalled();
    expect(getToasts().map((toast) => toast.message)).toContain(
      "Kaipu is fixing your files. Try again in a moment.",
    );
    getToasts().forEach((toast) => dismissToast(toast.id));
  });

  it("a delete refused for an unreadable record is the read-only toast, and the item stays", async () => {
    window.electronAPI.deleteLocalRecording = vi.fn(async () => {
      throw new Error(`${UNREADABLE_RECORD_MARKER}: the record of "a" is corrupt-json`);
    });
    const { result } = renderHook(() => useLocalLibrary());
    await waitFor(() => expect(result.current.videos).toHaveLength(2));
    await act(async () => {
      await result.current.remove("a");
    });
    expect(reportError).not.toHaveBeenCalled();
    expect(getToasts()).toHaveLength(1);
    expect(result.current.videos.map((v) => v.id)).toEqual(["a", "b"]);
    getToasts().forEach((toast) => dismissToast(toast.id));
  });

  it("patches the renamed item by assetId with its new id, title and thumbnail", async () => {
    window.electronAPI.renameLocalRecording = vi.fn(
      async (_id: string, _assetId: string, title: string) => ({
        file: "renamed" as const,
        recording: {
          ...items[0]!.local!,
          id: "Sprint demo",
          title,
          thumbnailUrl: "kaipu-media://thumb/Sprint demo",
        },
      }),
    );
    const { result } = renderHook(() => useLocalLibrary());
    await waitFor(() => expect(result.current.videos).toHaveLength(2));

    await act(async () => {
      await result.current.rename("a", ASSET_A, "Sprint demo");
    });

    expect(result.current.videos[0]).toMatchObject({
      assetId: "00000000-0000-0000-0000-000000000001",
      id: "Sprint demo",
      title: "Sprint demo",
      thumbnailUrl: "kaipu-media://thumb/Sprint demo",
    });
    expect(result.current.videos[1]).toMatchObject({ id: "b", title: "B" });
    expect(getToasts()).toEqual([]);
  });

  it("shows a toast with Retry when the file kept its old name, and retries with the same title", async () => {
    const rename = vi.fn(async (id: string, _assetId: string, title: string) => ({
      file: "kept-old-name" as const,
      reason: "locked" as const,
      recording: { ...items[0]!.local!, id, title },
    }));
    window.electronAPI.renameLocalRecording = rename;
    const { result } = renderHook(() => useLocalLibrary());
    await waitFor(() => expect(result.current.videos).toHaveLength(2));

    await act(async () => {
      await result.current.rename("a", ASSET_A, "Locked name");
    });

    // The title is saved either way; the file kept its name.
    expect(result.current.videos[0]).toMatchObject({ id: "a", title: "Locked name" });
    const [toast] = getToasts();
    expect(toast?.message).toMatch(/another app is using it/i);
    expect(toast?.action?.label).toBe("Retry");
    expect(reportError).not.toHaveBeenCalled();

    rename.mockClear();
    await act(async () => toast!.action!.onClick());
    // Retry names the item by identity too, so it follows the item if it moved meanwhile.
    expect(rename).toHaveBeenCalledWith("a", ASSET_A, "Locked name");
    for (const t of getToasts()) dismissToast(t.id);
  });

  it("refreshes quietly when the item is no longer there (double commit)", async () => {
    window.electronAPI.renameLocalRecording = vi.fn(async () => {
      throw new Error(`Error invoking remote method: ${ITEM_NOT_FOUND_MARKER}: no media file`);
    });
    const { result } = renderHook(() => useLocalLibrary());
    await waitFor(() => expect(result.current.videos).toHaveLength(2));
    expect(window.electronAPI.listLibraryItems).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.rename("a", ASSET_A, "Again");
    });

    expect(reportError).not.toHaveBeenCalled();
    await waitFor(() => expect(window.electronAPI.listLibraryItems).toHaveBeenCalledTimes(2));
  });

  it("says plainly when two files claim the item, instead of an error report", async () => {
    window.electronAPI.renameLocalRecording = vi.fn(async () => {
      throw new Error(`Error invoking remote method: ${AMBIGUOUS_IDENTITY_MARKER}: 2 local items`);
    });
    const { result } = renderHook(() => useLocalLibrary());
    await waitFor(() => expect(result.current.videos).toHaveLength(2));
    await act(async () => {
      await result.current.rename("a", ASSET_A, "New");
    });
    expect(reportError).not.toHaveBeenCalled();
    const [toast] = getToasts();
    expect(toast?.message).toMatch(/two files in your folder/i);
    expect(toast?.action).toBeUndefined();
    for (const t of getToasts()) dismissToast(t.id);
  });

  it("re-lists when the vault folder changes", async () => {
    let notify: (() => void) | null = null;
    window.electronAPI.onLibraryChanged = (callback: () => void) => {
      notify = callback;
      return () => {};
    };
    const { result } = renderHook(() => useLocalLibrary());
    await waitFor(() => expect(result.current.videos).toHaveLength(2));
    expect(window.electronAPI.listLibraryItems).toHaveBeenCalledTimes(1);

    // Vault folder switched → the new folder is empty.
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [],
      vaultError: null,
      catalogVerifiedAt: null,
    }));
    await act(async () => notify?.());

    await waitFor(() => expect(result.current.videos).toHaveLength(0));
  });

  it("removeLocalCopy re-lists on success and reports a blocked reason", async () => {
    window.electronAPI.removeLocalCopy = vi.fn(async () => ({
      ok: false,
      reason: "edit-project" as const,
    }));
    const { result } = renderHook(() => useLocalLibrary());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      expect(await result.current.removeLocalCopy("a")).toEqual({
        ok: false,
        reason: "edit-project",
      });
    });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("removeLocalCopy re-lists after a successful removal", async () => {
    const { result } = renderHook(() => useLocalLibrary());
    await waitFor(() => expect(result.current.videos).toHaveLength(2));

    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [items[1]],
      vaultError: null,
      catalogVerifiedAt: null,
    }));

    await act(async () => {
      expect(await result.current.removeLocalCopy("a")).toEqual({ ok: true });
    });

    expect(result.current.videos).toHaveLength(1);
  });
});
