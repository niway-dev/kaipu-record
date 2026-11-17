import { describe, expect, it } from "vitest";
import {
  FilmstripController,
  REST_MS,
  type FilmstripTarget,
  type FilmstripWorkerPort,
} from "./filmstrip-controller";
import { FilmstripStore, type FilmstripTimers } from "./filmstrip-store";
import type {
  FilmstripRequestMessage,
  FilmstripWorkerInput,
  FilmstripWorkerOutput,
} from "./filmstrip-messages";
import type { TimelineView } from "./components/timeline-view";

function fakeTimers() {
  let now = 1000;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: FilmstripTimers = {
    now: () => now,
    set: (fn, ms) => {
      const id = nextId++;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clear: (handle) => {
      pending.delete(handle as number);
    },
  };
  return {
    timers,
    advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const due = [...pending]
          .filter(([, t]) => t.at <= target)
          .sort((a, b) => a[1].at - b[1].at);
        if (due.length === 0) break;
        const [id, t] = due[0];
        pending.delete(id);
        now = Math.max(now, t.at);
        t.fn();
      }
      now = target;
    },
  };
}

class FakeWorker implements FilmstripWorkerPort {
  sent: FilmstripWorkerInput[] = [];
  terminated = false;
  onmessage: ((event: { data: FilmstripWorkerOutput }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  postMessage(message: FilmstripWorkerInput): void {
    this.sent.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(message: FilmstripWorkerOutput): void {
    this.onmessage?.({ data: message });
  }
  get requests(): FilmstripRequestMessage[] {
    return this.sent.filter((m): m is FilmstripRequestMessage => m.type === "request");
  }
}

const URL_A = "kaipu-media://recording/a";
const URL_B = "kaipu-media://webcam/a";

/** 30-minute take, a 1000 px lane, zoomed to 2,000%. */
function zoomedView(scroll = 0): TimelineView {
  return { zoom: 20, scroll, laneWidth: 1000, duration: 1800 };
}

function target(overrides: Partial<FilmstripTarget> = {}): FilmstripTarget {
  return {
    fileKey: URL_A,
    duration: 1800,
    fileOffset: 0,
    clips: [{ timelineStart: 0, timelineEnd: 1800, sourceStart: 0, sourceEnd: 1800 }],
    legacy: [],
    ...overrides,
  };
}

function setup(options: { view?: () => TimelineView; terminateOnIdleClose?: boolean } = {}) {
  const clock = fakeTimers();
  const workers: FakeWorker[] = [];
  const store = new FilmstripStore({
    createUrl: () => "blob:x",
    revokeUrl: () => {},
    timers: clock.timers,
  });
  let view = zoomedView();
  const controller = new FilmstripController({
    store,
    createWorker: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
    getView: options.view ?? (() => view),
    timers: clock.timers,
    terminateOnIdleClose: options.terminateOnIdleClose,
  });
  return {
    controller,
    store,
    clock,
    workers,
    setView(next: TimelineView) {
      view = next;
      controller.viewChanged();
    },
    done(worker: FakeWorker, requestId: number, fileKey: string) {
      worker.emit({
        type: "done",
        requestId,
        fileKey,
        outcome: "complete",
        frames: 0,
        skippedNoFrame: 0,
        skippedOverCap: 0,
        failed: 0,
        openedFile: false,
        openMs: 0,
        elapsedMs: 1,
      });
    },
  };
}

describe("FilmstripController", () => {
  it("asks for nothing until the view has rested for 120 ms, then asks once", () => {
    const { controller, clock, workers } = setup();
    controller.setTargets([target()]);
    clock.advance(REST_MS - 1);
    expect(workers).toHaveLength(0);
    clock.advance(1);
    expect(workers).toHaveLength(1);
    expect(workers[0].requests).toHaveLength(1);
    expect(workers[0].requests[0].fileKey).toBe(URL_A);
    expect(workers[0].requests[0].url).toBe(URL_A);
  });

  it("AC1/AC2 input: at 2,000% on a 30-minute take it plans 4 s slots around the view, all inside the file", () => {
    const { controller, clock, workers } = setup();
    controller.setTargets([target()]);
    clock.advance(REST_MS);
    const [request] = workers[0].requests;
    const visible = request.slots.filter((s) => s.visible);
    // 90 s are shown (1000 px at 20x of 1800 s): 4 s slots, 23 of them, none planned past 90 s.
    expect(visible.length).toBeGreaterThanOrEqual(22);
    expect(visible.length).toBeLessThanOrEqual(24);
    for (const slot of request.slots) {
      expect(slot.end - slot.start).toBe(4);
      expect(slot.start).toBeGreaterThanOrEqual(0);
      expect(slot.end).toBeLessThanOrEqual(1800);
    }
    expect(Math.max(...visible.map((s) => s.end))).toBeGreaterThanOrEqual(90);
    expect(request.slots.length).toBeLessThanOrEqual(192);
  });

  it("AC3: at fit zoom it asks for nothing", () => {
    const { controller, clock, workers } = setup({
      view: () => ({ zoom: 1, scroll: 0, laneWidth: 1000, duration: 1800 }),
    });
    controller.setTargets([target()]);
    clock.advance(1000);
    expect(workers).toHaveLength(0);
  });

  it("AC7: scrolling without stopping starts no decode, and the job in flight is cancelled", () => {
    const { controller, clock, workers, setView } = setup();
    controller.setTargets([target()]);
    clock.advance(REST_MS);
    const worker = workers[0];
    const first = worker.requests[0];
    expect(first).toBeDefined();

    // Scroll for two seconds, a tick every 50 ms: never 120 ms of rest.
    for (let i = 1; i <= 40; i++) {
      setView(zoomedView(i * 30));
      clock.advance(50);
    }
    expect(worker.requests).toHaveLength(1);
    expect(worker.sent.filter((m) => m.type === "cancel")).toEqual([
      { type: "cancel", requestId: first.requestId },
    ]);

    // The view rests: one new request, nearest the new place, moving right.
    worker.emit({
      type: "done",
      requestId: first.requestId,
      fileKey: URL_A,
      outcome: "cancelled",
      frames: 0,
      skippedNoFrame: 0,
      skippedOverCap: 0,
      failed: 0,
      openedFile: false,
      openMs: 0,
      elapsedMs: 1,
    });
    clock.advance(REST_MS);
    expect(worker.requests).toHaveLength(2);
    expect(worker.requests[1].direction).toBe(1);
  });

  it("AC6: nothing is requested while paused, the job is stopped, and it resumes after a rest", () => {
    const { controller, clock, workers } = setup();
    controller.setTargets([target()]);
    clock.advance(REST_MS);
    const worker = workers[0];
    controller.setPaused(true);
    expect(worker.sent.at(-1)).toEqual({ type: "close" });

    controller.viewChanged();
    controller.setTargets([target()]);
    clock.advance(5000);
    expect(worker.requests).toHaveLength(1);

    controller.setPaused(false);
    clock.advance(REST_MS - 1);
    expect(worker.requests).toHaveLength(1);
    clock.advance(1);
    expect(worker.requests).toHaveLength(2);
  });

  it("asks for the files of several lanes one after another, never two at once", () => {
    const { controller, clock, workers, done } = setup();
    controller.setTargets([target(), target({ fileKey: URL_B })]);
    clock.advance(REST_MS);
    const worker = workers[0];
    expect(worker.requests.map((r) => r.fileKey)).toEqual([URL_A]);
    done(worker, worker.requests[0].requestId, URL_A);
    expect(worker.requests.map((r) => r.fileKey)).toEqual([URL_A, URL_B]);
  });

  it("does not ask for slots a stored or an opening frame already fills", () => {
    const { controller, clock, workers, store } = setup();
    // Slot [0, 4) holds a legacy frame; slot [4, 8) a stored one.
    store.add(URL_A, { timestamp: 5, blob: new Blob(), bytes: 3 });
    controller.setTargets([target({ legacy: [{ timestamp: 1 }] })]);
    clock.advance(REST_MS);
    const starts = workers[0].requests[0].slots.map((s) => s.start);
    expect(starts).not.toContain(0);
    expect(starts).not.toContain(4);
    expect(starts).toContain(8);
  });

  it("plans the file's own time: a file offset moves the slots, and a clip bounds them", () => {
    const { controller, clock, workers } = setup();
    controller.setTargets([
      target({
        fileOffset: 10, // the file starts 10 s after the source axis
        clips: [{ timelineStart: 0, timelineEnd: 1800, sourceStart: 100, sourceEnd: 1800 }],
        duration: 1790,
      }),
    ]);
    clock.advance(REST_MS);
    const slots = workers[0].requests[0].slots;
    // Nothing before the clip's start in the file's time (100 − 10 = 90), and nothing below 0.
    expect(Math.min(...slots.map((s) => s.start))).toBeGreaterThanOrEqual(88);
  });

  it("skips a file with an unknown duration", () => {
    const { controller, clock, workers } = setup();
    controller.setTargets([target({ duration: Infinity })]);
    clock.advance(1000);
    expect(workers).toHaveLength(0);
  });

  it("stores the frames a request posts, and drops those of a request from before a reset", () => {
    const { controller, clock, workers, store } = setup();
    controller.setTargets([target()]);
    clock.advance(REST_MS);
    const worker = workers[0];
    const id = worker.requests[0].requestId;
    const frame = (timestamp: number): FilmstripWorkerOutput => ({
      type: "frame",
      requestId: id,
      fileKey: URL_A,
      slotIndex: 0,
      timestamp,
      blob: new Blob(),
      bytes: 3000,
      decodeMs: 1,
      encodeMs: 1,
    });
    worker.emit(frame(2));
    expect(store.liveFrames(URL_A).map((f) => f.timestamp)).toEqual([2]);

    // AC10: a workspace switch empties the store and closes the file; a late frame is dropped.
    controller.reset();
    expect(store.liveFrames(URL_A)).toHaveLength(0);
    expect(worker.sent.at(-1)).toEqual({ type: "close" });
    worker.emit(frame(3));
    expect(store.liveFrames(URL_A)).toHaveLength(0);
  });

  it("terminates the worker when its file closes for being idle, if told to, and starts a new one next time", () => {
    const { controller, clock, workers } = setup({ terminateOnIdleClose: true });
    controller.setTargets([target()]);
    clock.advance(REST_MS);
    const first = workers[0];
    first.emit({ type: "file", event: "closed", url: URL_A, reason: "idle" });
    expect(first.terminated).toBe(true);

    controller.viewChanged();
    clock.advance(REST_MS);
    expect(workers).toHaveLength(2);
    expect(workers[1].requests).toHaveLength(1);
  });

  it("keeps the worker after an idle close by default (hardware decoding)", () => {
    const { controller, clock, workers } = setup();
    controller.setTargets([target()]);
    clock.advance(REST_MS);
    workers[0].emit({ type: "file", event: "closed", url: URL_A, reason: "idle" });
    expect(workers[0].terminated).toBe(false);
  });

  it("dispose ends the worker and starts nothing more", () => {
    const { controller, clock, workers } = setup();
    controller.setTargets([target()]);
    clock.advance(REST_MS);
    controller.dispose();
    expect(workers[0].terminated).toBe(true);
    controller.viewChanged();
    clock.advance(1000);
    expect(workers).toHaveLength(1);
  });
});
