/**
 * Probe only (NIW2-844 layer 2 memory follow-up): runs the engine's work for a request up to a
 * chosen stage and stops, so the memory scenario can tell which stage the worker's growth comes
 * from. One file stays open between requests, as in the engine. Stages, each including the one
 * before: `plan` (packet metadata only), `read` (the key packet's bytes), `decode` (the frame,
 * drawn to the 160 px canvas), `encode` (the JPEG blob). Nothing is posted back but a count.
 * Never shipped.
 */
import {
  ALL_FORMATS,
  CanvasSink,
  EncodedPacketSink,
  Input,
  UrlSource,
  type InputVideoTrack,
} from "mediabunny";
import type { Slot } from "../../src/renderer/src/features/video-editor/filmstrip-frames";
import {
  createFilmstripUrlSource,
  createPacketIndex,
} from "../../src/renderer/src/features/video-editor/filmstrip-mediabunny";
import {
  MAX_REQUEST_SLOTS,
  READ_CACHE_BYTES,
  PASS_SLOTS,
  THUMBNAIL_JPEG_QUALITY,
  THUMBNAIL_WIDTH,
  type DecoderPreference,
  type ScrollDirection,
} from "../../src/renderer/src/features/video-editor/filmstrip-messages";
import {
  batchIntoPasses,
  groupByKeyframe,
  orderSlots,
  planSlot,
  type PlannedSlot,
} from "../../src/renderer/src/features/video-editor/filmstrip-plan";

export type Stage =
  | "plan"
  | "read"
  | "decode"
  | "encode"
  | "fetch-open"
  | "fetch-bounded"
  | "fetch-open-drain"
  | "fetch-bounded-ab"
  | "fetch-nostore"
  | "alloc-1mb"
  | "alloc-64kb";

export interface StageRequest {
  type: "stage-request";
  id: number;
  stage: Stage;
  url: string;
  decoder: DecoderPreference;
  slots: Slot[];
  playhead: number;
  direction: ScrollDirection;
  /** Overrides for the byte source; unset means the shipped `createFilmstripUrlSource`. */
  cacheBytes?: number;
  parallelism?: number;
  /** Bytes per fetch in the fetch stages (default 512 KiB). */
  fetchBytes?: number;
}

interface Open {
  url: string;
  key: string;
  input: Input;
  track: InputVideoTrack;
  index: ReturnType<typeof createPacketIndex>;
  packets: EncodedPacketSink;
  sink: CanvasSink;
}

let open: Open | null = null;

