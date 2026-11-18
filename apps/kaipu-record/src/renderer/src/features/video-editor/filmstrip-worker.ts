/**
 * The filmstrip worker (ADR 0064, layer 2): decodes thumbnails for the slots the editor asks
 * for, off the main thread, one job at a time. It owns no policy of its own: the queue order,
 * the packet cap, the one open file, the idle close and the pacing are in `filmstrip-engine.ts`
 * and `filmstrip-plan.ts`, where they are tested; the container and decoder are bound in
 * `filmstrip-mediabunny.ts`. No DOM here.
 *
 * The message API is `filmstrip-messages.ts`. Start it with
 * `new Worker(new URL("./filmstrip-worker.ts", import.meta.url), { type: "module" })`.
 */
import { FilmstripEngine } from "./filmstrip-engine";
import { mediabunnyOpener } from "./filmstrip-mediabunny";
import {
  DEFAULT_DECODER,
  type FilmstripWorkerInput,
  type FilmstripWorkerOutput,
} from "./filmstrip-messages";

type WorkerSelf = typeof self & {
  onmessage: ((event: MessageEvent<FilmstripWorkerInput>) => void) | null;
  postMessage(message: FilmstripWorkerOutput): void;
};

const workerSelf = self as unknown as WorkerSelf;

const engine = new FilmstripEngine({
  opener: mediabunnyOpener,
  decoder: DEFAULT_DECODER,
  post: (message) => workerSelf.postMessage(message),
});

workerSelf.onmessage = (event) => engine.handle(event.data);
