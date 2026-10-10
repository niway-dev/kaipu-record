/**
 * GIF export worker (NIW2-217) — Web Worker (OffscreenCanvas + WebCodecs, no DOM).
 *
 * Frames are sampled at fixed timeline times `i / fps` over the (already sliced) plan,
 * decoded with `CanvasSink.canvasesAtTimestamps`, composed at SOURCE resolution through
 * the same `createOutputComposer` the MP4 export uses (privacy redactions, zoom crop and
 * overlays are identical by construction), downsampled once to the GIF size and streamed
 * into `GifStreamWriter` (gif-encode.ts). Nothing is written to disk here: the finished
 * file is transferred to the renderer, which saves it through the `gifSave` IPC.
 *
 * "estimate" mode runs the same pipeline on a few sampled frame pairs and reports an
 * approximate file size (FR 6).
 */
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from "mediabunny";
import type { InputVideoTrack } from "mediabunny";
import { createOutputComposer } from "./compose-output-frame";
import { gifFrameSchedule, locateTimelineTime } from "./export-plan";
import {
  buildGlobalPalette,
  estimateGifBytes,
  GifStreamWriter,
  measureFramePair,
} from "./gif-encode";
import { GIF_HARD_CAP_BYTES, type GifStartMessage, type GifWorkerMessage } from "./gif-messages";

type WorkerSelf = typeof self & {
  onmessage: ((event: MessageEvent<GifStartMessage>) => void) | null;
  postMessage(message: GifWorkerMessage, transfer?: Transferable[]): void;
};

const workerSelf = self as unknown as WorkerSelf;
const post = (message: GifWorkerMessage, transfer: Transferable[] = []): void =>
  workerSelf.postMessage(message, transfer);

/** Frames quantized for the shared palette (spec: 6–8 evenly spaced). */
const PALETTE_SAMPLES = 8;
/** Frame pairs encoded for the size estimate (spec: about 5). */
const ESTIMATE_PAIRS = 5;

class TooLargeError extends Error {}

workerSelf.onmessage = (event: MessageEvent<GifStartMessage>) => {
  void run(event.data).catch((error: unknown) => {
    post({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
      code: error instanceof TooLargeError ? "too-large" : undefined,
    });
  });
};

async function run(msg: GifStartMessage): Promise<void> {
  const input = new Input({ source: new BlobSource(msg.sourceBlob), formats: ALL_FORMATS });
  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    // A plan of only slides needs no track; anything with a clip does.
    if (!videoTrack && msg.plan.segments.some((s) => s.kind === "clip")) {
      throw new Error("source has no video track");
    }
    const renderer = createFrameRenderer(msg, videoTrack);
    if (msg.mode === "estimate") await runEstimate(msg, renderer);
    else await runExport(msg, renderer);
  } finally {
    input.dispose();
  }
}

interface FrameRenderer {
  /** Composed RGBA at the GIF size for each timeline time, in the given order. */
  render(times: number[]): AsyncGenerator<{ i: number; rgba: Uint8ClampedArray }>;
  /** The GIF-size canvas holding the last rendered frame (for the poster). */
  canvas: OffscreenCanvas;
}

function createFrameRenderer(msg: GifStartMessage, track: InputVideoTrack | null): FrameRenderer {
  const { source, output, plan } = msg;
  const full = new OffscreenCanvas(source.width, source.height);
  const fullCtx = full.getContext("2d");
  const small = new OffscreenCanvas(output.width, output.height);
  const smallCtx = small.getContext("2d", { willReadFrequently: true });
  if (!fullCtx || !smallCtx) throw new Error("gif-worker: no 2D context");
  // Start black, so a range whose first decode fails never shows stale pixels.
  fullCtx.fillStyle = "#000";
  fullCtx.fillRect(0, 0, source.width, source.height);
  smallCtx.imageSmoothingEnabled = true;
  smallCtx.imageSmoothingQuality = "high";

  const compose = createOutputComposer({
    ctx: fullCtx,
    width: source.width,
    height: source.height,
    camera: msg.camera,
    redactions: plan.redactions,
    overlayWindows: plan.overlayWindows,
    overlayBitmaps: new Map(msg.overlays.map((o) => [o.overlayId, o.bitmap])),
  });
  const slides = new Map(msg.slides.map((s) => [s.assetId, s.bitmap]));
  const sink = track
    ? new CanvasSink(track, { width: source.width, height: source.height, fit: "contain" })
    : null;

  const grab = (): Uint8ClampedArray => {
    smallCtx.drawImage(full, 0, 0, output.width, output.height);
    return smallCtx.getImageData(0, 0, output.width, output.height).data;
  };

  async function* render(times: number[]): AsyncGenerator<{ i: number; rgba: Uint8ClampedArray }> {
    // Group consecutive times that land in the same clip segment into one decode batch.
    let i = 0;
    while (i < times.length) {
      const located = locateTimelineTime(plan, times[i]);
      if (!located) throw new Error(`gif-worker: no segment at ${times[i]}`);
      const { segment } = located;
      if (segment.kind === "slide") {
        compose.slide(slides.get(segment.assetId), times[i]);
        yield { i, rgba: grab() };
        i++;
        continue;
      }
      const batch: { i: number; t: number; sourceTime: number }[] = [];
      while (i < times.length) {
        const next = locateTimelineTime(plan, times[i]);
        if (!next || next.segment !== segment) break;
        batch.push({ i, t: times[i], sourceTime: next.sourceTime });
        i++;
      }
      if (!sink) throw new Error("source has no video track");
      let k = 0;
      for await (const wrapped of sink.canvasesAtTimestamps(batch.map((b) => b.sourceTime))) {
        const slot = batch[k++];
        // A null = no decodable frame at that time (past the stream's end). The canvas
        // then still holds the previous, already-redacted composition, which is repeated.
        if (wrapped) compose.clip(wrapped.canvas, wrapped.timestamp, wrapped.duration, slot.t);
        yield { i: slot.i, rgba: grab() };
      }
    }
  }

  return { render, canvas: small };
}

