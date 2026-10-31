import { useSyncExternalStore } from "react";
import type { Translator } from "@kaipu/i18n";
import type { LocalRecording } from "@shared/types/library-storage";
import type { DestinationId } from "@renderer/features/prepare/destinations";
import { captureException } from "@renderer/features/analytics";
import { showToast } from "@renderer/ui/toast-store";
import type { SlideAssetStore } from "../slide-assets";
import type { VideoScene } from "../scene";
import type { CameraPath } from "../zoom/camera-path";
import { buildExportPlan } from "./export-plan";
import type { ExportStartMessage, ExportWorkerMessage } from "./export-messages";
import { rasterizeOverlays } from "./overlay-raster";
import {
  type ExportFraming,
  type ExportPresetId,
  encodeFingerprint,
  type ResolvedExportTarget,
  resolveExportTarget,
  slideFrameCount,
} from "./export-presets";
import { WHOLE_RECORDING_FINGERPRINT } from "./export-reuse";
import { noteFinishedCopy } from "./ready-copies";
import type { VideoEncodingChoice } from "./video-encoding";

export interface VideoExportState {
  status: "idle" | "exporting" | "error";
  fraction: number;
  error: string | null;
}

export interface StartExportArgs {
  scene: VideoScene;
  sourceId: string;
  title: string;
  /** The source asset's identity; persisted on the exported file. */
  derivedFromAssetId: string | null;
  /** The source file's size, for "119 MB → ~9 MB" and "N% lighter" on the status cards. */
  sourceSizeBytes?: number | null;
  /** From the preview `<video>` element's videoWidth/videoHeight (native pixels). */
  videoWidth: number;
  videoHeight: number;
  /** Displayed px of the preview video box — used to scale overlay strokes true-to-preview. */
  previewWidth: number;
  slideAssets: SlideAssetStore;
  /** v2: the preview's camera path (useCameraPath). Sent whenever the plan has a zoom. */
  cameraPath: CameraPath | null;
  /** NIW2-218: destination preset; Balanced (the Settings default) when omitted. */
  presetId?: ExportPresetId;
  /** Fit/Fill for Vertical and Square; the preset's default when omitted. */
  framing?: ExportFraming | null;
  /** Probed source facts (frame rate, audio); conservative defaults when omitted. */
  sourceInfo?: { fps: number; hasAudio: boolean; sampleRate?: number } | null;
  /**
   * What this export encodes, recorded on the sidecar for "already exported" reuse:
   * `editFingerprint(scene)` from the editor, `WHOLE_RECORDING_FINGERPRINT` from Share.
   */
  fingerprint?: string;
  /** Where the copy is going, when Prepare started it (NIW2-586): the cards name it. */
  destination?: DestinationId;
  /**
   * The file landed in the vault. Runs even when the page that started the export is gone
   * (exports run in the background), so it must not assume its component is mounted.
   */
  onSaved: (recording: LocalRecording) => void | Promise<void>;
}

/** What the status cards say about the running (or finished) export. */
export interface ExportJobInfo {
  presetId: ExportPresetId;
  /** The source's title as the user knows it. */
  sourceTitle: string;
  sourceAssetId: string | null;
  sourceSizeBytes: number | null;
  /** The size estimate for this export (`resolveExportTarget`); null for Maximum. */
  estimateBytes: number | null;
  /** Output size. */
  width: number;
  height: number;
  /**
   * Where the copy is going, when Prepare started it: "Preparing your YouTube copy…".
   * Absent for an editor export, which the cards call "your export" (NIW2-586).
   */
  destination?: DestinationId;
  /**
   * The whole recording, without edits (Prepare, Share) — a copy for a destination — rather
   * than an editor export. Absent on jobs built before NIW2-585.
   */
  wholeRecording?: boolean;
}

/** A finished export, until the user dismisses its ready card. */
export interface ReadyExport {
  job: ExportJobInfo;
  recording: LocalRecording;
}

export interface ExportRunnerSnapshot extends VideoExportState {
  /** The running export, or the one that failed; null while idle. */
  job: ExportJobInfo | null;
  /** When the current encode attempt started (Date.now()), for "about N s left". */
  attemptStartedAt: number | null;
  ready: ReadyExport | null;
}

/**
 * The exported item's title: the destination for the destination rows (spec Q8). The
 * quality rows (Balanced, Maximum) say "(edited)" from the editor and "(for sharing)" from
 * Share, which encodes the recording without edits.
 */
