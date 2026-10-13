import { useRef, useState } from "react";
import { Share2 } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { Button } from "@kaipu/ui";
import type { LocalRecording } from "@shared/types/library-storage";
import { captureException } from "@renderer/features/analytics";
import { showToast } from "@renderer/ui/toast-store";
import { useAppSettings } from "@renderer/pages/settings/use-app-settings";
import {
  ExportSheet,
  type VideoExportChoice,
} from "@renderer/features/video-editor/components/export-sheet";
import { ExportDialog } from "@renderer/features/video-editor/components/export-dialog";
import {
  WHOLE_RECORDING_FINGERPRINT,
  findReusableExports,
} from "@renderer/features/video-editor/export/export-reuse";
import { showExportSavedToast } from "@renderer/features/video-editor/export/export-saved-toast";
import { probeSource, type SourceProbe } from "@renderer/features/video-editor/export/probe-source";
import { useVideoExport } from "@renderer/features/video-editor/export/use-video-export";
import { createSlideAssetStore } from "@renderer/features/video-editor/slide-assets";
import { initialScene } from "@renderer/features/video-editor/scene";
import type { LibraryVideo } from "../types";

const IDLE_GIF_ESTIMATE = { status: "idle" as const, bytes: null, frameCount: null };

export interface ShareRecordingProps {
  /** The recording to share, as it is on disk (raw, or an editor export). Needs a local copy. */
  video: LibraryVideo & { id: string };
  /** Its exports (`buildLineage().exportsOf`), for "Already exported · Open". */
  exports: readonly LibraryVideo[];
  /** A new file landed in the library (the page re-lists, so it shows under Exports). */
  onSaved(recording: LocalRecording): void;
  /** "Open" on an already-exported row. */
  onOpenExisting(existing: LibraryVideo): void;
}

/**
 * Share (NIW2-218), "Prepare an optimized file to share": the editor's export sheet for the
 * whole recording, without opening the editor. It runs the SAME export worker with a trivial
 * plan — one clip over the whole file, no overlays, no slides, no zoom — so there is no second
 * pipeline, and the result is a new library item derived from this one (ADR 0003: the
 * recording itself is never touched). Share by link (cloud) joins this button later.
 */
export function ShareRecording({
  video,
  exports,
  onSaved,
  onOpenExisting,
}: ShareRecordingProps): React.JSX.Element {
  const t = useTranslations("library");
  const tEditor = useTranslations("videoEditor");
  const appSettings = useAppSettings();
  const videoExport = useVideoExport();
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<SourceProbe | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // The preset Retry reuses (FR12).
  const lastChoiceRef = useRef<VideoExportChoice>({ presetId: "balanced", framing: null });

  // The sheet's estimates need the real size, rate and duration; there is no <video> to ask
  // here, so read them from the file (container metadata + a few packets).
  const open = async (): Promise<void> => {
    if (probing) return;
    setProbing(true);
    const result = probe ?? (await probeSource(video.id));
    setProbing(false);
    if (!result || result.width === 0 || result.height === 0 || result.durationSec <= 0) {
      showToast({ message: t("shareReadError") });
      return;
    }
    setProbe(result);
    setSheetOpen(true);
  };

  const start = (choice: VideoExportChoice = lastChoiceRef.current): void => {
    if (!probe) return;
    lastChoiceRef.current = choice;
    void videoExport.start({
      scene: initialScene(probe.durationSec),
      sourceId: video.id,
      title: video.title,
      derivedFromAssetId: video.assetId,
      videoWidth: probe.width,
      videoHeight: probe.height,
      previewWidth: probe.width,
      slideAssets: createSlideAssetStore(),
      cameraPath: null,
      presetId: choice.presetId,
      framing: choice.framing,
      sourceInfo: probe,
      fingerprint: WHOLE_RECORDING_FINGERPRINT,
      onSaved: (recording) => {
        try {
          onSaved(recording);
        } catch (error) {
          captureException(error, { context: "share-saved" });
        }
        showExportSavedToast(tEditor, choice.presetId, recording);
      },
    });
  };

  return (
    <>
      <Button
        variant="primary"
        size="sm"
        onClick={() => void open()}
        disabled={probing}
        title={t("shareHint")}
      >
        <Share2 size={15} strokeWidth={1.8} />
        {t("share")}
      </Button>

      {sheetOpen && probe && (
        <ExportSheet
          title={t("shareTitle")}
          timelineDuration={probe.durationSec}
          sourceWidth={probe.width}
          estimate={IDLE_GIF_ESTIMATE}
          gifEnabled={false}
          presetSource={{
            width: probe.width,
            height: probe.height,
            fps: probe.fps,
            hasAudio: probe.hasAudio,
            sampleRate: probe.sampleRate,
          }}
          defaultPreset={appSettings.settings?.exportQuality}
          reusable={findReusableExports(exports, WHOLE_RECORDING_FINGERPRINT)}
          onOpenExisting={(existing) => {
            setSheetOpen(false);
            onOpenExisting(existing);
          }}
          onGifSettingsChange={() => {}}
          onExportVideo={(choice) => {
            setSheetOpen(false);
            start(choice);
          }}
          onExportGif={() => {}}
          onCancel={() => setSheetOpen(false)}
        />
      )}

      {videoExport.status !== "idle" && (
        <ExportDialog
          status={videoExport.status}
          fraction={videoExport.fraction}
          error={videoExport.error}
          title={videoExport.shrinking ? tEditor("makingSmaller") : undefined}
          onCancel={videoExport.cancel}
          onRetry={() => start()}
        />
      )}
    </>
  );
}
