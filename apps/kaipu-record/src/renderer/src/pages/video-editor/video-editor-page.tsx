import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useBlocker, useLocation } from "react-router-dom";
import { Pause, Play, Trash2, TriangleAlert } from "lucide-react";
import { initialScene, type VideoOverlay } from "@renderer/features/video-editor/scene";
import {
  ModalActions,
  ModalButton,
  ModalIcon,
  ModalOverlay,
  ModalText,
  ModalTitle,
} from "@renderer/ui/modal";
import {
  clampOverlays,
  entryAt,
  layoutDuration,
  removeItem,
  splitClipAt,
  toLayout,
  trimClip,
} from "@renderer/features/video-editor/timeline";
import { usePreviewPlayback } from "@renderer/features/video-editor/use-preview-playback";
import { useSourceThumbnails } from "@renderer/features/video-editor/use-source-thumbnails";
import { useVideoScene } from "@renderer/features/video-editor/use-video-scene";
import { useVideoTools } from "@renderer/features/video-editor/annotations/video-tools";
import { VideoAnnotationLayer } from "@renderer/features/video-editor/annotations/video-annotation-layer";
import { EditorToolbar } from "@renderer/features/video-editor/components/editor-toolbar";
import { OverlayOptions } from "@renderer/features/video-editor/components/overlay-options";
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

/** Replace the overlay with the same id, or append it if none exists yet — used to
 *  reflect a live move/resize (VideoAnnotationLayer's onDraft) into the scene. */
