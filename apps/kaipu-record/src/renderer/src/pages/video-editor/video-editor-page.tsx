import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Pause, Play } from "lucide-react";
import { initialScene } from "@renderer/features/video-editor/scene";
import {
  clampOverlays,
  entryAt,
  layoutDuration,
  removeItem,
  splitClipAt,
  toLayout,
} from "@renderer/features/video-editor/timeline";
import { usePreviewPlayback } from "@renderer/features/video-editor/use-preview-playback";
import { useSourceThumbnails } from "@renderer/features/video-editor/use-source-thumbnails";
import { useVideoScene } from "@renderer/features/video-editor/use-video-scene";
import { EditorToolbar } from "@renderer/features/video-editor/components/editor-toolbar";
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
  const controller = useVideoScene(
    useMemo(() => initialScene(source.durationSeconds), [source.durationSeconds]),
  );
  const { scene } = controller;
  const layout = useMemo(() => toLayout(scene.items), [scene.items]);
  const playback = usePreviewPlayback(layout);
  const mediaUrl = `kaipu-media://recording/${source.id}`;
  const thumbnails = useSourceThumbnails(mediaUrl, source.durationSeconds);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  // A selection can outlive its item: undo/redo may restore a scene where the id is
  // gone, and split replaces the original item with two fresh ids. Clear it so
  // delete's disabled state and the highlighted block stay accurate.
  useEffect(() => {
    if (selectedItemId && !scene.items.some((item) => item.id === selectedItemId)) {
      setSelectedItemId(null);
    }
  }, [scene.items, selectedItemId]);

  const splitDisabled = entryAt(layout, playback.timelineTime)?.kind !== "clip";
  // An empty timeline has nothing to export and nothing to click — never let delete
  // remove the last remaining item.
  const deleteDisabled = selectedItemId === null || scene.items.length <= 1;

  const handleSplit = useCallback(() => {
    const items = splitClipAt(scene.items, playback.timelineTime);
    if (items === scene.items) return; // no-op split (slide, boundary) — no history entry
    controller.commit({ ...scene, items });
  }, [scene, controller, playback.timelineTime]);

  const handleDeleteSelected = useCallback(() => {
    if (!selectedItemId || scene.items.length <= 1) return;
    const items = removeItem(scene.items, selectedItemId);
    const duration = layoutDuration(toLayout(items));
    controller.commit({ ...scene, items, overlays: clampOverlays(scene.overlays, duration) });
    setSelectedItemId(null);
    // Deleting the segment under the playhead leaves the playhead past the ripple —
    // clamp it back into the new timeline.
    playback.seek(Math.min(playback.timelineTime, duration));
  }, [scene, controller, selectedItemId, playback]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isEditingTarget(e.target)) return;
      if (e.key === " ") {
        e.preventDefault();
        playback.toggle();
        return;
      }
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) controller.redo();
        else controller.undo();
        return;
      }
      if (!isMod && e.key.toLowerCase() === "s") {
        if (!splitDisabled) handleSplit();
        return;
      }
      // Plan 04 adds annotation selection, which takes precedence over segment
      // deletion for Delete/Backspace — not implemented yet, so segment delete owns
      // the key for now.
      if (e.key === "Delete" || e.key === "Backspace") {
        if (!deleteDisabled) handleDeleteSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playback, controller, splitDisabled, deleteDisabled, handleSplit, handleDeleteSelected]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{source.title}</h1>
      </header>
      <EditorToolbar
        canUndo={controller.canUndo}
        canRedo={controller.canRedo}
        onUndo={controller.undo}
        onRedo={controller.redo}
        onSplit={handleSplit}
        splitDisabled={splitDisabled}
        onDeleteSelected={handleDeleteSelected}
        deleteDisabled={deleteDisabled}
      />
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
