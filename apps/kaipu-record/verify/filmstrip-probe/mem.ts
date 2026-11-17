/**
 * Probe only (NIW2-844 layer 2 memory follow-up): counts what the worker holds so the memory
 * scenario can tell an owned leak (a VideoFrame or VideoDecoder never closed, JPEG bytes that
 * keep piling up) from a cost that is the platform's (decoder surfaces, allocator pages).
 *
 * It wraps `VideoDecoder` (every frame it outputs and every decoder it creates) and
 * `OffscreenCanvas.convertToBlob` (the JPEG bytes produced), and answers a `mem` message with
 * the counters and the worker's JS heap. It runs BEFORE the filmstrip worker in the same bundle,
 * so mediabunny sees the wrapped constructor. Never shipped: only the verify scenarios
 * (`filmstrip-memory.verify.ts`, `filmstrip-worker.verify.ts`) and `filmstrip-no-cdp/run.sh` build it.
 */
export interface WorkerMemCounters {
  decodersCreated: number;
  decodersClosed: number;
  decodersLive: number;
  framesOutput: number;
  framesClosed: number;
  framesLive: number;
  framesLivePeak: number;
  jpegBlobs: number;
  jpegBytes: number;
  jsHeapUsedMb: number | null;
  jsHeapTotalMb: number | null;
}

const counters = {
  decodersCreated: 0,
  decodersClosed: 0,
  framesOutput: 0,
  framesClosed: 0,
  framesLive: 0,
  framesLivePeak: 0,
  jpegBlobs: 0,
  jpegBytes: 0,
};

const NativeDecoder = (globalThis as { VideoDecoder?: typeof VideoDecoder }).VideoDecoder;
if (NativeDecoder) {
  class CountingDecoder extends NativeDecoder {
    private counted = false;

    constructor(init: VideoDecoderInit) {
      super({
        ...init,
        output: (frame) => {
          counters.framesOutput += 1;
          counters.framesLive += 1;
          counters.framesLivePeak = Math.max(counters.framesLivePeak, counters.framesLive);
          const close = frame.close.bind(frame);
          let closed = false;
          frame.close = () => {
            if (!closed) {
              closed = true;
              counters.framesClosed += 1;
              counters.framesLive -= 1;
            }
            close();
          };
          init.output(frame);
        },
      });
      counters.decodersCreated += 1;
    }

    override close(): void {
      if (!this.counted) {
        this.counted = true;
        counters.decodersClosed += 1;
      }
      super.close();
    }
  }
  (globalThis as { VideoDecoder: unknown }).VideoDecoder = CountingDecoder;
}

if (typeof OffscreenCanvas !== "undefined") {
  const convert = OffscreenCanvas.prototype.convertToBlob;
  OffscreenCanvas.prototype.convertToBlob = async function (this: OffscreenCanvas, options) {
    const blob = await convert.call(this, options);
    counters.jpegBlobs += 1;
    counters.jpegBytes += blob.size;
    return blob;
  };
}

export function readWorkerMem(): WorkerMemCounters {
  const memory = (
    performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }
  ).memory;
  return {
    ...counters,
    decodersLive: counters.decodersCreated - counters.decodersClosed,
    jsHeapUsedMb: memory ? Math.round((memory.usedJSHeapSize / 1048576) * 10) / 10 : null,
    jsHeapTotalMb: memory ? Math.round((memory.totalJSHeapSize / 1048576) * 10) / 10 : null,
  };
}
