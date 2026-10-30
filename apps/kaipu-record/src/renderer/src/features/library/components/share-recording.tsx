import { useEffect, useMemo, useState } from "react";
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
import type { ExportPresetId } from "@renderer/features/video-editor/export/export-presets";
import {
  findReusableExports,
  wholeFingerprint,
} from "@renderer/features/video-editor/export/export-reuse";
import { probeSource, type SourceProbe } from "@renderer/features/video-editor/export/probe-source";
import {
  isVideoExportBusy,
  showExportBusyToast,
} from "@renderer/features/video-editor/export/export-runner";
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

export interface ShareRecordingController {
  /**
   * Opens the sheet: on `preset` when given (a "light copy" shortcut asks for GitHub), else
   * on Settings → Export quality.
   */
  open(preset?: ExportPresetId): void;
  /** True while the file is being read for the first open. */
  probing: boolean;
  /** The file's size, frame rate and duration once read; null before (or when unreadable). */
  probe: SourceProbe | null;
  /** The sheet; render it once, anywhere on the page. */
  ui: React.ReactNode;
}

/**
 * Share (NIW2-218), "Share a copy": the editor's export sheet for the whole recording,
 * without opening the editor. It runs the SAME export worker with a trivial plan — one clip
 * over the whole file, no overlays, no slides, no zoom — so there is no second pipeline, and
 * the result is a new library item derived from this one (ADR 0003: the recording itself is
 * never touched). Share by link (cloud) joins this later.
 *
 * A hook rather than a button so a page can open it from more than one place (the Share
 * button, the "heavy to send" banner). `prefetch` reads the file up front, for a page that
 * shows an estimate before anyone clicks.
 */
export function useShareRecording({
  video,
  exports,
  onSaved,
  onOpenExisting,
  prefetch = false,
}: Omit<ShareRecordingProps, "video"> & {
  /** null while there is nothing to share (still loading, a screenshot, no local copy). */
  video: (LibraryVideo & { id: string }) | null;
  prefetch?: boolean;
}): ShareRecordingController {
  const t = useTranslations("library");
  const tEditor = useTranslations("videoEditor");
  const appSettings = useAppSettings();
  const videoExport = useVideoExport();
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<SourceProbe | null>(null);
  // The open sheet and the row it starts on; null while closed.
  const [sheet, setSheet] = useState<{ preset: ExportPresetId | undefined } | null>(null);

  const usable = (p: SourceProbe | null): p is SourceProbe =>
    p !== null && p.width > 0 && p.height > 0 && p.durationSec > 0;

  const videoId = video?.id ?? null;
  // A probe belongs to one file: forget it when the page moves to another recording.
  useEffect(() => {
    setProbe(null);
    if (!prefetch || !videoId) return;
    let alive = true;
    void probeSource(videoId).then((result) => {
      if (alive && usable(result)) setProbe((current) => current ?? result);
    });
    return () => {
      alive = false;
    };
  }, [prefetch, videoId]);

  // The sheet's estimates need the real size, rate and duration; there is no <video> to ask
  // here, so read them from the file (container metadata + a few packets).
  const open = async (preset?: ExportPresetId): Promise<void> => {
    if (probing || !video) return;
    // One export at a time: point at the one already running instead of a second sheet.
    if (isVideoExportBusy()) {
      showExportBusyToast(tEditor);
      return;
    }
    setProbing(true);
    const result = probe ?? (await probeSource(video.id));
    setProbing(false);
    if (!usable(result)) {
      showToast({ message: t("shareReadError") });
      return;
    }
    setProbe(result);
    setSheet({ preset });
  };

  // Share composes the face where the bubble sat during the take (ADR 0033): the scene seeds
  // the layer from the sidecar, and the fingerprint hashes it, so a second Share reuses the
  // file while a pre-webcam one (no face) and an editor export are never mistaken for it.
  const scene = useMemo(
    () => initialScene(probe?.durationSec ?? 0, video?.webcam ?? null),
    [probe?.durationSec, video?.webcam],
  );
  const fingerprint = wholeFingerprint(scene.webcam);

  // Runs in the background (export-runner): the sheet closes, the progress and "Ready to
  // share" cards take over, and leaving this page does not stop it.
  const start = (choice: VideoExportChoice): void => {
    if (!probe || !video) return;
    void videoExport.start({
      scene,
      // The sidecar's webcam: its file is fetched and composed at the recorded layout.
      webcamTrack: video.webcam ?? null,
      sourceId: video.id,
      title: video.title,
      derivedFromAssetId: video.assetId,
      sourceSizeBytes: video.fileSizeBytes,
      videoWidth: probe.width,
      videoHeight: probe.height,
      previewWidth: probe.width,
      slideAssets: createSlideAssetStore(),
      cameraPath: null,
      presetId: choice.presetId,
      framing: choice.framing,
      sourceInfo: probe,
      fingerprint,
      onSaved: (recording) => {
        try {
          onSaved(recording);
        } catch (error) {
          captureException(error, { context: "share-saved" });
        }
      },
    });
  };

  const ui = (
    <>
      {sheet && probe && video && (
        <ExportSheet
          title={t("shareTitle")}
          sourceTitle={video.title}
          sourceSizeBytes={video.fileSizeBytes}
          thumbnailUrl={video.thumbnailUrl ?? null}
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
          defaultPreset={sheet.preset ?? appSettings.settings?.exportQuality}
          reusable={findReusableExports(exports, fingerprint)}
          onOpenExisting={(existing) => {
            setSheet(null);
            onOpenExisting(existing);
          }}
          onGifSettingsChange={() => {}}
          onExportVideo={(choice) => {
            setSheet(null);
            start(choice);
          }}
          onExportGif={() => {}}
          onCancel={() => setSheet(null)}
        />
      )}
    </>
  );

  return { open: (preset) => void open(preset), probing, probe, ui };
}

/** The Share button with its sheet, for a page that opens Share from one place only. */
export function ShareRecording(props: ShareRecordingProps): React.JSX.Element {
  const t = useTranslations("library");
  const share = useShareRecording(props);
  return (
    <>
      <ShareButton onClick={() => share.open()} disabled={share.probing} title={t("shareHint")}>
        {t("share")}
      </ShareButton>
      {share.ui}
    </>
  );
}

/** The primary Share button (icon + label), shared by the page and `ShareRecording`. */
export function ShareButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick(): void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Button variant="primary" size="sm" onClick={onClick} disabled={disabled} title={title}>
      <Share2 size={15} strokeWidth={1.8} />
      {children}
    </Button>
  );
}
