import type { PixelBuffer, PixelWindow } from "../pixel-buffer";
import type { ColorsRequest, ColorsResponse } from "./colors-messages";
import {
  analyzeColors,
  locateMask,
  regionsOf,
  type AreaBounds,
  type ColorAnalysis,
  type LocateTarget,
} from "./histogram";

/** The overlay for one located color, at the image's own size. */
export type LocatedImage = {
  matched: number;
  /** Connected regions of the match with at least `MIN_AREA_PX` pixels. */
  areas: number;
  /** Bounds, in image pixels, of the largest of those regions; null when there is none. */
  bounds: AreaBounds | null;
  width: number;
  height: number;
} & (
  | { bitmap: ImageBitmap; pixels?: undefined }
  | { pixels: Uint8ClampedArray; bitmap?: undefined }
);

export interface ColorsAnalyzer {
  /** The buffer this analyzer counted; a new buffer needs a new analyzer. */
  buffer: PixelBuffer;
  /** The part of it that was counted (a cropped base); a different window needs a new analyzer. */
  window?: PixelWindow;
  analysis: Promise<ColorAnalysis>;
  locate(target: LocateTarget): Promise<LocatedImage>;
  /** Stops the worker and frees its copy of the pixels. Pending calls reject. */
  dispose(): void;
}

/** Rejection of every call still pending when the analyzer is disposed: not an error. */
export class AnalyzerDisposed extends Error {
  constructor() {
    super("colors analyzer disposed");
    this.name = "AnalyzerDisposed";
  }
}

function newColorsWorker(): Worker {
  return new Worker(new URL("./colors-worker.ts", import.meta.url), { type: "module" });
}

/**
 * A copy of `buffer`'s pixels in which everything outside `win` is fully transparent. The
 * analysis counts only pixels with alpha above 0 and the locate mask never lights one, so a
 * cropped base's hidden pixels take no part, while the overlay keeps the whole asset's size
 * and so lines up with the image as before. Without `win` it is a plain copy.
 */
function visibleCopy(buffer: PixelBuffer, win?: PixelWindow): Uint8ClampedArray {
  const copy = buffer.data.slice();
  if (!win) return copy;
  const { width, height } = buffer;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    if (y < win.y0 || y >= win.y1) {
      for (let i = row + 3; i < row + width * 4; i += 4) copy[i] = 0;
      continue;
    }
    for (let x = 0; x < Math.min(win.x0, width); x++) copy[row + x * 4 + 3] = 0;
    for (let x = Math.max(win.x1, 0); x < width; x++) copy[row + x * 4 + 3] = 0;
  }
  return copy;
}

/** Whether two windows hold the same pixels (both absent counts). */
export function sameWindow(a?: PixelWindow, b?: PixelWindow): boolean {
  if (!a || !b) return a === b;
  return a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1;
}

/**
 * Count `buffer`'s colors in a worker, starting now. The worker gets a copy of the pixels
 * (Inspect keeps reading the original for the loupe): copying 59 MiB at 5K costs a few
 * milliseconds on the main thread, and the copy is transferred, not cloned. Without `Worker`
 * (jsdom) it runs inline with the same result.
 */
export function createColorsAnalyzer(
  buffer: PixelBuffer,
  /** Counting progress, 0..1, about 20 calls. */
  onProgress?: (done: number) => void,
  /** Count only this part of the buffer (the visible part of a cropped base). */
  win?: PixelWindow,
): ColorsAnalyzer {
  if (typeof Worker === "undefined") return inlineAnalyzer(buffer, onProgress, win);

  const worker = newColorsWorker();
  const pending = new Map<
    number,
    { resolve: (value: ColorsResponse) => void; reject: (error: Error) => void }
  >();
  let nextId = 0;
  let disposed = false;

  const rejectAll = (error: Error): void => {
    for (const p of pending.values()) p.reject(error);
    pending.clear();
  };

  worker.onmessage = (event: MessageEvent<ColorsResponse>) => {
    const reply = event.data;
    if (reply.type === "progress") {
      // Not a settlement: the analyze call stays pending.
      if (!disposed) onProgress?.(reply.done);
      return;
    }
    const p = pending.get(reply.id);
    if (!p) {
      if (reply.type === "located") reply.bitmap?.close();
      return;
    }
    pending.delete(reply.id);
    if (reply.type === "error") p.reject(new Error(reply.message));
    else p.resolve(reply);
  };
  worker.onerror = (event) => {
    event.preventDefault();
    rejectAll(new Error(event.message || "colors worker failed"));
  };

  const send = (request: ColorsRequest, transfer: Transferable[] = []): Promise<ColorsResponse> => {
    if (disposed) return Promise.reject(new AnalyzerDisposed());
    return new Promise((resolve, reject) => {
      pending.set(request.id, { resolve, reject });
      worker.postMessage(request, transfer);
    });
  };

  const copy = visibleCopy(buffer, win);
  const analysis = send(
    {
      type: "analyze",
      id: nextId++,
      pixels: copy.buffer as ArrayBuffer,
      width: buffer.width,
      height: buffer.height,
    },
    [copy.buffer],
  ).then((reply) => {
    if (reply.type !== "analysis") throw new Error(`unexpected reply ${reply.type}`);
    return reply.analysis;
  });
  // The panel may never read it (disposed first): keep that from being an unhandled rejection.
  analysis.catch(() => {});

  return {
    buffer,
    window: win,
    analysis,
    async locate(target) {
      const reply = await send({ type: "locate", id: nextId++, target });
      if (reply.type !== "located") throw new Error(`unexpected reply ${reply.type}`);
      const { matched, areas, bounds, width, height } = reply;
      if (disposed) {
        reply.bitmap?.close();
        throw new AnalyzerDisposed();
      }
      if (reply.bitmap) return { matched, areas, bounds, width, height, bitmap: reply.bitmap };
      if (reply.pixels) {
        return {
          matched,
          areas,
          bounds,
          width,
          height,
          pixels: new Uint8ClampedArray(reply.pixels),
        };
      }
      throw new Error("located reply without an image");
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      worker.terminate();
      rejectAll(new AnalyzerDisposed());
    },
  };
}

function inlineAnalyzer(
  buffer: PixelBuffer,
  onProgress?: (done: number) => void,
  win?: PixelWindow,
): ColorsAnalyzer {
  let disposed = false;
  const data = win ? visibleCopy(buffer, win) : buffer.data;
  const index = Promise.resolve().then(() =>
    analyzeColors(data, buffer.width, buffer.height, onProgress),
  );
  const analysis = index.then((i) => {
    if (disposed) throw new AnalyzerDisposed();
    return i.analysis;
  });
  analysis.catch(() => {});
  return {
    buffer,
    window: win,
    analysis,
    async locate(target) {
      const { groupOfBin } = await index;
      if (disposed) throw new AnalyzerDisposed();
      const { mask, matched } = locateMask(data, groupOfBin, target);
      const { width, height } = buffer;
      const { areas, bounds } = regionsOf((i) => mask[i * 4 + 3] === 0, width, height);
      return { matched, areas, bounds, width, height, pixels: mask };
    },
    dispose() {
      disposed = true;
    },
  };
}
