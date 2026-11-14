import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryItem } from "@shared/types/library-item";
import { useLibraryRecordings } from "./use-library-recordings";

function item(assetId: string, over: Partial<LibraryItem> = {}): LibraryItem {
  return {
    assetId,
    kind: "recording",
    title: assetId,
    createdAt: 1,
    durationSeconds: 5,
    derivedFromAssetId: null,
    sourceVideoAssetId: null,
    sourceTimeSeconds: null,
    local: { id: assetId },
    ...over,
  } as LibraryItem;
}

let items: LibraryItem[];
let changed: (() => void) | null;
const original = { ...window.electronAPI };

beforeEach(() => {
  items = [item("a")];
  changed = null;
  window.electronAPI.listLibraryItems = vi.fn(async () => ({
    items,
    vaultError: null,
    catalogVerifiedAt: null,
  })) as never;
  window.electronAPI.onLibraryChanged = (cb: () => void) => {
    changed = cb;
    return () => {
      changed = null;
    };
  };
});
afterEach(() => {
  Object.assign(window.electronAPI, original);
});

describe("useLibraryRecordings", () => {
  it("reads nothing while disabled, so a closed panel costs no Library read", () => {
    const { result } = renderHook(() => useLibraryRecordings(false));
    expect(window.electronAPI.listLibraryItems).not.toHaveBeenCalled();
    expect(result.current).toEqual({ videos: [], loaded: false, failed: false });
  });

  it("reads the Library once when it turns on and maps the items", async () => {
    const { result } = renderHook(() => useLibraryRecordings(true));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(window.electronAPI.listLibraryItems).toHaveBeenCalledTimes(1);
    expect(result.current.videos.map((v) => v.assetId)).toEqual(["a"]);
    expect(result.current.videos[0].id).toBe("a");
  });

  it("reads again each time it turns back on, so the list is fresh on every open", async () => {
    const { result, rerender } = renderHook(({ on }) => useLibraryRecordings(on), {
      initialProps: { on: true },
    });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    rerender({ on: false });
    items = [item("a"), item("b")];
    rerender({ on: true });
    await waitFor(() => expect(result.current.videos.map((v) => v.assetId)).toEqual(["a", "b"]));
    expect(window.electronAPI.listLibraryItems).toHaveBeenCalledTimes(2);
  });

  it("re-reads when main says the Library changed while it is on", async () => {
    const { result } = renderHook(() => useLibraryRecordings(true));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    items = [item("a"), item("c")];
    act(() => changed?.());
    await waitFor(() => expect(result.current.videos.map((v) => v.assetId)).toEqual(["a", "c"]));
  });

  it("stops listening once it is off", async () => {
    const { result, rerender } = renderHook(({ on }) => useLibraryRecordings(on), {
      initialProps: { on: true },
    });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    rerender({ on: false });
    expect(changed).toBeNull();
  });

  it("ends loading with an empty list when the read fails, instead of loading for ever", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => {
      throw new Error("ipc down");
    }) as never;
    const { result } = renderHook(() => useLibraryRecordings(true));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.videos).toEqual([]);
    expect(result.current.failed).toBe(true);
  });

  it("keeps the items and flags failed when the vault cannot be read", async () => {
    window.electronAPI.listLibraryItems = vi.fn(async () => ({
      items: [item("cloud", { local: null })],
      vaultError: "EACCES",
      catalogVerifiedAt: null,
    })) as never;
    const { result } = renderHook(() => useLibraryRecordings(true));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.failed).toBe(true);
    expect(result.current.videos.map((v) => v.assetId)).toEqual(["cloud"]);
  });

  it("a clean read after a failed one clears failed", async () => {
    window.electronAPI.listLibraryItems = vi
      .fn()
      .mockRejectedValueOnce(new Error("ipc down"))
      .mockResolvedValue({ items, vaultError: null, catalogVerifiedAt: null }) as never;
    const { result } = renderHook(() => useLibraryRecordings(true));
    await waitFor(() => expect(result.current.failed).toBe(true));
    act(() => changed?.());
    await waitFor(() => expect(result.current.failed).toBe(false));
  });
});
