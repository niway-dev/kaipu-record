import { useEffect, useMemo, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Pause, Play } from "lucide-react";
import { initialScene } from "@renderer/features/video-editor/scene";
import { toLayout } from "@renderer/features/video-editor/timeline";
import { usePreviewPlayback } from "@renderer/features/video-editor/use-preview-playback";
import { useSourceThumbnails } from "@renderer/features/video-editor/use-source-thumbnails";
import { PreviewStage } from "@renderer/features/video-editor/components/preview-stage";
import { TimelineStrip } from "@renderer/features/video-editor/components/timeline-strip";
import styles from "./video-editor-page.module.css";

export interface VideoEditorSource {
  id: string;
  title: string;
  durationSeconds: number;
}

function isVideoEditorSource(value: unknown): value is VideoEditorSource {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.title === "string" &&
    typeof v.durationSeconds === "number" &&
    v.durationSeconds > 0
  );
}

/** Target is a text field — don't hijack Space for play/pause while typing. */
function isEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function VideoEditorPage(): React.JSX.Element {
  const location = useLocation();
  const source = location.state;
  if (!isVideoEditorSource(source)) return <Navigate to="/library" replace />;
  // Remount per navigation so a different recording never inherits editor state.
  return <VideoEditor key={location.key} source={source} />;
}

function VideoEditor({ source }: { source: VideoEditorSource }): React.JSX.Element {
  useEffect(() => {
    // Same window growth the screenshot editor uses; restored on unmount.
    window.electronAPI.setEditorWindowMode(true);
    return () => window.electronAPI.setEditorWindowMode(false);
  }, []);

  // Memoized so item ids stay stable across re-renders — otherwise layout entry
  // ids churn every render, breaking selection matching and remounting blocks.
  const scene = useMemo(() => initialScene(source.durationSeconds), [source.durationSeconds]);
  const layout = useMemo(() => toLayout(scene.items), [scene.items]);
  const playback = usePreviewPlayback(layout);
  const mediaUrl = `kaipu-media://recording/${source.id}`;
  const thumbnails = useSourceThumbnails(mediaUrl, source.durationSeconds);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isEditingTarget(e.target)) return;
      if (e.key === " ") {
        e.preventDefault();
        playback.toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playback]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{source.title}</h1>
      </header>
      <main className={styles.stage}>
        <div className={styles.stageContent}>
          <PreviewStage playback={playback} mediaUrl={mediaUrl} />
          <div className={styles.transport}>
            <button
              type="button"
              className={styles.playButton}
              aria-label={playback.playing ? "Pausar" : "Reproducir"}
              onClick={playback.toggle}
            >
              {playback.playing ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <span className={styles.timeDisplay}>
              {formatTime(playback.timelineTime)} / {formatTime(playback.duration)}
            </span>
          </div>
        </div>
      </main>
      <footer className={styles.timeline}>
        <TimelineStrip
          layout={layout}
          playback={playback}
          thumbnails={thumbnails}
          selectedItemId={selectedItemId}
          onSelectItem={setSelectedItemId}
        />
      </footer>
    </div>
  );
}
