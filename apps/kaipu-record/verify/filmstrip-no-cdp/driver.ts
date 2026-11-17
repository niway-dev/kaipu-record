/**
 * Page side of the no-CDP memory check (NIW2-844 layer 2): starts the filmstrip probe worker
 * and runs the same explore requests as `verify/filmstrip-memory.verify.ts`, but with nothing
 * attached to the page, so no DevTools Network agent buffers the worker's responses. It keeps
 * no message: the memory measured is the worker's own. Never shipped.
 */
import { planSlots } from "../../src/renderer/src/features/video-editor/filmstrip-frames";

interface Driver {
  start: (decoder: "hardware" | "software") => Promise<void>;
  run: (from: number, to: number) => Promise<number>;
}

let worker: Worker | null = null;
let duration = 0;
let listener: ((message: { type: string; [key: string]: unknown }) => void) | null = null;

const wait = (predicate: (m: { type: string; [key: string]: unknown }) => boolean) =>
  new Promise<{ type: string; [key: string]: unknown }>((resolve, reject) => {
    listener = (m) => {
      if (m.type === "error" || m.type === "worker-error") reject(new Error(JSON.stringify(m)));
      else if (predicate(m)) resolve(m);
    };
  });

const driver: Driver = {
  start: async (decoder) => {
    worker = new Worker("/probe.js", { type: "module" });
    worker.onmessage = (event) => listener?.(event.data);
    worker.onerror = (event) =>
      listener?.({ type: "worker-error", message: String(event.message) });
    const info = wait((m) => m.type === "info-done");
    worker.postMessage({ type: "info", id: 1, url: "/take.mp4" });
    duration = (await info).duration as number;
    worker.postMessage({ type: "configure", decoder });
  },
  run: async (from, to) => {
    let posted = 0;
    for (let i = from; i < to; i++) {
      const centre = duration * Math.min(0.97, Math.max(0.03, (i * 0.618034 + 0.05) % 1));
      const requestId = 1000 + i;
      const done = wait((m) => m.type === "done" && m.requestId === requestId);
      worker!.postMessage({
        type: "request",
        requestId,
        fileKey: "take",
        url: "/take.mp4",
        slots: planSlots({
          duration,
          visible: { start: centre - 81.5, end: centre + 81.5 },
          tileSpan: 163 / 17,
          frames: [],
        }),
        playhead: centre,
        direction: i % 2 === 0 ? 1 : -1,
      });
      await done;
      posted += 1;
    }
    return posted;
  },
};

(window as unknown as { __driver: Driver }).__driver = driver;
