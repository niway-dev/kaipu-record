import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FilmstripWorkerInput } from "./filmstrip-messages";
import type { FilmstripWorkerPort } from "./filmstrip-controller";
import { REST_MS } from "./filmstrip-controller";
import type { FilmstripFileInput } from "./filmstrip-targets";
import { createTimelineViewStore } from "./use-timeline-view";
import { useFilmstrip } from "./use-filmstrip";

const workers: Array<FilmstripWorkerPort & { sent: FilmstripWorkerInput[]; terminated: boolean }> =
  [];

vi.mock("./filmstrip-service", async () => {
  const { FilmstripStore } = await import("./filmstrip-store");
  const store = new FilmstripStore({ createUrl: () => "blob:x", revokeUrl: () => {} });
  return {
    TERMINATE_WORKER_ON_IDLE_CLOSE: false,
    getFilmstripStore: () => store,
    createFilmstripWorker: () => {
      const worker = {
        sent: [] as FilmstripWorkerInput[],
        terminated: false,
        onmessage: null,
        onerror: null,
        postMessage(message: FilmstripWorkerInput) {
          this.sent.push(message);
        },
        terminate() {
          this.terminated = true;
        },
      };
      workers.push(worker);
      return worker;
    },
  };
});

const file: FilmstripFileInput = {
  binding: { fileKey: "kaipu-media://a", fileOffset: 0, legacyOffset: 0 },
  duration: 1800,
  entries: [
    {
      itemId: "c1",
      kind: "clip",
      timelineStart: 0,
      timelineEnd: 1800,
      sourceStart: 0,
      sourceEnd: 1800,
    },
  ],
  legacy: [],
};
const files = [file];

function zoomedStore() {
  const store = createTimelineViewStore();
  store.setDuration(1800);
  store.setLaneWidth(1000);
  store.zoomTo(20);
  return store;
}

beforeEach(() => {
  workers.length = 0;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useFilmstrip", () => {
  it("AC11: with the flag off it starts no worker, whatever the view does", () => {
    const viewStore = zoomedStore();
    renderHook(() =>
      useFilmstrip({ enabled: false, viewStore, files, paused: false, playheadSource: 0 }),
    );
    act(() => {
      viewStore.scrollTo(300, "user");
      vi.advanceTimersByTime(5000);
    });
    expect(workers).toHaveLength(0);
  });

  it("asks the worker once the view rests, from the view store and not from a render", () => {
    const viewStore = zoomedStore();
    renderHook(() =>
      useFilmstrip({ enabled: true, viewStore, files, paused: false, playheadSource: 0 }),
    );
    act(() => {
      vi.advanceTimersByTime(REST_MS);
    });
    expect(workers).toHaveLength(1);
    expect(workers[0].sent.filter((m) => m.type === "request")).toHaveLength(1);
  });

  it("AC7: a scroll every 50 ms starts no new request", () => {
    const viewStore = zoomedStore();
    renderHook(() =>
      useFilmstrip({ enabled: true, viewStore, files, paused: false, playheadSource: 0 }),
    );
    act(() => {
      vi.advanceTimersByTime(REST_MS);
    });
    for (let i = 1; i <= 20; i++) {
      act(() => {
        viewStore.scrollTo(i * 40, "user");
        vi.advanceTimersByTime(50);
      });
    }
    expect(workers[0].sent.filter((m) => m.type === "request")).toHaveLength(1);
  });

  it("AC6: playing stops decoding and nothing starts until it stops", () => {
    const viewStore = zoomedStore();
    const { rerender } = renderHook(
      ({ paused }) => useFilmstrip({ enabled: true, viewStore, files, paused, playheadSource: 0 }),
      { initialProps: { paused: false } },
    );
    act(() => {
      vi.advanceTimersByTime(REST_MS);
    });
    rerender({ paused: true });
    expect(workers[0].sent.at(-1)).toEqual({ type: "close" });
    act(() => {
      viewStore.scrollTo(400, "follow");
      vi.advanceTimersByTime(2000);
    });
    expect(workers[0].sent.filter((m) => m.type === "request")).toHaveLength(1);
    rerender({ paused: false });
    act(() => {
      vi.advanceTimersByTime(REST_MS);
    });
    expect(workers[0].sent.filter((m) => m.type === "request")).toHaveLength(2);
  });

  it("ends the worker when the editor unmounts", () => {
    const viewStore = zoomedStore();
    const { unmount } = renderHook(() =>
      useFilmstrip({ enabled: true, viewStore, files, paused: false, playheadSource: 0 }),
    );
    act(() => {
      vi.advanceTimersByTime(REST_MS);
    });
    unmount();
    expect(workers[0].terminated).toBe(true);
  });
});
