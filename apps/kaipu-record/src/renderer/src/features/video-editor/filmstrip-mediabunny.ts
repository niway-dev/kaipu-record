/**
 * The filmstrip worker's file, on mediabunny (ADR 0064): opens a recording by Range through the
 * media protocol, answers the planner's questions from packet metadata, and decodes a group of
 * slots in one forward pass into JPEGs. The decisions live in `filmstrip-plan.ts` and
 * `filmstrip-engine.ts`; this file only binds them to the library, so it is the part proven in
 * the real app rather than with fakes.
 */
import {
  ALL_FORMATS,
  CanvasSink,
  EncodedPacketSink,
  Input,
  UrlSource,
  type InputVideoTrack,
} from "mediabunny";
import type { DecodedSlot, FilmstripFile, FilmstripFileOpener } from "./filmstrip-engine";
import {
  READ_CACHE_BYTES,
  THUMBNAIL_JPEG_QUALITY,
  THUMBNAIL_WIDTH,
  type DecoderPreference,
} from "./filmstrip-messages";
import { planSlot, type DecodeGroup, type PacketIndex } from "./filmstrip-plan";

/** Canvases kept in a ring: each is encoded before the next frame is pulled. */
const CANVAS_POOL_SIZE = 2;

/** A failed request is tried twice more, then given up: a worker must not retry forever. */
const RETRY_DELAYS_S = [0.5, 1.5];

/**
 * mediabunny's `getRetryDelay` counts from 1 (it passes the number of failures so far, already
 * including this one: `++consecutiveReadFailures`), so the first retry is attempt 1.
 */
export function filmstripRetryDelay(failuresSoFar: number): number | null {
  return RETRY_DELAYS_S[failuresSoFar - 1] ?? null;
}

/**
 * The byte source for one recording. `UrlSource` keeps up to 64 MiB of reads by default; a
 * thumbnail decoder reads a key packet here and there and gains little from that, so the cache
 * is capped at {@link READ_CACHE_BYTES} (decision 12, AC13).
 */
export function createFilmstripUrlSource(url: string): UrlSource {
  return new UrlSource(url, {
    maxCacheSize: READ_CACHE_BYTES,
    getRetryDelay: filmstripRetryDelay,
  });
}

/** The planner's view of a video track: packet metadata only, never packet data. */
export function createPacketIndex(track: InputVideoTrack): PacketIndex {
  const sink = new EncodedPacketSink(track);
  const metadata = { metadataOnly: true } as const;
  return {
    keyAtOrBefore: async (t) => (await sink.getKeyPacket(t, metadata))?.timestamp ?? null,
    frameAtOrBefore: async (t) => (await sink.getPacket(t, metadata))?.timestamp ?? null,
    packetTimestampsFrom: (keyTimestamp) =>
      (async function* () {
        const key = await sink.getKeyPacket(keyTimestamp, metadata);
        if (!key) return;
        for await (const packet of sink.packets(key, undefined, metadata)) {
          yield packet.timestamp;
        }
      })(),
  };
}

function toJpeg(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob> {
  if ("convertToBlob" in canvas) {
    return canvas.convertToBlob({ type: "image/jpeg", quality: THUMBNAIL_JPEG_QUALITY });
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("JPEG encoding failed"))),
      "image/jpeg",
      THUMBNAIL_JPEG_QUALITY,
    ),
  );
}

/** Binds an open mediabunny `Input` to the engine's file. Owns the input: `close()` disposes it. */
export async function openFilmstripFileFrom(
  input: Input,
  decoder: DecoderPreference,
): Promise<FilmstripFile> {
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error("The recording has no video track");
    const index = createPacketIndex(track);
    const sink = new CanvasSink(track, {
      width: THUMBNAIL_WIDTH,
      poolSize: CANVAS_POOL_SIZE,
      decoderOptions: {
        hardwareAcceleration: decoder === "hardware" ? "prefer-hardware" : "prefer-software",
      },
    });
    // Reading the first key packet makes the demuxer read the index (the moov box, which a
    // Kaipu recording keeps at the END of the file), so the open time includes it.
    await index.keyAtOrBefore(Infinity);

    return {
      plan: (slot) => planSlot(index, slot),
      decode: (group) => decodeGroup(sink, group),
      close: () => input.dispose(),
    };
  } catch (error) {
    input.dispose();
    throw error;
  }
}

/**
 * One forward pass over a group: `canvasesAtTimestamps` with the targets in ascending order
 * decodes each packet at most once. Each canvas is encoded before the next one is pulled.
 */
async function* decodeGroup(
  sink: CanvasSink,
  group: DecodeGroup,
): AsyncGenerator<DecodedSlot, void, undefined> {
  const canvases = sink.canvasesAtTimestamps(
    group.items.map((item) => item.targetTimestamp),
    // The key packets were read from the container's index; check them against the bitstream
    // before the decoder is fed one that is not really a key frame.
    { verifyKeyPackets: true },
  );
  let waitingSince = performance.now();
  let position = 0;
  try {
    for await (const wrapped of canvases) {
      const item = group.items[position++];
      const decodeMs = performance.now() - waitingSince;
      if (wrapped && item) {
        const encodeStart = performance.now();
        const blob = await toJpeg(wrapped.canvas);
        yield {
          item,
          timestamp: wrapped.timestamp,
          blob,
          decodeMs,
          encodeMs: performance.now() - encodeStart,
        };
      }
      waitingSince = performance.now();
    }
  } finally {
    await canvases.return(undefined).catch(() => undefined);
  }
}

/** The opener the worker uses: a `UrlSource` on the media protocol URL. */
export const mediabunnyOpener: FilmstripFileOpener = {
  open: (url, decoder) =>
    openFilmstripFileFrom(
      new Input({ source: createFilmstripUrlSource(url), formats: ALL_FORMATS }),
      decoder,
    ),
};