export function exportTitle(
  t: Translator<"videoEditor">,
  presetId: ExportPresetId,
  title: string,
  fingerprint?: string,
): string {
  switch (presetId) {
    // Both canvases are "(YouTube)": the resolution is the file's, not the destination's.
    case "youtube-1440":
    case "youtube-4k":
      return t("presetTitleYoutube", { title });
    case "vertical":
      return t("presetTitleVertical", { title });
    case "square":
      return t("presetTitleSquare", { title });
    case "light":
      return t("presetTitleLight", { title });
    default:
      return fingerprint === WHOLE_RECORDING_FINGERPRINT
        ? t("presetTitleShare", { title })
        : t("editedTitle", { title });
  }
}

/** mediabunny's error when a `fastStart: 'reserve'` track outgrows its maximumPacketCount. */
const PACKET_RESERVE_ERROR = /maximum packet count/i;

const IDLE: ExportRunnerSnapshot = {
  status: "idle",
  fraction: 0,
  error: null,
  job: null,
  attemptStartedAt: null,
  ready: null,
};

/*
 * Module-singleton export runner (NIW2-218 export redesign) — deliberately NOT a page hook's
 * local state, for the same reason as `recorder-store.ts`: exports run in the background, so
 * the worker, the writer session and the progress must survive the user leaving the editor
 * or the library page that started them. One export at a time. Mirrors `ui/toast-store.ts`:
 * plain functions mutate module state and notify subscribers, read through
 * `useSyncExternalStore`.
 */
let snapshot: ExportRunnerSnapshot = IDLE;
const listeners = new Set<() => void>();
let worker: Worker | null = null;
let sessionId: string | null = null;
// Guards against a stray worker message landing after cancel() already tore things down
// (the worker is terminated synchronously, but a message already queued on the event loop
// could still be delivered first).
let active = false;
// What Retry re-runs.
let lastStart: { args: StartExportArgs; t: Translator<"videoEditor"> } | null = null;

function set(next: Partial<ExportRunnerSnapshot>): void {
  const wasExporting = snapshot.status === "exporting";
  snapshot = { ...snapshot, ...next };
  const exporting = snapshot.status === "exporting";
  // Main confirms before closing or quitting while this is true (the renderer that runs
  // the export dies with the window).
  if (exporting !== wasExporting) window.electronAPI.setExportActive?.(exporting);
  for (const listener of listeners) listener();
}

export function getExportSnapshot(): ExportRunnerSnapshot {
  return snapshot;
}

