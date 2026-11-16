import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CursorTrack } from "@shared/cursor-track";
import type { LibraryItem } from "@shared/types/library-item";
import type { WebcamTrackMeta } from "@shared/webcam-track";
import type { SceneSource } from "./scene";
import { useJoinedRecordings } from "./use-joined-recordings";

const WEBCAM: WebcamTrackMeta = {
  startOffsetMs: 0,
  offsetQuality: "exact",
  width: 1280,
  height: 720,
  fps: 30,
};
const TRACK: CursorTrack = {
  version: 1,
  display: { id: "1", width: 1600, height: 1000, scaleFactor: 2 },
  anchor: "exact",
  clicksAvailable: true,
  t: [0, 1000],
  x: [0.1, 0.2],
  y: [0.3, 0.4],
  clicks: [],
};

const source = (id: string, assetId: string): SceneSource => ({
  id,
  assetId,
  title: assetId,
  offset: 3600,
  durationSeconds: 30,
  width: 1920,
  height: 1080,
});

/** A Library item for a local recording, as `listLibraryItems` returns it (illustrative). */
function item(assetId: string, over: Partial<LibraryItem> = {}, webcam = false): LibraryItem {
  return {
    assetId,
    kind: "recording",
    title: assetId,
    capture: { mode: "screen", width: 1920, height: 1080, ratio: null },
    local: { id: `${assetId}-file`, assetId, kind: "recording", webcam: webcam ? WEBCAM : null },
    ...over,
  } as unknown as LibraryItem;
}

let items: LibraryItem[];
/** assetId → the id main acknowledges; absent = refused (null). */
let holds: Record<string, string>;
let cursorJson: Record<string, string>;
let acquire: ReturnType<typeof vi.fn>;
let close: ReturnType<typeof vi.fn>;
const original = { ...window.electronAPI };

beforeEach(() => {
  items = [];
  holds = {};
  cursorJson = {};
  acquire = vi.fn(async (assetId: string) => holds[assetId] ?? null);
  close = vi.fn();
  window.electronAPI.listLibraryItems = vi.fn(async () => ({
    items,
    vaultError: null,
    catalogVerifiedAt: null,
  })) as never;
  window.electronAPI.acquireEditorSession = acquire as never;
  window.electronAPI.closeEditorSession = close as never;
  window.electronAPI.loadCursorTrack = vi.fn(async (id: string) => cursorJson[id] ?? null) as never;
});
afterEach(() => {
  Object.assign(window.electronAPI, original);
});

