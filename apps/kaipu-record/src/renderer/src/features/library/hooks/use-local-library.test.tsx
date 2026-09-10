import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useLocalLibrary } from "./use-local-library";
import { reportError } from "@renderer/features/analytics";
import type { LocalRecording } from "@shared/types";

vi.mock("@renderer/features/analytics", () => ({ reportError: vi.fn() }));

const recordings: LocalRecording[] = [
  {
    id: "a",
    assetId: "00000000-0000-0000-0000-000000000001",
    title: "A",
    filePath: "/vault/a.webm",
    createdAt: 2000,
    sizeBytes: 100,
    durationSeconds: 10,
    thumbnailUrl: null,
    kind: "recording",
    derivedFromAssetId: null,
    contentSha256: null,
  },
  {
    id: "b",
    assetId: "00000000-0000-0000-0000-000000000002",
    title: "B",
    filePath: "/vault/b.webm",
    createdAt: 1000,
    sizeBytes: 200,
    durationSeconds: 20,
    thumbnailUrl: null,
    kind: "recording",
    derivedFromAssetId: null,
    contentSha256: null,
  },
];

describe("useLocalLibrary", () => {
  beforeEach(() => {
    vi.mocked(reportError).mockClear();
    window.electronAPI.listLocalRecordings = vi.fn(async () => recordings);
    window.electronAPI.deleteLocalRecording = vi.fn(async () => {});
    window.electronAPI.renameLocalRecording = vi.fn(async () => {});
    window.electronAPI.onLibraryChanged = () => () => {};
  });

  it("maps local recordings to library videos tagged as local", async () => {
    const { result } = renderHook(() => useLocalLibrary());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.videos).toHaveLength(2);
    expect(result.current.videos[0]).toMatchObject({
      id: "a",
      title: "A",
      fileSizeBytes: 100,
      durationSeconds: 10,
      storage: "local",
    });
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

  it("flags an error (without blanking to the empty state) when the vault can't be read", async () => {
    window.electronAPI.listLocalRecordings = vi.fn(async () => {
      throw new Error("ENOENT: drive unreachable");
    });
    const { result } = renderHook(() => useLocalLibrary());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasError).toBe(true);
    expect(reportError).toHaveBeenCalledWith(
      expect.stringMatching(/folder/i),
      expect.any(Error),
      expect.objectContaining({ retry: expect.any(Function) }),
    );
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
    expect(window.electronAPI.listLocalRecordings).toHaveBeenCalledTimes(1);

    // Vault folder switched → the new folder is empty.
    window.electronAPI.listLocalRecordings = vi.fn(async () => []);
    await act(async () => notify?.());

    await waitFor(() => expect(result.current.videos).toHaveLength(0));
  });
});
