import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialScene, type VideoScene } from "./scene";
import type { SlideAssetStore } from "./slide-assets";
import { AUTOSAVE_DEBOUNCE_MS, useSessionAutosave } from "./use-session-autosave";

const assetStoreRef = {
  current: { entries: () => [] } as unknown as SlideAssetStore,
};

let saved: { id: string; json: string }[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  saved = [];
  window.electronAPI = {
    saveVideoEditSession: async (id: string, json: string) => {
      saved.push({ id, json });
    },
  } as unknown as typeof window.electronAPI;
});

afterEach(() => {
  vi.useRealTimers();
});

const OPENED = initialScene(10);

function render(scene: VideoScene = OPENED, interacting = false) {
  return renderHook(
    ({ scene: s, interacting: i }) => useSessionAutosave("rec-1", s, i, assetStoreRef),
    { initialProps: { scene, interacting } },
  );
}

describe("useSessionAutosave", () => {
  it("never writes the scene the editor opened with", async () => {
    render();
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(saved).toEqual([]);
  });

  it("writes once, debounced, after an edit", async () => {
    const { rerender } = render();
    rerender({ scene: { ...OPENED, zoomSensitivity: 60 }, interacting: false });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS - 1);
    });
    expect(saved).toHaveLength(0);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(saved).toHaveLength(1);
    expect(JSON.parse(saved[0].json).scene.zoomSensitivity).toBe(60);
  });

  it("collapses a burst of edits into one write", async () => {
    const { rerender } = render();
    for (const value of [56, 57, 58]) {
      rerender({ scene: { ...OPENED, zoomSensitivity: value }, interacting: false });
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
    }
    expect(saved).toHaveLength(0);
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    });
    expect(saved).toHaveLength(1);
    expect(JSON.parse(saved[0].json).scene.zoomSensitivity).toBe(58);
  });

  it("does not write while a drag owns the scene, and writes once it ends", async () => {
    const { rerender } = render();
    rerender({ scene: { ...OPENED, zoomSensitivity: 61 }, interacting: true });
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(saved).toHaveLength(0);
    rerender({ scene: { ...OPENED, zoomSensitivity: 61 }, interacting: false });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    });
    expect(saved).toHaveLength(1);
  });

  it("flushes the pending write on unmount (closing the window)", async () => {
    const { rerender, unmount } = render();
    rerender({ scene: { ...OPENED, zoomSensitivity: 62 }, interacting: false });
    await act(async () => {
      unmount();
    });
    expect(saved).toHaveLength(1);
    expect(JSON.parse(saved[0].json).scene.zoomSensitivity).toBe(62);
  });

  it("flushes on beforeunload", async () => {
    const { rerender } = render();
    rerender({ scene: { ...OPENED, zoomSensitivity: 63 }, interacting: false });
    await act(async () => {
      window.dispatchEvent(new Event("beforeunload"));
    });
    expect(saved).toHaveLength(1);
  });

  it("cancel() drops the pending write, unmount included", async () => {
    const { result, rerender, unmount } = render();
    rerender({ scene: { ...OPENED, zoomSensitivity: 64 }, interacting: false });
    act(() => result.current.cancel());
    await act(async () => {
      vi.advanceTimersByTime(5000);
      unmount();
    });
    expect(saved).toEqual([]);
  });

  it("exposes saving → saved around a successful write", async () => {
    const save = vi.fn(async (id: string, json: string) => {
      saved.push({ id, json });
    });
    window.electronAPI.saveVideoEditSession =
      save as typeof window.electronAPI.saveVideoEditSession;
    const { result, rerender } = render();
    expect(result.current.state).toBe("idle");
    rerender({ scene: { ...OPENED, zoomSensitivity: 65 }, interacting: false });
    expect(result.current.state).toBe("saving");
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalledOnce();
    expect(result.current.state).toBe("saved");
  });

  it("exposes failed when the write rejects, and retry() writes again", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("disk")).mockResolvedValue(undefined);
    window.electronAPI.saveVideoEditSession =
      save as typeof window.electronAPI.saveVideoEditSession;
    const { result, rerender } = render();
    rerender({ scene: { ...OPENED, zoomSensitivity: 66 }, interacting: false });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await Promise.resolve();
    });
    expect(result.current.state).toBe("failed");
    expect(result.current.pendingRef.current).toBe(true);
    await act(async () => {
      await result.current.retry();
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe("saved");
  });
});