describe("useJoinedRecordings", () => {
  it("returns nothing, and asks main for nothing, without sources", () => {
    const { result } = renderHook(() => useJoinedRecordings(undefined));
    expect(result.current).toEqual([]);
    expect(acquire).not.toHaveBeenCalled();
    expect(window.electronAPI.listLibraryItems).not.toHaveBeenCalled();
  });

  it("resolves the current id, holds it, and reads webcam, capture and cursor track", async () => {
    items = [item("b", {}, true)];
    holds = { b: "b-renamed" };
    cursorJson = { "b-renamed": JSON.stringify(TRACK) };
    const sources = [source("s1", "b")];
    const { result } = renderHook(() => useJoinedRecordings(sources));
    expect(result.current[0]).toMatchObject({ status: "loading", id: null });
    await waitFor(() => expect(result.current[0].status).toBe("ready"));
    expect(result.current[0]).toMatchObject({
      source: sources[0],
      id: "b-renamed",
      webcam: WEBCAM,
      capture: { width: 1920, height: 1080 },
      cursorTrack: TRACK,
    });
    expect(acquire).toHaveBeenCalledWith("b");
    expect(window.electronAPI.loadCursorTrack).toHaveBeenCalledWith("b-renamed");
  });

  it("a malformed or unreadable cursor track is null, and the recording is still ready", async () => {
    items = [item("b"), item("c")];
    holds = { b: "b-file", c: "c-file" };
    cursorJson = { "b-file": "{not json" };
    window.electronAPI.loadCursorTrack = vi.fn(async (id: string) => {
      if (id === "c-file") throw new Error("disk");
      return cursorJson[id] ?? null;
    }) as never;
    const sources = [source("s1", "b"), source("s2", "c")];
    const { result } = renderHook(() => useJoinedRecordings(sources));
    await waitFor(() => expect(result.current.every((r) => r.status === "ready")).toBe(true));
    expect(result.current.map((r) => r.cursorTrack)).toEqual([null, null]);
  });

  it("is missing, without throwing, for a gone asset, a cloud-only one and a refused hold", async () => {
    items = [item("cloud", { local: null }), item("refused"), item("shot", { kind: "screenshot" })];
    holds = {}; // main answers null for everything
    const sources = [
      source("s1", "gone"),
      source("s2", "cloud"),
      source("s3", "refused"),
      source("s4", "shot"),
    ];
    const { result } = renderHook(() => useJoinedRecordings(sources));
    await waitFor(() => expect(result.current.every((r) => r.status === "missing")).toBe(true));
    expect(result.current.map((r) => r.id)).toEqual([null, null, null, null]);
    // Only the asset that exists locally was ever asked for a hold.
    expect(acquire.mock.calls).toEqual([["refused"]]);
  });

  it("is missing when acquiring throws or the library cannot be read", async () => {
    items = [item("b")];
    acquire.mockRejectedValueOnce(new Error("ambiguous"));
    const sources = [source("s1", "b")];
    const first = renderHook(() => useJoinedRecordings(sources));
    await waitFor(() => expect(first.result.current[0].status).toBe("missing"));

    window.electronAPI.listLibraryItems = vi.fn(async () => {
      throw new Error("vault");
    }) as never;
    const second = renderHook(() => useJoinedRecordings(sources));
    await waitFor(() => expect(second.result.current[0].status).toBe("missing"));
  });

  it("a failed library read is retried on the next scene change, not remembered as gone", async () => {
    items = [item("b")];
    holds = { b: "b-file" };
    const list = window.electronAPI.listLibraryItems as unknown as ReturnType<typeof vi.fn>;
    list.mockRejectedValueOnce(new Error("ipc hiccup"));
    let sources = [source("s1", "b")];
    const { result, rerender } = renderHook(() => useJoinedRecordings(sources));
    await waitFor(() => expect(result.current[0].status).toBe("missing"));
    expect(acquire).not.toHaveBeenCalled();

    sources = [...sources]; // the scene changed (a new array): the failed source is read again
    rerender();
    await waitFor(() => expect(result.current[0].status).toBe("ready"));
    expect(result.current[0].id).toBe("b-file");
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("a source that is truly absent from the library stays missing and is not read again", async () => {
    items = [];
    let sources = [source("s1", "gone")];
    const { result, rerender } = renderHook(() => useJoinedRecordings(sources));
    await waitFor(() => expect(result.current[0].status).toBe("missing"));

    sources = [...sources];
    rerender();
    expect(window.electronAPI.listLibraryItems).toHaveBeenCalledTimes(1);
    expect(result.current[0].status).toBe("missing");
  });

  it("asks main for no hold when the source left the scene while the library was being read", async () => {
    items = [item("b")];
    holds = { b: "b-file" };
    let finish: () => void = () => {};
    window.electronAPI.listLibraryItems = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ items, vaultError: null, catalogVerifiedAt: null });
        }),
    ) as never;
    let sources = [source("s1", "b")];
    const { rerender } = renderHook(() => useJoinedRecordings(sources));
    await waitFor(() => expect(window.electronAPI.listLibraryItems).toHaveBeenCalled());

    sources = []; // undone before the read answered
    rerender();
    finish();
    await new Promise((r) => setTimeout(r, 20));
    expect(acquire).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("loads a newly joined source without reloading the others", async () => {
    items = [item("b"), item("c")];
    holds = { b: "b-file", c: "c-file" };
    let sources = [source("s1", "b")];
    const { result, rerender } = renderHook(() => useJoinedRecordings(sources));
    await waitFor(() => expect(result.current[0].status).toBe("ready"));
    expect(acquire).toHaveBeenCalledTimes(1);

    sources = [...sources, source("s2", "c")];
    rerender();
    expect(result.current.map((r) => r.status)).toEqual(["ready", "loading"]);
    await waitFor(() => expect(result.current[1].status).toBe("ready"));
    expect(result.current.map((r) => r.id)).toEqual(["b-file", "c-file"]);
    expect(acquire.mock.calls).toEqual([["b"], ["c"]]);
  });

  it("releases the hold of a source that leaves the scene, and every hold on unmount", async () => {
    items = [item("b"), item("c")];
    holds = { b: "b-file", c: "c-file" };
    let sources = [source("s1", "b"), source("s2", "c")];
    const { result, rerender, unmount } = renderHook(() => useJoinedRecordings(sources));
    await waitFor(() => expect(result.current.every((r) => r.status === "ready")).toBe(true));

    sources = [sources[0]]; // the join was undone
    rerender();
    expect(close).toHaveBeenCalledWith("c-file");
    expect(result.current.map((r) => r.source.id)).toEqual(["s1"]);

    unmount();
    expect(close).toHaveBeenCalledWith("b-file");
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("a hold that lands after the source left is released at once", async () => {
    items = [item("b")];
    let grant: (id: string) => void = () => {};
    acquire.mockImplementation(() => new Promise<string | null>((resolve) => (grant = resolve)));
    let sources = [source("s1", "b")];
    const { rerender } = renderHook(() => useJoinedRecordings(sources));
    await waitFor(() => expect(acquire).toHaveBeenCalled());

    sources = [];
    rerender();
    grant("b-file");
    await waitFor(() => expect(close).toHaveBeenCalledWith("b-file"));
  });
});
