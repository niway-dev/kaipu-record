import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useLocalLibrary } from "./use-local-library";
import { reportError } from "@renderer/features/analytics";
import type { LibraryItem } from "@shared/types/library-item";

vi.mock("@renderer/features/analytics", () => ({ reportError: vi.fn() }));

function localItem(
  over: Partial<LibraryItem> & { assetId: string; local: NonNullable<LibraryItem["local"]> },
): LibraryItem {
  return {
    kind: "recording",
    title: over.local.title,
    createdAt: over.local.createdAt,
    durationSeconds: over.local.durationSeconds,
    derivedFromAssetId: null,
    editSavedAt: null,
    cloud: null,
    availability: "local",
    transfer: { state: "idle" },
    comparison: "same",
    editing: "project-available",
    sharing: "private",
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
  editSavedAt: null,
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
    window.electronAPI.renameLocalRecording = vi.fn(async () => {});
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
    const refreshCloudCatalog = vi.fn(async () => ({ ok: true as const, verifiedAt: 1 }));
    window.electronAPI.refreshCloudCatalog = refreshCloudCatalog;

    const { result } = renderHook(() => useLocalLibrary());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(refreshCloudCatalog).toHaveBeenCalledTimes(1);
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
      await result.current.rename("a", "New");
    });

    expect(reportError).toHaveBeenCalledWith(
      expect.stringMatching(/rename/i),
      expect.any(Error),
      expect.anything(),
    );
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
