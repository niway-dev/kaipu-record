import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryItem } from "@shared/types/library-item";
import { useSourceCaptures } from "./use-source-captures";

function item(over: Partial<LibraryItem>): LibraryItem {
  return {
    assetId: "a",
    kind: "screenshot",
    title: "t",
    createdAt: 1,
    durationSeconds: 0,
    derivedFromAssetId: null,
    sourceVideoAssetId: null,
    sourceTimeSeconds: null,
    ...over,
  } as LibraryItem;
}

let items: LibraryItem[];
let changed: (() => void) | null;
const original = { ...window.electronAPI };

beforeEach(() => {
  items = [];
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

describe("useSourceCaptures", () => {
  it("lists only this video's screenshots, newest first", async () => {
    items = [
      item({ assetId: "old", createdAt: 1, sourceVideoAssetId: "v1", sourceTimeSeconds: 3 }),
      item({ assetId: "other", createdAt: 2, sourceVideoAssetId: "v2", sourceTimeSeconds: 4 }),
      item({ assetId: "new", createdAt: 3, sourceVideoAssetId: "v1", sourceTimeSeconds: 9 }),
      item({ assetId: "export", createdAt: 4, kind: "recording", derivedFromAssetId: "v1" }),
      item({ assetId: "plain", createdAt: 5 }),
    ];
    const { result } = renderHook(() => useSourceCaptures("v1", true));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.captures.map((c) => c.assetId)).toEqual(["new", "old"]);
  });

  it("lists the captures of every asset it is given, and of no other", async () => {
    items = [
      item({ assetId: "opened", createdAt: 1, sourceVideoAssetId: "v1", sourceTimeSeconds: 3 }),
      item({ assetId: "joined", createdAt: 2, sourceVideoAssetId: "v2", sourceTimeSeconds: 4 }),
      item({ assetId: "stranger", createdAt: 3, sourceVideoAssetId: "v3", sourceTimeSeconds: 5 }),
    ];
    const { result } = renderHook(() => useSourceCaptures(["v1", "v2"], true));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.captures.map((c) => c.assetId)).toEqual(["joined", "opened"]);
  });

  it("does not read again when it is given an equal list of assets in a new array", async () => {
    const { rerender } = renderHook(({ ids }) => useSourceCaptures(ids, true), {
      initialProps: { ids: ["v1", "v2"] },
    });
    await waitFor(() => expect(window.electronAPI.listLibraryItems).toHaveBeenCalledTimes(1));
    rerender({ ids: ["v1", "v2"] });
    await Promise.resolve();
    expect(window.electronAPI.listLibraryItems).toHaveBeenCalledTimes(1);
  });

  it("passes the scene source a capture was taken from through to the capture", async () => {
    items = [
      item({
        assetId: "b2",
        createdAt: 2,
        sourceVideoAssetId: "v1",
        sourceTimeSeconds: 3,
        sourceSceneSourceId: "b2",
      } as Partial<LibraryItem>),
      item({ assetId: "opened", createdAt: 1, sourceVideoAssetId: "v1", sourceTimeSeconds: 4 }),
    ];
    const { result } = renderHook(() => useSourceCaptures("v1", true));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.captures.map((c) => c.sourceSceneSourceId)).toEqual(["b2", undefined]);
  });

  it("a refresh overtaken by a newer read resolves only once the newer list is on screen", async () => {
    const { result } = renderHook(() => useSourceCaptures("v1", true));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    // The first read hangs until released; a library:changed read starts after it.
    let releaseFirst: () => void = () => {};
    let releaseSecond: () => void = () => {};
    const respond = (wait: (r: () => void) => void) =>
      new Promise((resolve) =>
        wait(() => resolve({ items, vaultError: null, catalogVerifiedAt: null })),
      );
    window.electronAPI.listLibraryItems = vi
      .fn()
      .mockImplementationOnce(() => respond((r) => (releaseFirst = r)))
      .mockImplementationOnce(() => respond((r) => (releaseSecond = r))) as never;
    items = [item({ assetId: "n", createdAt: 9, sourceVideoAssetId: "v1", sourceTimeSeconds: 1 })];
    let done = false;
    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.refresh().then(() => {
        done = true;
      });
      changed?.();
    });
    await act(async () => {
      releaseFirst();
      await Promise.resolve();
    });
    expect(done).toBe(false);
    await act(async () => {
      releaseSecond();
      await first;
    });
    expect(done).toBe(true);
    expect(result.current.latest().map((c) => c.assetId)).toEqual(["n"]);
  });

  it("does not read the library while disabled", () => {
    const { result } = renderHook(() => useSourceCaptures("v1", false));
    expect(window.electronAPI.listLibraryItems).not.toHaveBeenCalled();
    expect(result.current.loaded).toBe(false);
  });

  it("re-reads on refresh and when the library changes", async () => {
    const { result } = renderHook(() => useSourceCaptures("v1", true));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.captures).toEqual([]);

    items = [item({ assetId: "n", createdAt: 9, sourceVideoAssetId: "v1", sourceTimeSeconds: 1 })];
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.captures.map((c) => c.assetId)).toEqual(["n"]);

    items = [];
    await act(async () => {
      changed?.();
    });
    await waitFor(() => expect(result.current.captures).toEqual([]));
  });

  it("keeps the previous list when a read fails", async () => {
    items = [item({ assetId: "n", createdAt: 9, sourceVideoAssetId: "v1", sourceTimeSeconds: 1 })];
    const { result } = renderHook(() => useSourceCaptures("v1", true));
    await waitFor(() => expect(result.current.captures).toHaveLength(1));
    window.electronAPI.listLibraryItems = vi.fn(async () => {
      throw new Error("vault");
    }) as never;
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.captures).toHaveLength(1);
  });
});
