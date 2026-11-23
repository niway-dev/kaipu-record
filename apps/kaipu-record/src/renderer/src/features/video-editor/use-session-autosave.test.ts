import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialScene, type VideoScene } from "./scene";
import type { SlideAssetStore } from "./slide-assets";
import { captureException } from "@renderer/features/analytics";
import {
  EDIT_PROJECT_CLOUD_ONLY_MARKER,
  EDIT_PROJECT_UNAVAILABLE_MARKER,
} from "@shared/types/library-storage";
import { AUTOSAVE_DEBOUNCE_MS, useSessionAutosave } from "./use-session-autosave";

vi.mock("@renderer/features/analytics", () => ({ captureException: vi.fn() }));

const assetStoreRef = {
  current: { entries: () => [] } as unknown as SlideAssetStore,
};

let saved: { id: string; json: string }[] = [];

beforeEach(() => {
  vi.clearAllMocks();
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

function render(
  scene: VideoScene = OPENED,
  interacting = false,
  onKeptOnThisComputer?: (reason: "cloud-only" | "folder-busy") => void,
) {
  return renderHook(
    ({ scene: s, interacting: i }) =>
      useSessionAutosave("rec-1", s, i, assetStoreRef, { onKeptOnThisComputer }),
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

  it("says saving only while the write is in flight, then saved", async () => {
    let finish: () => void = () => {};
    const save = vi.fn(
      (id: string, json: string) =>
        new Promise<void>((resolve) => {
          saved.push({ id, json });
          finish = resolve;
        }),
    );
    window.electronAPI.saveVideoEditSession =
      save as typeof window.electronAPI.saveVideoEditSession;
    const { result, rerender } = render();
    expect(result.current.state).toBe("idle");
    rerender({ scene: { ...OPENED, zoomSensitivity: 65 }, interacting: false });
    // Edited, not written yet: nothing is being saved, so the chip says nothing.
    expect(result.current.state).toBe("idle");
    expect(result.current.pendingRef.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    });
    expect(save).toHaveBeenCalledOnce();
    expect(result.current.state).toBe("saving");
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(result.current.state).toBe("saved");
  });

  it("goes quiet, not saving, when a write lands after a newer edit", async () => {
    let finish: () => void = () => {};
    window.electronAPI.saveVideoEditSession = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    ) as typeof window.electronAPI.saveVideoEditSession;
    const { result, rerender } = render();
    rerender({ scene: { ...OPENED, zoomSensitivity: 65 }, interacting: false });
    act(() => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    });
    expect(result.current.state).toBe("saving");
    // A drag starts while the write is still in flight.
    rerender({ scene: { ...OPENED, zoomSensitivity: 70 }, interacting: true });
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(result.current.state).toBe("idle");
    expect(result.current.pendingRef.current).toBe(true);
  });

  it("lets only the latest of two overlapping writes set the state", async () => {
    const finishers: Array<() => void> = [];
    window.electronAPI.saveVideoEditSession = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishers.push(resolve);
        }),
    ) as typeof window.electronAPI.saveVideoEditSession;
    const { result, rerender } = render();
    rerender({ scene: { ...OPENED, zoomSensitivity: 65 }, interacting: false });
    act(() => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    });
    // A second edit's write starts while the first is still in flight.
    rerender({ scene: { ...OPENED, zoomSensitivity: 70 }, interacting: false });
    act(() => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    });
    expect(finishers).toHaveLength(2);
    // The first write lands while the second is still being written.
    await act(async () => {
      finishers[0]();
      await Promise.resolve();
    });
    expect(result.current.state).toBe("saving");
    await act(async () => {
      finishers[1]();
      await Promise.resolve();
    });
    expect(result.current.state).toBe("saved");
    expect(result.current.pendingRef.current).toBe(false);
  });

  it("keeps saved when an older write lands after the newer one", async () => {
    const finishers: Array<() => void> = [];
    window.electronAPI.saveVideoEditSession = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishers.push(resolve);
        }),
    ) as typeof window.electronAPI.saveVideoEditSession;
    const { result, rerender } = render();
    rerender({ scene: { ...OPENED, zoomSensitivity: 65 }, interacting: false });
    act(() => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    });
    rerender({ scene: { ...OPENED, zoomSensitivity: 70 }, interacting: false });
    act(() => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    });
    await act(async () => {
      finishers[1]();
      await Promise.resolve();
    });
    expect(result.current.state).toBe("saved");
    await act(async () => {
      finishers[0]();
      await Promise.resolve();
    });
    expect(result.current.state).toBe("saved");
  });

  it("drops a stale saved while a drag edits, and stays silent until the write", async () => {
    window.electronAPI.saveVideoEditSession = vi.fn(
      async () => {},
    ) as typeof window.electronAPI.saveVideoEditSession;
    const { result, rerender } = render();
    rerender({ scene: { ...OPENED, zoomSensitivity: 65 }, interacting: false });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      await Promise.resolve();
    });
    expect(result.current.state).toBe("saved");
    rerender({ scene: { ...OPENED, zoomSensitivity: 70 }, interacting: true });
    expect(result.current.state).toBe("idle");
    rerender({ scene: { ...OPENED, zoomSensitivity: 75 }, interacting: true });
    expect(result.current.state).toBe("idle");
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

  it("a save refused during Check and fix files stays pending and is retried when it ends", async () => {
    let refuse = true;
    let ended: (() => void) | null = null;
    window.electronAPI = {
      saveVideoEditSession: async (id: string, json: string) => {
        if (refuse) throw new Error("vault-maintenance: Kaipu is fixing your files");
        saved.push({ id, json });
      },
      onLibraryMaintenanceEnded: (callback: () => void) => {
        ended = callback;
        return () => (ended = null);
      },
    } as unknown as typeof window.electronAPI;
    const { result, rerender } = render();
    rerender({ scene: { ...OPENED, zoomSensitivity: 61 }, interacting: false });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    });
    expect(saved).toHaveLength(0);
    expect(result.current.pendingRef.current).toBe(true);

    refuse = false;
    await act(async () => {
      ended!();
    });
    expect(saved).toHaveLength(1);
    expect(JSON.parse(saved[0].json).scene.zoomSensitivity).toBe(61);
    expect(result.current.pendingRef.current).toBe(false);
  });

  describe("a save the synced folder refuses (NIW2-912 second review)", () => {
    const cloudOnly = new Error(
      `${EDIT_PROJECT_UNAVAILABLE_MARKER} ${EDIT_PROJECT_CLOUD_ONLY_MARKER}: not saved`,
    );
    const folderBusy = new Error(`${EDIT_PROJECT_UNAVAILABLE_MARKER}: not saved`);

    async function edit(rerender: ReturnType<typeof render>["rerender"], value: number) {
      rerender({ scene: { ...OPENED, zoomSensitivity: value }, interacting: false });
      await act(async () => {
        vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
        await Promise.resolve();
      });
    }

    it("says once that the edits are kept on this computer, and is no fault to report", async () => {
      window.electronAPI.saveVideoEditSession = vi.fn().mockRejectedValue(cloudOnly);
      const kept = vi.fn();
      const { result, rerender } = render(OPENED, false, kept);
      await edit(rerender, 61);
      await edit(rerender, 62);
      await edit(rerender, 63);
      expect(result.current.state).toBe("failed");
      expect(result.current.pendingRef.current).toBe(true);
      expect(kept).toHaveBeenCalledTimes(1);
      expect(kept).toHaveBeenCalledWith("cloud-only");
      expect(captureException).not.toHaveBeenCalled();
    });

    it("tells a folder that does not answer apart from an offloaded file", async () => {
      window.electronAPI.saveVideoEditSession = vi.fn().mockRejectedValue(folderBusy);
      const kept = vi.fn();
      const { rerender } = render(OPENED, false, kept);
      await edit(rerender, 61);
      expect(kept).toHaveBeenCalledWith("folder-busy");
    });

    it("says it again after a save went through and a later one is refused", async () => {
      const save = vi
        .fn()
        .mockRejectedValueOnce(cloudOnly)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(cloudOnly);
      window.electronAPI.saveVideoEditSession =
        save as typeof window.electronAPI.saveVideoEditSession;
      const kept = vi.fn();
      const { rerender } = render(OPENED, false, kept);
      await edit(rerender, 61);
      await edit(rerender, 62);
      await edit(rerender, 63);
      expect(kept).toHaveBeenCalledTimes(2);
    });

    it("an ordinary failure is still reported", async () => {
      window.electronAPI.saveVideoEditSession = vi.fn().mockRejectedValue(new Error("disk"));
      const kept = vi.fn();
      const { rerender } = render(OPENED, false, kept);
      await edit(rerender, 61);
      expect(kept).not.toHaveBeenCalled();
      expect(captureException).toHaveBeenCalledTimes(1);
    });
  });
});
