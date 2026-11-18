/**
 * The one frame store the editor's filmstrips share, and the worker factory (ADR 0064, layer 3).
 * The store outlives an editor window's mount on purpose: reopening a recording finds the frames
 * it already decoded. A workspace switch empties it (AC10, spec decision 10), whether or not an
 * editor is mounted then.
 */
import { DEFAULT_DECODER } from "./filmstrip-messages";
import type { FilmstripWorkerPort } from "./filmstrip-controller";
import { FilmstripStore } from "./filmstrip-store";

let store: FilmstripStore | null = null;

export function getFilmstripStore(): FilmstripStore {
  if (store) return store;
  const created = new FilmstripStore({
    createUrl: (blob) => URL.createObjectURL(blob),
    revokeUrl: (url) => URL.revokeObjectURL(url),
  });
  store = created;
  // Media of another workspace must never show in this one. `onChanged` fires after a switch
  // completes; the editor itself is closed before it (ADR 0032), so this runs with none mounted.
  window.electronAPI?.workspaces?.onChanged?.(() => created.clear());
  return created;
}

/** A fresh filmstrip worker. The URL form is what Vite bundles as a module worker. */
export function createFilmstripWorker(): FilmstripWorkerPort {
  return new Worker(new URL("./filmstrip-worker.ts", import.meta.url), {
    type: "module",
  }) as unknown as FilmstripWorkerPort;
}

/**
 * Whether the worker should be terminated when its file closes for being idle. The software
 * decoder keeps about 290 MB in the GPU process until the worker ends (layer 2 measured it);
 * hardware returns to baseline, so its worker stays (the owner's veto point, see the PR).
 */
export const TERMINATE_WORKER_ON_IDLE_CLOSE = DEFAULT_DECODER === "software";

/** Test seam: forget the shared store. */
export function __resetFilmstripStoreForTests(): void {
  store?.dispose();
  store = null;
}
