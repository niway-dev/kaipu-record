/**
 * The message API between the editor and the filmstrip worker (ADR 0064, layer 2). Types and
 * constants only: no DOM, no mediabunny, so the main thread, the worker and the tests share it.
 *
 * Times are in the media file's OWN time (a frame's true timestamp), like the frame store
 * (`filmstrip-frames.ts`). The main thread plans the slots (it holds the store, so it knows
 * which are empty); the worker orders them, decodes them and posts one frame per slot.
 *
 * The worker cannot build a media URL (`lib/media-url.ts` reads `window`), so every request
 * carries the full `kaipu-media://` URL, workspace stamp included.
 */
import type { Slot } from "./filmstrip-frames";

/** Which decoder thumbnails use: set by the layer 2 measurement (decision 15). */
export type DecoderPreference = "hardware" | "software";

/** How the view is moving: the margin is only decoded on the side it moves toward. */
export type ScrollDirection = -1 | 0 | 1;

/** Ask for frames for these empty slots. A newer request cancels the one still running. */
export interface FilmstripRequestMessage {
  type: "request";
  /** Echoed on every reply, so a late frame of a cancelled request is recognisable. */
  requestId: number;
  /** The caller's key for the file (the frame store key); echoed on every frame. */
  fileKey: string;
  /** The full `kaipu-media://` URL, read by Range. */
  url: string;
  /** Empty slots from `planSlots` (layer 1). More than {@link MAX_REQUEST_SLOTS} are cut. */
  slots: readonly Slot[];
  /** The playhead in the file's own time: slots nearest to it are decoded first. */
  playhead: number;
  direction: ScrollDirection;
}

/** Stop a request. Frames of it already posted stay valid; no more follow. */
export interface FilmstripCancelMessage {
  type: "cancel";
  requestId: number;
}

/**
 * Stop the running request and close the open file now. Playback and export send it when they
 * need the decoder; a workspace switch sends it so no file of the old workspace stays open.
 */
export interface FilmstripCloseMessage {
  type: "close";
}

/**
 * Choose hardware or software decoding. A change closes the open file (the decoder is chosen
 * when it opens). Not sent by the editor: the default is the measured choice.
 */
export interface FilmstripConfigureMessage {
  type: "configure";
  decoder: DecoderPreference;
}

export type FilmstripWorkerInput =
  | FilmstripRequestMessage
  | FilmstripCancelMessage
  | FilmstripCloseMessage
  | FilmstripConfigureMessage;

/** One thumbnail: the JPEG of the frame decoded for a slot, under its true timestamp. */
export interface FilmstripFrameMessage {
  type: "frame";
  requestId: number;
  fileKey: string;
  /** The slot it fills (`Slot.index`). */
  slotIndex: number;
  /** The frame's true timestamp in the file's own time, not the slot's. */
  timestamp: number;
  blob: Blob;
  bytes: number;
  /** Time from asking the decoder for this frame until it came back, in ms. */
  decodeMs: number;
  /** Time to scale and JPEG-encode it, in ms. */
  encodeMs: number;
}

/** A request has ended. `complete`: every slot was tried. `cancelled`: it was stopped early. */
export interface FilmstripDoneMessage {
  type: "done";
  requestId: number;
  fileKey: string;
  outcome: "complete" | "cancelled";
  /** Frames posted. */
  frames: number;
  /** Slots with no frame inside them (a gap in the file). */
  skippedNoFrame: number;
  /** Slots whose exact decode would pass the packet cap (AC8): the tile keeps the nearest frame. */
  skippedOverCap: number;
  /** Slots whose decode threw. */
  failed: number;
  /** True when this request had to open the file (false: it was still open from before). */
  openedFile: boolean;
  /** Time spent opening the file (index read), in ms; 0 when it was already open. */
  openMs: number;
  /** Time from the request to this message, in ms. */
  elapsedMs: number;
}

/** The file could not be opened or read at all. The worker stays usable. */
export interface FilmstripErrorMessage {
  type: "error";
  requestId: number;
  message: string;
}

/** The worker opened or closed its one file (AC13 reads these). */
export interface FilmstripFileMessage {
  type: "file";
  event: "opened" | "closed";
  url: string;
  /** Why it closed. */
  reason?: "idle" | "close" | "other-file" | "decoder-changed";
}

export type FilmstripWorkerOutput =
  | FilmstripFrameMessage
  | FilmstripDoneMessage
  | FilmstripErrorMessage
  | FilmstripFileMessage;

/** A request lists at most this many slots (layer 1 never plans more); the rest are cut. */
export const MAX_REQUEST_SLOTS = 192;

/** An exact decode above this many packets is skipped (AC8, decision 4). */
export const MAX_EXACT_PACKETS = 300;

/** The worker closes its file after this long without a request (AC13, decision 12). */
export const FILE_IDLE_MS = 10_000;

/** The file's read cache never holds more than this (AC13, decision 12). */
export const READ_CACHE_BYTES = 8 * 1024 * 1024;

/** At most this many frames in any window of {@link PACE_WINDOW_MS} (AC14, decision 13). */
export const PACE_MAX_FRAMES = 60;
export const PACE_WINDOW_MS = 1000;

/**
 * Slots decoded in one forward pass. A decoder pass has a start-up cost (measured on the Mac
 * mini: 17 frames took 520 ms hardware / 823 ms software as one pass each, 184 ms / 439 ms as
 * one pass), so slots are batched; a small batch keeps the playhead's slots arriving first.
 */
export const PASS_SLOTS = 8;

/** Thumbnail width in px, as today's 24-frame strip (`use-source-thumbnails.ts`). */
export const THUMBNAIL_WIDTH = 160;
export const THUMBNAIL_JPEG_QUALITY = 0.6;

/**
 * The decoder thumbnails use (decision 15). Measured on the Mac mini, 2560x1440 H.264 at 60 fps,
 * 62 thumbnails per request: hardware 1.05 s and 0.33 s of renderer CPU; software 1.87 s and
 * 2.45 s of renderer CPU. Hardware costs the GPU process 0.2 s and a 186 ms start-up on the
 * first frame of a file.
 */
export const DEFAULT_DECODER: DecoderPreference = "hardware";