export function subscribeExport(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useExportRunner(): ExportRunnerSnapshot {
  return useSyncExternalStore(subscribeExport, getExportSnapshot);
}

/** True while an export is encoding: a second one is refused until it ends. */
export function isVideoExportBusy(): boolean {
  return active;
}

/** "Already exporting “…”": what a second Export or Share says while one runs. */
export function showExportBusyToast(t: Translator<"videoEditor">): void {
  showToast({ message: t("exportBusy", { title: snapshot.job?.sourceTitle ?? "" }) });
}

function teardown(id: string | null): void {
  worker?.terminate();
  worker = null;
  if (id) void window.electronAPI.recordingAbort(id).catch(() => {});
}

/**
 * Doubles as both "cancel an in-flight export" (worker running, writer session open) and
 * "dismiss the error" (nothing active, e.g. the empty-timeline refusal) — `teardown` and
 * the resets are idempotent, so one function covers both. A Ready card stays.
 */
export function cancelVideoExport(): void {
  active = false;
  const id = sessionId;
  sessionId = null;
  teardown(id);
  set({ ...IDLE, ready: snapshot.ready });
}

/**
 * Logs an export that did not get the encoder it was tuned for — not an error for the user
 * (the file is still made), but something to learn about: no hardware H.264 means Chromium's
 * software encoder (blurry small text), and a tier without quantizer mode means its "~"
 * estimate was not measured for this encode.
 */
function reportEncoderChoice(choice: VideoEncodingChoice, target: ResolvedExportTarget): void {
  if (!choice.softwareFallback && !choice.quantizerUnsupported) return;
  const message = choice.softwareFallback
    ? "export: no hardware H.264 encoder, the platform picked one (likely software)"
    : "export: hardware H.264 without quantizer mode, encoding at the fallback bitrate";
  captureException(new Error(message), {
    context: choice.softwareFallback
      ? "video-export-software-encoder"
      : "video-export-no-quantizer",
    presetId: target.presetId,
    width: target.width,
    height: target.height,
    rateControl: choice.rateControl,
    bitrate: choice.bitrate,
  });
}

/** Re-runs the last export (the error card's Retry, FR12). */
export function retryVideoExport(): void {
  if (!lastStart || active) return;
  const { args, t } = lastStart;
  cancelVideoExport();
  void startVideoExport(args, t);
}

/** The Ready card's ✕. The copy stays unseen until it is opened (`ready-copies.ts`). */
export function dismissReadyExport(): void {
  if (snapshot.ready) set({ ready: null });
}

/**
 * Runs a video export end to end, in the background: builds the render plan, rasterizes
 * overlays + decodes slide assets to bitmaps, opens a vault writer session (the SAME
 * create/write/finalize/abort IPC contract `recorder-engine.ts` uses — an exported edit
 * lands like a live recording, sidecar + thumbnail included), and drives the export worker.
 * The worker never touches the original recording: it reads the source as a fetched Blob
 * and the writer opens a brand-new session id.
 *
 * Returns false when another export is already running (one at a time).
 */
export async function startVideoExport(
  args: StartExportArgs,
  t: Translator<"videoEditor">,
): Promise<boolean> {
  if (active) return false;
  lastStart = { args, t };
  const GENERIC_ERROR = t("exportGenericError");
  const presetId: ExportPresetId = args.presetId ?? "balanced";

  let plan;
  try {
    plan = buildExportPlan(args.scene);
  } catch {
    set({ ...IDLE, ready: snapshot.ready, status: "error", error: t("exportEmptyTimeline") });
    return true;
  }

  const target = resolveExportTarget(
    presetId,
    {
      width: args.videoWidth,
      height: args.videoHeight,
      fps: args.sourceInfo?.fps ?? 30,
      hasAudio: (args.sourceInfo?.hasAudio ?? true) && !plan.audio.audioMuted,
      sampleRate: args.sourceInfo?.sampleRate,
    },
    plan.totalDuration,
    {
      framing: args.framing ?? null,
      slideFrames: slideFrameCount(plan.segments, plan.slideFps),
    },
  );
  const job: ExportJobInfo = {
    presetId,
    sourceTitle: args.title,
    sourceAssetId: args.derivedFromAssetId,
    sourceSizeBytes: args.sourceSizeBytes ?? null,
    estimateBytes: presetId === "maximum" ? null : target.estimateBytes,
    width: target.width,
    height: target.height,
    ...(args.destination ? { destination: args.destination } : {}),
    wholeRecording: args.fingerprint === WHOLE_RECORDING_FINGERPRINT,
  };

  active = true;
  // A new export replaces the previous one's Ready card.
  set({
    status: "exporting",
    fraction: 0,
    error: null,
    job,
    attemptStartedAt: Date.now(),
    ready: null,
  });

  const fail = (message: string, error?: unknown): void => {
    if (error !== undefined) captureException(error, { context: "video-export" });
    const id = sessionId;
    sessionId = null;
    active = false;
    teardown(id);
    set({
      status: "error",
      fraction: 0,
      error: message,
      attemptStartedAt: null,
    });
  };

  // The editor's slide store is disposed when the editor unmounts, and the export may
  // outlive it: take the slides now.
  const usedAssetIds = new Set(
    plan.segments.filter((s) => s.kind === "slide").map((s) => s.assetId),
  );
  const slideAssets = args.slideAssets.entries().filter((asset) => usedAssetIds.has(asset.assetId));

  let sourceBlob: Blob;
  try {
    const sourceResponse = await fetch(`kaipu-media://recording/${args.sourceId}`);
    sourceBlob = await sourceResponse.blob();
  } catch (error) {
    fail(GENERIC_ERROR, error);
    return true;
  }

  // One worker run into one fresh writer session. Bitmaps and camera arrays are
  // TRANSFERRED to the worker, so a retry rebuilds them instead of reusing detached ones.
  const launch = async (runTarget: ResolvedExportTarget): Promise<void> => {
    // The poster comes from the worker's first RENDERED frame ("poster" message), never
    // from the source file: the source still holds deleted footage and redacted content.
    // No poster (encode failed) → null, and the vault's self-healing metadata decodes
    // one later from the exported file itself.
    let poster: ArrayBuffer | null = null;

    const rasterized = await rasterizeOverlays(
      args.scene.overlays,
      args.videoWidth,
      args.videoHeight,
      args.previewWidth,
    );
    const bitmapByOverlayId = new Map(rasterized.map((r) => [r.overlayId, r.bitmap]));
    const overlays = args.scene.overlays.map((o) => ({
      overlayId: o.id,
      start: o.start,
      end: o.end,
      bitmap: bitmapByOverlayId.get(o.id)!,
    }));

    const slides = await Promise.all(
      slideAssets.map(async (asset) => ({
        assetId: asset.assetId,
        bitmap: await createImageBitmap(new Blob([asset.bytes], { type: asset.mimeType })),
      })),
    );

    if (!active) return; // cancelled while the above was in flight

    const id = `export-${crypto.randomUUID()}`;
    sessionId = id;
    await window.electronAPI.recordingCreate(id);

    if (!active) {
      teardown(id);
      sessionId = null;
      return;
    }

    const runWorker = new Worker(new URL("./export-worker.ts", import.meta.url), {
      type: "module",
    });
    worker = runWorker;

    runWorker.onmessage = (event: MessageEvent<ExportWorkerMessage>) => {
      const msg = event.data;
      if (!active || worker !== runWorker) return;
      if (msg.type === "chunk") {
        window.electronAPI.recordingWrite(id, msg.data, msg.position);
      } else if (msg.type === "poster") {
        poster = msg.data;
      } else if (msg.type === "encoder") {
        reportEncoderChoice(msg.choice, runTarget);
      } else if (msg.type === "progress") {
        if (snapshot.status === "exporting") set({ fraction: msg.fraction });
      } else if (msg.type === "error") {
        if (runTarget.fastStart === "reserve" && PACKET_RESERVE_ERROR.test(msg.message)) {
          // FR9 fallback: the moov reservation was too small. Drop this attempt (its
          // session is aborted, nothing reaches the vault) and redo it once with moov
          // at the end — the user still gets a file, just without fast start.
          captureException(new Error(msg.message), { context: "video-export-fast-start" });
          teardown(id);
          sessionId = null;
          if (snapshot.status === "exporting") set({ fraction: 0, attemptStartedAt: Date.now() });
          void launch({ ...runTarget, fastStart: false }).catch((error: unknown) => {
            if (active) fail(GENERIC_ERROR, error);
          });
          return;
        }
        fail(GENERIC_ERROR, new Error(msg.message));
      } else if (msg.type === "done") {
        void (async () => {
          const thumbnail = poster;
          // Yield once so a cancel() queued in the same tick wins (worker terminated,
          // writer session aborted, `active` flipped false) — finalizing or calling
          // onSaved past that point would resurrect a cancelled export.
          await Promise.resolve();
          if (!active) return;
          try {
            const recording = await window.electronAPI.recordingFinalize(id, {
              title: exportTitle(t, presetId, args.title, args.fingerprint),
              durationSeconds: plan.totalDuration,
              durationMs: plan.totalDuration * 1000,
              thumbnail,
              derivedFromAssetId: args.derivedFromAssetId,
              exportPreset: presetId,
              // The content plus the preset's encode revision, so "already exported" never
              // reuses a file a different encode produced (see ENCODE_REVISION).
              ...(args.fingerprint
                ? { exportFingerprint: encodeFingerprint(args.fingerprint, presetId) }
                : {}),
            });
            // Re-check again: cancel() could have run during the finalize await too.
            if (!active) return;
            worker?.terminate();
            worker = null;
            sessionId = null;
            active = false;
            set({ ...IDLE, ready: { job, recording } });
            noteFinishedCopy(recording.assetId, {
              destination: job.destination,
              width: job.width,
              height: job.height,
            });
            try {
              await args.onSaved(recording);
            } catch (error) {
              // The file is in the vault; a failing follow-up (a session save) must not
              // turn a finished export into an error.
              captureException(error, { context: "video-export-saved" });
            }
          } catch (error) {
            if (!active) return;
            fail(GENERIC_ERROR, error);
          }
        })();
      }
    };
    runWorker.onerror = (event: ErrorEvent) => {
      fail(GENERIC_ERROR, event.error ?? new Error(event.message));
    };

    // COPIES of the camera arrays: transferring the preview's own buffers would detach
    // them and break the live preview (and undo) after the export starts.
    const camera =
      plan.hasZoom && args.cameraPath
        ? {
            fps: args.cameraPath.fps,
            cx: args.cameraPath.cx.slice(),
            cy: args.cameraPath.cy.slice(),
            scale: args.cameraPath.scale.slice(),
          }
        : null;
    const startMessage: ExportStartMessage = {
      type: "start",
      sourceBlob,
      plan,
      overlays,
      slides,
      output: { width: runTarget.width, height: runTarget.height },
      source: { width: args.videoWidth, height: args.videoHeight },
      target: runTarget,
      camera,
    };
    runWorker.postMessage(startMessage, [
      ...overlays.map((o) => o.bitmap),
      ...slides.map((s) => s.bitmap),
      ...(camera ? [camera.cx.buffer, camera.cy.buffer, camera.scale.buffer] : []),
    ]);
  };

  try {
    await launch(target);
  } catch (error) {
    fail(GENERIC_ERROR, error);
  }
  return true;
}

/** Tests only: drop any running export and every card. */
export function __resetExportRunnerForTests(): void {
  active = false;
  const id = sessionId;
  sessionId = null;
  worker?.terminate();
  worker = null;
  if (id) void window.electronAPI.recordingAbort(id).catch(() => {});
  lastStart = null;
  snapshot = IDLE;
  for (const listener of listeners) listener();
}
