/**
 * Probe only (NIW2-844 layer 2 memory follow-up): the SAME engine and mediabunny adapter the
 * worker uses, run on the page's main thread instead. It answers the control question "is the
 * memory the worker's, or the decoder's wherever it runs?". It stands in for the worker the
 * memory scenario drives (`window.__probe.worker.postMessage`), so the scenario is identical.
 * Never shipped.
 */
import { ALL_FORMATS, Input } from "mediabunny";
import { FilmstripEngine } from "../../src/renderer/src/features/video-editor/filmstrip-engine";
import {
  createFilmstripUrlSource,
  mediabunnyOpener,
} from "../../src/renderer/src/features/video-editor/filmstrip-mediabunny";
import { DEFAULT_DECODER } from "../../src/renderer/src/features/video-editor/filmstrip-messages";
import { readWorkerMem } from "./mem";

const store: { messages: unknown[]; worker: unknown } = { messages: [], worker: null };
const engine = new FilmstripEngine({
  opener: mediabunnyOpener,
  decoder: DEFAULT_DECODER,
  post: (message) => store.messages.push(message),
});

async function info(url: string, id: number): Promise<void> {
  const input = new Input({ source: createFilmstripUrlSource(url), formats: ALL_FORMATS });
  try {
    store.messages.push({ type: "info-done", id, duration: await input.computeDuration() });
  } finally {
    input.dispose();
  }
}

store.worker = {
  postMessage: (message: { type: string; id?: number; url?: string }) => {
    if (message.type === "mem") {
      store.messages.push({ type: "mem-done", id: message.id, ...readWorkerMem() });
    } else if (message.type === "info") {
      void info(message.url ?? "", message.id ?? 0);
    } else {
      engine.handle(message as Parameters<FilmstripEngine["handle"]>[0]);
    }
  },
  terminate: () => {
    void engine.dispose();
  },
};
(window as unknown as { __probe: typeof store }).__probe = store;