async function ensureOpen(request: StageRequest): Promise<Open> {
  const { url, decoder } = request;
  const key = `${url}|${request.cacheBytes ?? ""}|${request.parallelism ?? ""}`;
  if (open?.key === key) return open;
  closeStage();
  const source =
    request.cacheBytes === undefined && request.parallelism === undefined
      ? createFilmstripUrlSource(url)
      : new UrlSource(url, {
          maxCacheSize: request.cacheBytes ?? READ_CACHE_BYTES,
          ...(request.parallelism === undefined ? {} : { parallelism: request.parallelism }),
        });
  const input = new Input({ source, formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error("no video track");
  const index = createPacketIndex(track);
  await index.keyAtOrBefore(Infinity);
  open = {
    url,
    key,
    input,
    track,
    index,
    packets: new EncodedPacketSink(track),
    sink: new CanvasSink(track, {
      width: THUMBNAIL_WIDTH,
      poolSize: 2,
      decoderOptions: {
        hardwareAcceleration: decoder === "hardware" ? "prefer-hardware" : "prefer-software",
      },
    }),
  };
  return open;
}

export function closeStage(): void {
  open?.input.dispose();
  open = null;
}

/** Returns how many slots were planned and how many frames or blobs the stage produced. */
/** No I/O at all: allocate and touch one buffer per slot, then drop it. */
function runAllocStage(request: StageRequest): { planned: number; produced: number } {
  const size = request.stage === "alloc-1mb" ? 1024 * 1024 : 64 * 1024;
  let produced = 0;
  for (const [i] of request.slots.entries()) {
    const buffer = new Uint8Array(size);
    buffer.fill((request.id + i) & 255);
    produced += buffer[size - 1] === ((request.id + i) & 255) ? 1 : 0;
  }
  return { planned: request.slots.length, produced };
}

const DEFAULT_FETCH_BYTES = 512 * 1024;
let fetchedSize: number | null = null;

/**
 * What `UrlSource` does on one cache miss, without mediabunny: one ranged fetch per slot at a
 * pseudo-random offset, `FETCH_BYTES` read, then the body cancelled. `fetch-open` asks for
 * `bytes=<pos>-` (open ended, as `UrlSource` does), `fetch-open-drain` is the same but cancels
 * the body after the reader is released, `fetch-bounded` asks for
 * `bytes=<pos>-<pos + FETCH_BYTES - 1>`.
 */
async function runFetchStage(
  request: StageRequest,
): Promise<{ planned: number; produced: number }> {
  if (fetchedSize === null) {
    const head = await fetch(request.url, { headers: { Range: "bytes=0-0" } });
    const total = /\/(\d+)$/.exec(head.headers.get("content-range") ?? "");
    await head.arrayBuffer();
    fetchedSize = total ? Number(total[1]) : 1_000_000_000;
  }
  const size = fetchedSize;
  const FETCH_BYTES = request.fetchBytes ?? DEFAULT_FETCH_BYTES;
  let produced = 0;
  for (const [i] of request.slots.entries()) {
    const seed = (request.id * 131 + i * 7919 + 17) % 100_000;
    const pos = Math.floor((seed / 100_000) * (size - FETCH_BYTES));
    const range =
      request.stage === "fetch-bounded" || request.stage === "fetch-bounded-ab"
        ? `bytes=${pos}-${pos + FETCH_BYTES - 1}`
        : `bytes=${pos}-`;
    const controller = new AbortController();
    const response = await fetch(request.url, {
      headers: { Range: range },
      signal: controller.signal,
      ...(request.stage === "fetch-nostore" ? { cache: "no-store" as const } : {}),
    });
    if (request.stage === "fetch-bounded-ab") {
      produced += (await response.arrayBuffer()).byteLength > 0 ? 1 : 0;
      continue;
    }
    const reader = response.body!.getReader();
    let got = 0;
    while (got < FETCH_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.byteLength;
    }
    if (request.stage === "fetch-open-drain") {
      reader.releaseLock();
      await response.body!.cancel().catch(() => undefined);
    } else {
      await reader.cancel().catch(() => undefined);
    }
    controller.abort();
    produced += got > 0 ? 1 : 0;
  }
  return { planned: request.slots.length, produced };
}

export async function runStage(
  request: StageRequest,
): Promise<{ planned: number; produced: number }> {
  if (request.stage.startsWith("alloc-")) return runAllocStage(request);
  if (request.stage.startsWith("fetch-")) return runFetchStage(request);
  const file = await ensureOpen(request);
  const slots = orderSlots(
    request.slots,
    { playhead: request.playhead, direction: request.direction },
    MAX_REQUEST_SLOTS,
  );
  const planned: PlannedSlot[] = [];
  for (const [rank, slot] of slots.entries()) {
    const plan = await planSlot(file.index, slot);
    if (plan.kind === "plan") planned.push({ ...plan, rank });
  }
  let produced = 0;
  if (request.stage === "read") {
    for (const item of planned) {
      const packet = await file.packets.getKeyPacket(item.targetTimestamp);
      if (packet) produced += packet.data.byteLength > 0 ? 1 : 0;
    }
  } else if (request.stage === "decode" || request.stage === "encode") {
    for (const pass of batchIntoPasses(groupByKeyframe(planned), PASS_SLOTS)) {
      const canvases = file.sink.canvasesAtTimestamps(
        pass.items.map((item) => item.targetTimestamp),
        { verifyKeyPackets: true },
      );
      try {
        for await (const wrapped of canvases) {
          if (!wrapped) continue;
          if (request.stage === "encode") {
            const canvas = wrapped.canvas as OffscreenCanvas;
            await canvas.convertToBlob({ type: "image/jpeg", quality: THUMBNAIL_JPEG_QUALITY });
          }
          produced += 1;
        }
      } finally {
        await canvases.return(undefined).catch(() => undefined);
      }
    }
  }
  return { planned: planned.length, produced };
}
