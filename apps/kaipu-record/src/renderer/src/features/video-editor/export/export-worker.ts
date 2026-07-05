// export-worker.ts — runs with OffscreenCanvas + WebCodecs; no DOM access allowed
// here (no `document`, no `window`; only what a Worker global scope provides).
import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  StreamTarget,
} from "mediabunny";
import type { ExportStartMessage, ExportWorkerMessage } from "./export-messages";

const post = (message: ExportWorkerMessage, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(message, transfer);

self.onmessage = (event: MessageEvent<ExportStartMessage>) => {
  void runExport(event.data).catch((error: unknown) => {
    post({ type: "error", message: error instanceof Error ? error.message : String(error) });
  });
};

async function runExport(msg: ExportStartMessage): Promise<void> {
  const { plan, output: size } = msg;
  const input = new Input({ source: new BlobSource(msg.sourceBlob), formats: ALL_FORMATS });
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) throw new Error("source has no video track");
  // Recordings without an audio track (e.g. a silent screen capture) export
  // video-only — this is null, not an error.
  const audioTrack = await input.getPrimaryAudioTrack();

  const canvas = new OffscreenCanvas(size.width, size.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");

  const target = new StreamTarget(
    new WritableStream({
      write(chunk) {
        // StreamTarget chunks carry {data, position}; moov is rewritten at finalize,
        // hence positioned writes — mirror recorder-engine.ts. Copy the bytes: the
        // underlying buffer is reused by mediabunny. `data` is a
        // `Uint8Array<ArrayBuffer>` per the mediabunny types, so `.buffer` is
        // already a plain `ArrayBuffer` (no cast needed, unlike the task brief's
        // sketch).
        const data = chunk.data.slice().buffer;
        post({ type: "chunk", data, position: chunk.position }, [data]);
      },
    }),
  );
  const out = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target });
  const videoSource = new CanvasSource(canvas, {
    codec: "avc",
    bitrate: QUALITY_HIGH,
    hardwareAcceleration: "prefer-hardware",
  });
  out.addVideoTrack(videoSource, { frameRate: plan.slideFps });
  const audioSource = audioTrack
    ? new AudioBufferSource({ codec: "aac", bitrate: QUALITY_HIGH })
    : null;
  if (audioSource) out.addAudioTrack(audioSource);
  await out.start();

  const overlayById = new Map(msg.overlays.map((o) => [o.overlayId, o]));
  const slideBitmaps = new Map(msg.slides.map((s) => [s.assetId, s.bitmap]));
  let lastProgressPost = 0;

  const stampOverlays = (outTs: number): void => {
    for (const window of plan.overlayWindows) {
      if (outTs < window.start || outTs > window.end) continue;
      const overlay = overlayById.get(window.overlayId);
      if (overlay) ctx.drawImage(overlay.bitmap, 0, 0, size.width, size.height);
    }
  };

  const reportProgress = (outTs: number): void => {
    const now = Date.now();
    if (now - lastProgressPost < 250) return;
    lastProgressPost = now;
    post({ type: "progress", fraction: Math.min(1, outTs / plan.totalDuration) });
  };

  // ---- video ----
  for (const segment of plan.segments) {
    if (segment.kind === "clip") {
      const sink = new CanvasSink(videoTrack, {
        width: size.width,
        height: size.height,
        fit: "contain",
      });
      let prevOutTs: number | null = null;
      for await (const wrapped of sink.canvases(segment.sourceStart, segment.sourceEnd)) {
        const outTs = segment.timelineStart + (wrapped.timestamp - segment.sourceStart);
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, size.width, size.height);
        ctx.drawImage(wrapped.canvas, 0, 0);
        stampOverlays(outTs);
        const duration = prevOutTs === null ? wrapped.duration : Math.max(0, outTs - prevOutTs);
        await videoSource.add(outTs, duration);
        prevOutTs = outTs;
        reportProgress(outTs);
      }
    } else {
      const bitmap = slideBitmaps.get(segment.assetId) ?? null;
      const frameDuration = 1 / plan.slideFps;
      const frameCount = Math.round(segment.duration * plan.slideFps);
      for (let i = 0; i < frameCount; i++) {
        const outTs = segment.timelineStart + i * frameDuration;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, size.width, size.height);
        if (bitmap) drawContained(ctx, bitmap, size.width, size.height);
        stampOverlays(outTs);
        await videoSource.add(outTs, frameDuration);
        reportProgress(outTs);
      }
    }
  }
  videoSource.close();

  // ---- audio ----
  // A second pass over the segments (decode is cheap relative to encode). Run in
  // the same segment order as the video pass so timestamps stay aligned:
  // `AudioBufferSource.add` takes no explicit timestamp — per the mediabunny
  // types it self-advances ("the first AudioBuffer plays at timestamp 0, any
  // subsequent one starts where the previous one ended"). Since ExportPlan
  // segments are contiguous, sequential adds land exactly on each segment's
  // `timelineStart` without needing to pass one.
  if (audioTrack && audioSource) {
    for (const segment of plan.segments) {
      if (segment.kind === "clip") {
        const sink = new AudioBufferSink(audioTrack);
        for await (const wrapped of sink.buffers(segment.sourceStart, segment.sourceEnd)) {
          await audioSource.add(wrapped.buffer);
        }
      } else {
        // Slides are silent: a zeroed AudioBuffer keeps A/V durations aligned.
        const sampleRate = 48000;
        await audioSource.add(
          new AudioBuffer({
            length: Math.ceil(segment.duration * sampleRate),
            numberOfChannels: 2,
            sampleRate,
          }),
        );
      }
    }
    audioSource.close();
  }

  await out.finalize();
  post({ type: "progress", fraction: 1 });
  post({ type: "done" });
}

function drawContained(
  ctx: OffscreenCanvasRenderingContext2D,
  bitmap: ImageBitmap,
  w: number,
  h: number,
): void {
  const scale = Math.min(w / bitmap.width, h / bitmap.height);
  const dw = bitmap.width * scale;
  const dh = bitmap.height * scale;
  ctx.drawImage(bitmap, (w - dw) / 2, (h - dh) / 2, dw, dh);
}