async function collect(renderer: FrameRenderer, times: number[]): Promise<Uint8ClampedArray[]> {
  const frames: Uint8ClampedArray[] = new Array(times.length);
  for await (const { i, rgba } of renderer.render(times)) frames[i] = rgba;
  return frames;
}

function evenly(count: number, total: number): number[] {
  if (total <= 1 || count <= 1) return [0];
  const n = Math.min(count, total);
  return Array.from({ length: n }, (_, k) => Math.round((k * (total - 1)) / (n - 1)));
}

async function runEstimate(msg: GifStartMessage, renderer: FrameRenderer): Promise<void> {
  const schedule = gifFrameSchedule(msg.plan.totalDuration, msg.fps);
  const { width, height } = msg.output;
  // Pair k = frames (s, s+1); pair 0 starts at frame 0, which is the file's full frame.
  const starts = evenly(ESTIMATE_PAIRS, Math.max(1, schedule.length - 1));
  const indices = starts.flatMap((s) => [s, Math.min(s + 1, schedule.length - 1)]);
  const frames = await collect(
    renderer,
    indices.map((idx) => schedule[idx].t),
  );
  const colors = buildGlobalPalette(frames);
  const measured: { full: number; diff: number }[] = [];
  for (let k = 0; k < starts.length; k++) {
    measured.push(measureFramePair(frames[2 * k], frames[2 * k + 1], width, height, colors));
  }
  const bytes = estimateGifBytes(
    measured[0].full,
    schedule.length > 1 ? measured.map((m) => m.diff) : [],
    schedule.length,
  );
  post({ type: "estimate", bytes, frameCount: schedule.length });
}

async function runExport(msg: GifStartMessage, renderer: FrameRenderer): Promise<void> {
  const schedule = gifFrameSchedule(msg.plan.totalDuration, msg.fps);
  const { width, height } = msg.output;

  // 1. Shared palette from evenly spaced frames (≈5 % of the progress bar).
  const sampleIdx = evenly(PALETTE_SAMPLES, schedule.length);
  const samples = await collect(
    renderer,
    sampleIdx.map((idx) => schedule[idx].t),
  );
  const colors = buildGlobalPalette(samples);
  post({ type: "progress", fraction: 0.05 });

  // 2. Stream every frame into the writer.
  const writer = new GifStreamWriter(width, height, colors);
  let lastProgressPost = 0;
  let posterSent = false;
  for await (const { i, rgba } of renderer.render(schedule.map((s) => s.t))) {
    writer.addFrame(rgba, schedule[i].delayCs);
    if (!posterSent) {
      posterSent = true;
      const poster = await encodePoster(renderer.canvas);
      if (poster) post({ type: "poster", data: poster }, [poster]);
    }
    if (writer.byteLength > GIF_HARD_CAP_BYTES) throw new TooLargeError("gif over the size cap");
    const now = performance.now();
    if (now - lastProgressPost >= 250) {
      lastProgressPost = now;
      post({ type: "progress", fraction: 0.05 + 0.95 * ((i + 1) / schedule.length) });
    }
  }
  const bytes = writer.finish();
  if (bytes.length > GIF_HARD_CAP_BYTES) throw new TooLargeError("gif over the size cap");
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer;
  post({ type: "progress", fraction: 1 });
  post({ type: "done", data, width, height, frameCount: writer.framesWritten }, [data]);
}

/** JPEG of the first GIF frame; null if the platform cannot encode (cosmetic). */
async function encodePoster(canvas: OffscreenCanvas): Promise<ArrayBuffer | null> {
  try {
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.7 });
    return await blob.arrayBuffer();
  } catch {
    return null;
  }
}