function upsertOverlay(overlays: VideoOverlay[], next: VideoOverlay): VideoOverlay[] {
  const i = overlays.findIndex((o) => o.id === next.id);
  return i === -1 ? [...overlays, next] : overlays.map((o, idx) => (idx === i ? next : o));
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
  // Blocks in-app navigation (e.g. the sidebar) while there's an edit that would be
  // lost — same useBlocker pattern as the screenshot editor.
  const blocker = useBlocker(controller.dirty);
  const playback = usePreviewPlayback(layout);
  const videoTools = useVideoTools();
  const mediaUrl = `kaipu-media://recording/${source.id}`;
  const thumbnails = useSourceThumbnails(mediaUrl, source.durationSeconds);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  // A delete must clamp the playhead into the new (shorter) timeline, but the preview
  // hook's layoutRef only picks up the new layout on the NEXT render — seeking
  // synchronously here would map the target time through the stale, pre-delete layout.
  // Queue it and let the effect below (keyed on `layout`) fire the actual seek once
  // layoutRef has caught up.
  const pendingSeekRef = useRef<number | null>(null);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);

  // A selection can outlive its item: undo/redo may restore a scene where the id is
  // gone, and split replaces the original item with two fresh ids. Clear it so
  // delete's disabled state and the highlighted block stay accurate.
  useEffect(() => {
    if (selectedItemId && !scene.items.some((item) => item.id === selectedItemId)) {
      setSelectedItemId(null);
    }
  }, [scene.items, selectedItemId]);

  // Same rationale for the annotation selection: undo/redo or a timeline edit that
  // clamps overlays (clampOverlays) can drop the selected overlay out from under it.
  useEffect(() => {
    if (selectedOverlayId && !scene.overlays.some((o) => o.id === selectedOverlayId)) {
      setSelectedOverlayId(null);
    }
  }, [scene.overlays, selectedOverlayId]);

  // Which overlays the playhead currently falls inside — the annotation layer only
  // draws these (plus the selected one, dimmed, so it stays editable off-window).
  const visibleIds = useMemo(() => {
    const t = playback.timelineTime;
    return new Set(scene.overlays.filter((o) => t >= o.start && t <= o.end).map((o) => o.id));
  }, [scene.overlays, playback.timelineTime]);

  const splitDisabled = entryAt(layout, playback.timelineTime)?.kind !== "clip";
  // An empty timeline has nothing to export and nothing to click — never let delete
  // remove the last remaining item.
  const deleteDisabled = selectedItemId === null || scene.items.length <= 1;

  const handleSplit = useCallback(() => {
    // A live trim drag owns the scene via begin/updateLive/endInteract; commit() would
    // silently no-op mid-drag but we'd still race the drag by reading a stale `scene`.
    if (controller.interacting) return;
    const items = splitClipAt(scene.items, playback.timelineTime);
    if (items === scene.items) return; // no-op split (slide, boundary) — no history entry
    controller.commit({ ...scene, items });
  }, [scene, controller, playback.timelineTime]);

  const handleDeleteSelected = useCallback(() => {
    // Same rationale as handleSplit: don't clear the selection or queue a seek for a
    // commit that would no-op while a trim drag is in progress.
    if (controller.interacting) return;
    if (!selectedItemId || scene.items.length <= 1) return;
    const items = removeItem(scene.items, selectedItemId);
    const duration = layoutDuration(toLayout(items));
    controller.commit({ ...scene, items, overlays: clampOverlays(scene.overlays, duration) });
    setSelectedItemId(null);
    // Deleting the segment under the playhead leaves the playhead past the ripple —
    // clamp it back into the new timeline (deferred; see pendingSeekRef above).
    pendingSeekRef.current = Math.min(playback.timelineTime, duration);
  }, [scene, controller, selectedItemId, playback]);

  const handleDeleteOverlay = useCallback(() => {
    // Same rationale as handleDeleteSelected: don't touch scene/selection while a
    // move/resize drag owns it via begin/updateLive/endInteract.
    if (controller.interacting) return;
    if (!selectedOverlayId) return;
    const overlays = scene.overlays.filter((o) => o.id !== selectedOverlayId);
    controller.commit({ ...scene, overlays });
    setSelectedOverlayId(null);
  }, [scene, controller, selectedOverlayId]);

  // Options-panel edits (colour/stroke/text-size) on the selected overlay — one
  // undoable commit per change, same contract as the screenshot editor's
  // scene.commitAnnotation.
  const handleCommitOverlay = useCallback(
    (id: string, patch: Partial<VideoOverlay>) => {
      controller.commit({
        ...scene,
        overlays: scene.overlays.map((o) =>
          o.id === id ? ({ ...o, ...patch } as VideoOverlay) : o,
        ),
      });
    },
    [scene, controller],
  );

  // Fires the deferred seek queued by handleDeleteSelected once `layout` (and therefore
  // the preview hook's layoutRef, which is assigned during render) reflects the post-
  // delete items.
  useEffect(() => {
    if (pendingSeekRef.current === null) return;
    const target = pendingSeekRef.current;
    pendingSeekRef.current = null;
    playback.seek(target);
  }, [layout, playback]);

  // Trim drags don't go through commit(): a continuous drag must collapse into one
  // undo step, so "move" only updates the live scene and "start"/"end" own history.
  const handleTrim = useCallback(
    (
      itemId: string,
      edge: "start" | "end",
      sourceTime: number,
      phase: "start" | "move" | "end",
    ) => {
      if (phase === "start") controller.beginInteract();
      if (phase === "move") {
        const items = trimClip(controller.scene.items, itemId, edge, sourceTime);
        const duration = layoutDuration(toLayout(items));
        controller.updateLive({
          ...controller.scene,
          items,
          overlays: clampOverlays(controller.scene.overlays, duration),
        });
      }
      if (phase === "end") controller.endInteract();
    },
    [controller],
  );

  // Same begin/live/end contract as handleTrim, driving the overlay lane's pill
  // body-drag (move) and end-handle (resize) interactions.
  const handleWindowChange = useCallback(
    (id: string, start: number, end: number, phase: "start" | "move" | "end") => {
      if (phase === "start") controller.beginInteract();
      if (phase === "move") {
        controller.updateLive({
          ...controller.scene,
          overlays: controller.scene.overlays.map((o) =>
            o.id === id ? ({ ...o, start, end } as VideoOverlay) : o,
          ),
        });
      }
      if (phase === "end") controller.endInteract();
    },
    [controller],
  );

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
      // Annotation selection takes precedence over segment deletion when both exist —
      // an annotation is almost always the more "local" thing the user just touched.
      // Cmd/Ctrl+Backspace is a common "delete line/word" chord in text contexts —
      // require !isMod so it doesn't also delete an overlay or a segment.
      if (!isMod && (e.key === "Delete" || e.key === "Backspace")) {
        if (selectedOverlayId) handleDeleteOverlay();
        else if (!deleteDisabled) handleDeleteSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    playback,
    controller,
    splitDisabled,
    deleteDisabled,
    handleSplit,
    handleDeleteSelected,
    selectedOverlayId,
    handleDeleteOverlay,
  ]);

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
        tool={videoTools.tool}
        onToolChange={videoTools.setTool}
      />
      <main className={styles.stage}>
        {/* Floating per-tool options (Excalidraw-style), pinned to the stage so it
            doesn't shift with the video's own size. */}
        <div className={styles.optionsFloat}>
          <OverlayOptions
            tools={videoTools}
            overlays={scene.overlays}
            selectedId={selectedOverlayId}
            onCommitOverlay={handleCommitOverlay}
            onDeleteSelected={handleDeleteOverlay}
          />
        </div>
        <div className={styles.stageContent}>
          <PreviewStage
            playback={playback}
            mediaUrl={mediaUrl}
            overlay={
              <VideoAnnotationLayer
                overlays={scene.overlays}
                visibleIds={visibleIds}
                selectedId={selectedOverlayId}
                onSelect={setSelectedOverlayId}
                tool={videoTools.tool}
                toolState={{
                  color: videoTools.color,
                  stroke: videoTools.stroke,
                  textSize: videoTools.textSize,
                }}
                playheadTime={playback.timelineTime}
                timelineDuration={playback.duration}
                onDraft={(draft) =>
                  controller.updateLive({
                    ...scene,
                    overlays: upsertOverlay(scene.overlays, draft),
                  })
                }
                onCommit={(overlays) => {
                  controller.commit({ ...scene, overlays });
                  // Every onCommit call is a just-finished draw or text label (moves/
                  // resizes finalize through onInteractEnd only) — auto-switch back to
                  // select so the new overlay can be adjusted right away.
                  videoTools.setTool("select");
                }}
                onInteractStart={controller.beginInteract}
                onInteractEnd={controller.endInteract}
                onBackgroundClick={playback.toggle}
              />
            }
          />
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
          onTrim={handleTrim}
          overlays={scene.overlays}
          selectedOverlayId={selectedOverlayId}
          onSelectOverlay={setSelectedOverlayId}
          onWindowChange={handleWindowChange}
        />
      </footer>
      {blocker.state === "blocked" && (
        <ModalOverlay onCancel={() => blocker.reset()} labelledBy="discard-video-dialog-title">
          <ModalIcon tone="danger">
            <TriangleAlert size={20} strokeWidth={1.8} />
          </ModalIcon>
          <ModalTitle id="discard-video-dialog-title">¿Descartar los cambios del video?</ModalTitle>
          <ModalText>Tienes ediciones sin guardar. Si sales ahora, se pierden.</ModalText>
          <ModalActions>
            <ModalButton variant="ghost" onClick={() => blocker.reset()}>
              Seguir editando
            </ModalButton>
            <ModalButton variant="danger" onClick={() => blocker.proceed()}>
              <Trash2 size={15} strokeWidth={1.8} />
              Descartar
            </ModalButton>
          </ModalActions>
        </ModalOverlay>
      )}
    </div>
  );
}
