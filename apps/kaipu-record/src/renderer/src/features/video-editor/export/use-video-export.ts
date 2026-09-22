import { useCallback, useRef, useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import type { LocalRecording } from "@shared/types/library-storage";
import { captureException } from "@renderer/features/analytics";
import type { SlideAssetStore } from "../slide-assets";
import type { VideoScene } from "../scene";
import { buildExportPlan } from "./export-plan";
import type { ExportStartMessage, ExportWorkerMessage } from "./export-messages";
import { rasterizeOverlays } from "./overlay-raster";

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
  /** From the preview `<video>` element's videoWidth/videoHeight (native pixels). */
  videoWidth: number;
  videoHeight: number;
  /** Displayed px of the preview video box — used to scale overlay strokes true-to-preview. */
  previewWidth: number;
  slideAssets: SlideAssetStore;
  onSaved: (recording: LocalRecording) => void;
}

export interface VideoExportController extends VideoExportState {
  start(args: StartExportArgs): Promise<void>;
  cancel(): void;
}

const IDLE_STATE: VideoExportState = { status: "idle", fraction: 0, error: null };
const GENERIC_ERROR = "No pudimos exportar el video.";
const EMPTY_TIMELINE_ERROR = "No hay nada que exportar";

/**
 * Orchestrates a video export end to end: builds the render plan, rasterizes
 * overlays + decodes slide assets to bitmaps, opens a vault writer session (the
 * SAME create/write/finalize/abort IPC contract `recorder-engine.ts` uses — an
 * exported edit lands like a live recording, sidecar + thumbnail included), and
 * drives the export worker. The worker never touches the original recording: it
 * reads the source as a fetched Blob and the writer opens a brand-new session id.
 */
export function useVideoExport(): VideoExportController {
  const t = useTranslations("videoEditor");
  const [state, setState] = useState<VideoExportState>(IDLE_STATE);
  const workerRef = useRef<Worker | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  // Guards against a stray worker message landing after cancel() already tore
  // things down (the worker is terminated synchronously, but a message already
  // queued on the event loop could still be delivered first).
  const activeRef = useRef(false);

  const teardown = useCallback((sessionId: string | null) => {
    workerRef.current?.terminate();
    workerRef.current = null;
    if (sessionId) void window.electronAPI.recordingAbort(sessionId).catch(() => {});
  }, []);

  // Doubles as both "cancel an in-flight export" (worker running, writer session
  // open) and "dismiss the error dialog" (nothing active yet, e.g. the empty-
  // timeline refusal) — both `teardown` and the ref resets are no-ops/idempotent
  // when there's nothing to tear down, so one function covers both call sites.
  const cancel = useCallback(() => {
    activeRef.current = false;
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    teardown(sessionId);
    setState(IDLE_STATE);
  }, [teardown]);

  const start = useCallback(
    async (args: StartExportArgs) => {
      if (activeRef.current) return; // an export is already in flight

      let plan;
      try {
        plan = buildExportPlan(args.scene);
      } catch {
        setState({ status: "error", fraction: 0, error: EMPTY_TIMELINE_ERROR });
        return;
      }

      activeRef.current = true;
      setState({ status: "exporting", fraction: 0, error: null });

      const fail = (message: string, error?: unknown): void => {
        if (error !== undefined) captureException(error, { context: "video-export" });
        const sessionId = sessionIdRef.current;
        sessionIdRef.current = null;
        activeRef.current = false;
        teardown(sessionId);
        setState({ status: "error", fraction: 0, error: message });
      };

      try {
        const sourceResponse = await fetch(`kaipu-media://recording/${args.sourceId}`);
        const sourceBlob = await sourceResponse.blob();
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

        // Only decode slide assets the plan actually renders — undo/redo can leave
        // stale, no-longer-referenced assets sitting in the store.
        const usedAssetIds = new Set(
          plan.segments.filter((s) => s.kind === "slide").map((s) => s.assetId),
        );
        const slides = await Promise.all(
          args.slideAssets
            .entries()
            .filter((asset) => usedAssetIds.has(asset.assetId))
            .map(async (asset) => ({
              assetId: asset.assetId,
              bitmap: await createImageBitmap(new Blob([asset.bytes], { type: asset.mimeType })),
            })),
        );

        if (!activeRef.current) return; // cancelled while the above was in flight

        const sessionId = `export-${crypto.randomUUID()}`;
        sessionIdRef.current = sessionId;
        await window.electronAPI.recordingCreate(sessionId);

        if (!activeRef.current) {
          teardown(sessionId);
          sessionIdRef.current = null;
          return;
        }

        const worker = new Worker(new URL("./export-worker.ts", import.meta.url), {
          type: "module",
        });
        workerRef.current = worker;

        worker.onmessage = (event: MessageEvent<ExportWorkerMessage>) => {
          const msg = event.data;
          if (!activeRef.current) return;
          if (msg.type === "chunk") {
            window.electronAPI.recordingWrite(sessionId, msg.data, msg.position);
          } else if (msg.type === "poster") {
            poster = msg.data;
          } else if (msg.type === "progress") {
            setState((s) => (s.status === "exporting" ? { ...s, fraction: msg.fraction } : s));
          } else if (msg.type === "error") {
            fail(GENERIC_ERROR, new Error(msg.message));
          } else if (msg.type === "done") {
            void (async () => {
              const thumbnail = poster;
              // Yield once so a cancel() queued in the same tick wins (worker terminated,
              // writer session aborted, activeRef flipped false) — finalizing or calling
              // onSaved past that point would resurrect a cancelled export (navigating
              // to it, or racing cancel()'s own reset with this callback's).
              await Promise.resolve();
              if (!activeRef.current) return;
              try {
                const recording = await window.electronAPI.recordingFinalize(sessionId, {
                  title: t("editedTitle", { title: args.title }),
                  durationSeconds: plan.totalDuration,
                  durationMs: plan.totalDuration * 1000,
                  thumbnail,
                  derivedFromAssetId: args.derivedFromAssetId,
                });
                // Re-check again: cancel() could have run during the finalize await too.
                if (!activeRef.current) return;
                workerRef.current?.terminate();
                workerRef.current = null;
                sessionIdRef.current = null;
                activeRef.current = false;
                setState(IDLE_STATE);
                args.onSaved(recording);
              } catch (error) {
                if (!activeRef.current) return;
                fail(GENERIC_ERROR, error);
              }
            })();
          }
        };
        worker.onerror = (event: ErrorEvent) => {
          fail(GENERIC_ERROR, event.error ?? new Error(event.message));
        };

        const startMessage: ExportStartMessage = {
          type: "start",
          sourceBlob,
          plan,
          overlays,
          slides,
          output: { width: args.videoWidth, height: args.videoHeight },
        };
        worker.postMessage(startMessage, [
          ...overlays.map((o) => o.bitmap),
          ...slides.map((s) => s.bitmap),
        ]);
      } catch (error) {
        fail(GENERIC_ERROR, error);
      }
    },
    [teardown, t],
  );

  return { ...state, start, cancel };
}
