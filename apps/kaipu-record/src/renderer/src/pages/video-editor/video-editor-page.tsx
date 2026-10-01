import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useBlocker, useLocation, useNavigate } from "react-router-dom";
import {
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Shield,
  Trash2,
  TriangleAlert,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { parseCursorTrack, type CursorTrack } from "@shared/cursor-track";
import { captureException } from "@renderer/features/analytics";
import {
  initialScene,
  newId,
  type SlideItem,
  type VideoOverlay,
  type VideoScene,
} from "@renderer/features/video-editor/scene";
import {
  ModalActions,
  ModalButton,
  ModalIcon,
  ModalOverlay,
  ModalText,
  ModalTitle,
} from "@renderer/ui/modal";
import { Badge } from "@renderer/ui/badge";
import {
  boundaryIndexAt,
  clampOverlays,
  entryAt,
  insertItemAt,
  layoutDuration,
  removeItem,
  setSlideDuration,
  splitClipAt,
  toLayout,
  trimClip,
} from "@renderer/features/video-editor/timeline";
import {
  createSlideAssetStore,
  type SlideAsset,
  type SlideAssetStore,
} from "@renderer/features/video-editor/slide-assets";
import { parseSession, serializeSession } from "@renderer/features/video-editor/session";
import { withInitialZooms } from "@renderer/features/video-editor/initial-zooms";
import { useEditorSelection } from "@renderer/features/video-editor/editor-selection";
import {
  sourceRangeToTimelineBlocks,
  sourceTimeAtTimeline,
} from "@renderer/features/video-editor/source-time";
import { activityMarks } from "@renderer/features/video-editor/zoom/detect-zoom-segments";
import { useZoomEditing } from "@renderer/features/video-editor/zoom/use-zoom-editing";
import { seekTargetForSegment } from "@renderer/features/video-editor/zoom/select-seek";
import { focusInspectorFirstControl } from "@renderer/features/video-editor/focus-inspector";
import { ActivityLane } from "@renderer/features/video-editor/components/activity-lane";
import { ZoomLane } from "@renderer/features/video-editor/components/zoom-lane";
import { EditorInspector } from "@renderer/features/video-editor/components/inspector/editor-inspector";
import { DetectionPanel } from "@renderer/features/video-editor/components/inspector/detection-panel";
import { ZoomInspector } from "@renderer/features/video-editor/components/inspector/zoom-inspector";
import {
  AnnotationDefaultsPanel,
  AnnotationInspector,
} from "@renderer/features/video-editor/components/inspector/annotation-inspector";
import { boxCenterAt, CameraBox } from "@renderer/features/video-editor/components/camera-box";
import { HoldOriginalButton } from "@renderer/features/video-editor/components/hold-original-button";
import { useCameraPath } from "@renderer/features/video-editor/zoom/use-camera-path";
import { useCameraPreview } from "@renderer/features/video-editor/zoom/use-camera-preview";
import {
  isPrivacyTool,
  type EditorTool,
} from "@renderer/features/video-editor/annotations/video-tools";
import type { NormRect } from "@renderer/features/video-editor/privacy/redaction";
import { useRedactionEditing } from "@renderer/features/video-editor/privacy/use-redaction-editing";
import { RedactionLayer } from "@renderer/features/video-editor/components/redaction-layer";
import { RegionDrawer } from "@renderer/features/video-editor/components/region-drawer";
import { RegionEditor } from "@renderer/features/video-editor/components/region-editor";
import { PrivacyLane } from "@renderer/features/video-editor/components/privacy-lane";
import { BlurInspector } from "@renderer/features/video-editor/components/inspector/blur-inspector";
import { CoverInspector } from "@renderer/features/video-editor/components/inspector/cover-inspector";
import { formatPrecise } from "@renderer/features/video-editor/components/inspector/format";
import { useSessionAutosave } from "@renderer/features/video-editor/use-session-autosave";
import { usePreviewPlayback } from "@renderer/features/video-editor/use-preview-playback";
import { useSourceThumbnails } from "@renderer/features/video-editor/use-source-thumbnails";
import { useVideoScene } from "@renderer/features/video-editor/use-video-scene";
import { useVideoTools } from "@renderer/features/video-editor/annotations/video-tools";
import { useVideoExport } from "@renderer/features/video-editor/export/use-video-export";
import { VideoAnnotationLayer } from "@renderer/features/video-editor/annotations/video-annotation-layer";
import {
  EditorToolbar,
  EditorToolRail,
} from "@renderer/features/video-editor/components/editor-toolbar";
import { ExportDialog } from "@renderer/features/video-editor/components/export-dialog";
import { PreviewStage } from "@renderer/features/video-editor/components/preview-stage";
import { TimelineStrip } from "@renderer/features/video-editor/components/timeline-strip";
import { showToast } from "@renderer/ui/toast-store";
import styles from "./video-editor-page.module.css";
import { useWindowPreset } from "@renderer/shell/use-window-preset";

export interface VideoEditorSource {
  id: string;
  /** The source recording's stable identity — recorded on the export as provenance. */
  assetId: string;
  title: string;
  durationSeconds: number;
}

function isVideoEditorSource(value: unknown): value is VideoEditorSource {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.assetId === "string" &&
    typeof v.title === "string" &&
    typeof v.durationSeconds === "number" &&
    v.durationSeconds > 0
  );
}

/**
 * Keyboard shortcuts for the tool group (plans/video-editor-v2/08 § PR 10 polish),
 * mirroring EditorToolbar's own tooltips: V/R/A/T pick an annotation tool, B/C a
 * privacy drawing mode. Z (add/select a zoom) is handled separately — it is an action,
 * not a tool (see editor-toolbar.tsx's TOOL_HINT comment).
 */
const PRIVACY_SHORTCUT_TOOLS = new Set<EditorTool>(["blur", "cover"]);

// A Map, not an object literal: `"constructor" in {}` is true and
// `({})["constructor"]` returns a function, so an object lookup keyed by arbitrary
// `e.key` values resolves inherited members as if they were tools. No real keyboard
// produces those keys, but the lookup should not be the thing standing between us and
// that — a Map has no prototype chain to walk.
const TOOL_SHORTCUT_KEYS = new Map<string, EditorTool>([
  ["v", "select"],
  ["r", "box"],
  ["a", "arrow"],
  ["t", "text"],
  ["b", "blur"],
  ["c", "cover"],
]);

/**
 * Which tool a one-letter shortcut selects, or null when this shortcut must not fire.
 *
 * The gate exists because the toolbar disables Blur/Cover on a slide
 * (`privacyDisabled={onSlide}`) and the keyboard has to agree with it: there is no
 * footage to redact under an image, so arming the tool would leave the user drawing
 * into a toast. Split and delete already honour their own disabled flags.
 *
 * Pure and exported so the policy is testable without driving the playhead onto a
 * slide through the timeline UI.
 */
export function toolForShortcut(key: string, opts: { onSlide: boolean }): EditorTool | null {
  const tool = TOOL_SHORTCUT_KEYS.get(key);
  if (!tool) return null;
  if (PRIVACY_SHORTCUT_TOOLS.has(tool) && opts.onSlide) return null;
  return tool;
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
  return <VideoEditorLoader key={location.key} source={source} />;
}

/**
 * Async loading wrapper: loads any saved edit session before rendering the actual
 * editor, so `useVideoScene` always gets the correct initial scene on first render.
 * Without this split, `useVideoScene` would receive the fresh fallback scene before
 * the session IPC returns, and re-initializing a hook with a different value isn't
 * possible in React.
 */
function VideoEditorLoader({ source }: { source: VideoEditorSource }): React.JSX.Element {
  const t = useTranslations("videoEditor");
  // Asset store lives here so it can be populated by the session loader and passed
  // down to the editor without being torn down between the two renders.
  const assetStoreRef = useRef<SlideAssetStore>(createSlideAssetStore());
  useEffect(() => {
    return () => assetStoreRef.current.dispose();
  }, []);

  // The room this screen needs; released when it unmounts. See use-window-floor.
  useWindowPreset("videoEditor");

  /**
   * The recording's name lives in the window title, not in a header row. It is
   * reference, never a control, and a full-width row for one static string is
   * width the timeline needs more.
   */
  useEffect(() => {
    const previous = document.title;
    document.title = source.title;
    return () => {
      document.title = previous;
    };
  }, [source.title]);

  const [resolved, setResolved] = useState<{
    scene: VideoScene;
    cursorTrack: CursorTrack | null;
  } | null>(null);

  useEffect(() => {
    // Guards against calling restoreAsset or setting state after unmount —
    // without this, a mid-load unmount would run dispose() (other effect) and
    // then restoreAsset would recreate object URLs that are never revoked.
    let cancelled = false;
    void (async () => {
      // The cursor track is best-effort and independent of the session: a missing or
      // malformed track just means no auto zooms (the editor behaves as before v2).
      let cursorTrack: CursorTrack | null = null;
      try {
        const trackJson = await window.electronAPI.loadCursorTrack(source.id);
        cursorTrack = trackJson ? parseCursorTrack(trackJson) : null;
      } catch {
        cursorTrack = null;
      }
      if (cancelled) return;
      // Initial detection happens HERE, before useVideoScene exists, so it is part of the
      // initial scene — not a commit — and merely opening the editor is not an edit.
      const open = (scene: VideoScene, hasZoomData: boolean): void => {
        if (cancelled) return;
        setResolved({
          scene: withInitialZooms(scene, hasZoomData, cursorTrack, source.durationSeconds),
          cursorTrack,
        });
      };
      try {
        const saved = await window.electronAPI.loadVideoEditSession(source.id);
        if (cancelled) return;
        if (saved !== null) {
          const session = parseSession(saved.sessionJson);
          if (session !== null) {
            // Hydrate the asset store with the known assetIds so restored slide items
            // can still reference them by id. All assets come back as raw bytes
            // (written as PNG by the main handler).
            const loadedIds = new Set<string>();
            for (const { assetId, bytes } of saved.assets) {
              if (cancelled) return; // bail before creating a URL that would leak
              await assetStoreRef.current.restoreAsset(assetId, bytes, "image/png");
              loadedIds.add(assetId);
            }
            if (cancelled) return;
            // Drop slide items whose asset wasn't returned (e.g. file was deleted on
            // disk) rather than leaving broken references that the worker can't render.
            const filteredScene: VideoScene = {
              ...session.scene,
              items: session.scene.items.filter(
                (item) => item.kind !== "slide" || loadedIds.has(item.assetId),
              ),
            };
            showToast({ message: t("restored") });
            open(filteredScene, session.hasZoomData);
          } else {
            // Session file exists but is invalid (schema changed, corruption, etc.).
            showToast({ message: t("restoreError") });
            open(initialScene(source.durationSeconds), false);
          }
        } else {
          // No saved session — fresh start, no toast.
          open(initialScene(source.durationSeconds), false);
        }
      } catch {
        // IPC failure is non-fatal; open a fresh editor without surfacing the error.
        open(initialScene(source.durationSeconds), false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []); // [] correct: source is stable per VideoEditorPage's key={location.key}

  if (resolved === null) {
    // Brief loading state while the session IPC resolves. The editor grows the window
    // on mount; showing a blank page here avoids a visible size jump.
    return <div className={styles.page} />;
  }

  return (
    <VideoEditor
      source={source}
      resolvedScene={resolved.scene}
      cursorTrack={resolved.cursorTrack}
      assetStoreRef={assetStoreRef}
    />
  );
}

function VideoEditor({
  source,
  resolvedScene,
  cursorTrack,
  assetStoreRef,
}: {
  source: VideoEditorSource;
  resolvedScene: VideoScene;
  /** Parsed `.cursor.json`, or null (no track / window source / pre-v2 recording). */
  cursorTrack: CursorTrack | null;
  assetStoreRef: React.MutableRefObject<SlideAssetStore>;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const navigate = useNavigate();
  const controller = useVideoScene(resolvedScene);
  const { scene } = controller;
  const layout = useMemo(() => toLayout(scene.items), [scene.items]);
  // Writes the session ~800 ms after every commit/endInteract, and flushes on unmount
  // and beforeunload. See plans/video-editor-v2/07: before this, closing the window
  // threw away every cut, zoom and redaction, because useBlocker below only ever sees
  // in-app navigation.
  const autosave = useSessionAutosave(source.id, scene, controller.interacting, assetStoreRef);
  // Blocks in-app navigation (e.g. the sidebar) while an edit has NOT reached the
  // session file yet — same useBlocker pattern as the screenshot editor, but now about
  // "not written" rather than "edited": with autosave on, an edit that is already on
  // disk is not lost by leaving, so warning about it would be a lie. In practice the
  // dialog therefore appears only inside the debounce window or after a failed write,
  // and its Discard button drops the pending write (`autosave.cancel()`) so it means
  // exactly what it says.
  //
  // The predicate reads a ref instead of a plain boolean: react-router's data router
  // consults it SYNCHRONOUSLY inside `navigate()`, before React has re-rendered, and
  // React 19 batches the state updates that a render-time boolean would depend on.
  // Refs sidestep the batching entirely.
  const pendingSaveRef = autosave.pendingRef;
  // Set to true right before the post-export `navigate()` so that programmatic
  // navigation always proceeds, regardless of batching timing. Normal in-app
  // navigation (e.g. the sidebar) never touches this ref, so it still blocks while a
  // write is pending.
  const bypassBlockerRef = useRef(false);
  const shouldBlock = useCallback(
    () => pendingSaveRef.current && !bypassBlockerRef.current,
    [pendingSaveRef],
  );
  const blocker = useBlocker(shouldBlock);
  const playback = usePreviewPlayback(layout);
  const zooms = useZoomEditing({
    controller,
    layout,
    timelineDuration: playback.duration,
    sourceDuration: source.durationSeconds,
    cursorTrack,
  });
  const redactionEdits = useRedactionEditing({
    controller,
    layout,
    sourceDuration: source.durationSeconds,
  });
  // One camera simulation shared by the preview (useCameraPreview) and the export (doc 05).
  // Declared before any callback that closes over it (handleExport).
  const cameraPath = useCameraPath(scene.zoomSegments, cursorTrack, source.durationSeconds);
  // Evidence for the Activity lane — depends only on the (immutable) track.
  const activity = useMemo(
    () => (cursorTrack ? activityMarks(cursorTrack, source.durationSeconds) : []),
    [cursorTrack, source.durationSeconds],
  );
  const videoTools = useVideoTools();
  const videoExport = useVideoExport();
  const mediaUrl = `kaipu-media://recording/${source.id}`;
  const thumbnails = useSourceThumbnails(mediaUrl, source.durationSeconds);
  const selection = useEditorSelection();
  // `select` / `clear` are stable (useCallback, no deps); the `selection` object itself
  // is rebuilt every render, so never put it in a dependency array.
  const { select: selectKind, clear: clearSelection } = selection;
  const selectedItemId = selection.itemId;
  const selectedOverlayId = selection.overlayId;
  const setSelectedItemId = useCallback(
    (id: string | null) => selectKind("item", id),
    [selectKind],
  );
  const setSelectedOverlayId = useCallback(
    (id: string | null) => selectKind("overlay", id),
    [selectKind],
  );
  // A delete must clamp the playhead into the new (shorter) timeline, but the preview
  // hook's layoutRef only picks up the new layout on the NEXT render — seeking
  // synchronously here would map the target time through the stale, pre-delete layout.
  // Queue it and let the effect below (keyed on `layout`) fire the actual seek once
  // layoutRef has caught up.
  const pendingSeekRef = useRef<number | null>(null);
  // Fullscreen state — true while document.fullscreenElement is this page's <main> stage.
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Ref for the stage <main> element, used to request fullscreen on it directly.
  const stageRef = useRef<HTMLElement | null>(null);

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

  const selectedZoomId = selection.zoomId;
  const selectedRedactionId = selection.redactionId;
  useEffect(() => {
    if (selectedZoomId && !scene.zoomSegments.some((z) => z.id === selectedZoomId)) {
      selectKind("zoom", null);
    }
  }, [scene.zoomSegments, selectedZoomId, selectKind]);
  useEffect(() => {
    if (selectedRedactionId && !scene.redactions.some((r) => r.id === selectedRedactionId)) {
      selectKind("redaction", null);
    }
  }, [scene.redactions, selectedRedactionId, selectKind]);

  // Track fullscreen state via the fullscreenchange event so pressing Esc (which the
  // browser handles natively) still syncs isFullscreen back to false.
  useEffect(() => {
    const onFsChange = (): void => {
      setIsFullscreen(document.fullscreenElement === stageRef.current);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // Toggle the browser's native fullscreen on the stage <main> element. Guard for
  // environments where requestFullscreen may be unavailable (Electron can restrict it).
  const handleFullscreen = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else if ("requestFullscreen" in el) {
      void el.requestFullscreen();
    }
  }, []);

  // Which overlays the playhead currently falls inside — the annotation layer only
  // draws these (plus the selected one, dimmed, so it stays editable off-window).
  const visibleIds = useMemo(() => {
    const t = playback.timelineTime;
    return new Set(scene.overlays.filter((o) => t >= o.start && t <= o.end).map((o) => o.id));
  }, [scene.overlays, playback.timelineTime]);

  // The image for the slide under the playhead, resolved from the in-memory store — the
  // preview stage draws it over the (paused) video while a slide is active.
  const activeSlide = playback.activeSlideId
    ? scene.items.find((item) => item.id === playback.activeSlideId)
    : null;
  const slideUrl =
    activeSlide?.kind === "slide"
      ? (assetStoreRef.current.get(activeSlide.assetId)?.url ?? null)
      : null;

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

  // Inserts a new image slide at the item boundary nearest the playhead — playhead at
  // 0 lands before everything (the intro-card case); mid-clip lands at the closest cut
  // point. Placing a slide mid-clip requires splitting first (predictable, no
  // auto-split). `controller.commit` already no-ops mid-drag, same as every other
  // discrete action here.
  const handleAddImage = useCallback(
    async (file: File) => {
      // Same guard as every other discrete action: don't mutate the scene while a
      // trim or overlay drag owns it via begin/updateLive/endInteract.
      if (controller.interacting) return;
      const bytes = await file.arrayBuffer();
      // Wrap the image decode in a try/catch so a corrupt or unsupported file
      // surfaces a clear toast rather than an unhandled rejection.
      let asset: SlideAsset;
      try {
        asset = await assetStoreRef.current.put(bytes, file.type);
      } catch {
        showToast({ message: t("imageLoadError") });
        return;
      }
      const slide: SlideItem = {
        id: newId(),
        kind: "slide",
        assetId: asset.assetId,
        duration: 3,
        naturalWidth: asset.naturalWidth,
        naturalHeight: asset.naturalHeight,
      };
      const index = boundaryIndexAt(toLayout(scene.items), playback.timelineTime);
      controller.commit({ ...scene, items: insertItemAt(scene.items, index, slide) });
    },
    [scene, controller, playback.timelineTime],
  );

  // Reads the live preview <video>'s native/displayed size at click time (not
  // memoized — the box can resize between renders) and hands off to the export
  // hook, which owns the whole worker/writer pipeline. `markClean` runs before
  // navigating so `useBlocker` doesn't intercept this programmatic navigation.
  const handleExport = useCallback(() => {
    const video = playback.videoRef.current;
    if (!video) return;
    // videoWidth/videoHeight are 0 until the browser has decoded the stream's
    // metadata (loadedmetadata). Starting the export before that hands the worker
    // a 0×0 OffscreenCanvas, which produces a corrupt file — refuse early.
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      showToast({ message: t("videoStillLoading") });
      return;
    }
    void videoExport.start({
      scene,
      sourceId: source.id,
      title: source.title,
      derivedFromAssetId: source.assetId,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      previewWidth: video.clientWidth,
      slideAssets: assetStoreRef.current,
      cameraPath,
      onSaved: async (recording) => {
        // This save supersedes whatever the autosave still had queued; dropping it
        // avoids a second write of the same scene right before unmount.
        autosave.cancel();
        // Persist the session before navigating away so reopening the editor on the
        // original recording restores cuts/overlays/slides. Non-fatal if it fails —
        // the export already succeeded and the user lands on the new recording.
        try {
          const sessionJson = serializeSession(scene);
          const assets = assetStoreRef.current
            .entries()
            .map((a) => ({ assetId: a.assetId, bytes: a.bytes }));
          // `true`: this scene is exactly what was just burned into `recording`, so the
          // write stamps it as exported. Without it the save below would bump `savedAt`
          // past the export and the library would show "not exported" on a recording
          // the user exported seconds ago.
          await window.electronAPI.saveVideoEditSession(source.id, sessionJson, assets, true);
        } catch (error) {
          // Session save failure is non-fatal — the export already succeeded.
          captureException(error, { context: "video-edit-session-save" });
        }
        controller.markClean();
        // Set BEFORE navigate(): react-router calls the blocker predicate
        // synchronously inside navigate(), ahead of React re-rendering — the ref
        // guarantees the predicate observes the bypass regardless of how
        // markClean()'s state updates get batched.
        bypassBlockerRef.current = true;
        navigate(`/library/${recording.assetId}`);
      },
    });
  }, [
    playback,
    videoExport,
    scene,
    source,
    controller,
    navigate,
    assetStoreRef,
    autosave,
    cameraPath,
  ]);

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

  // A slide's right-edge duration drag. Same begin/live/end contract as handleTrim so a
  // continuous drag collapses into one undo step; setSlideDuration clamps to the minimum.
  const handleSlideDuration = useCallback(
    (itemId: string, nextDuration: number, phase: "start" | "move" | "end") => {
      if (phase === "start") controller.beginInteract();
      if (phase === "move") {
        const items = setSlideDuration(controller.scene.items, itemId, nextDuration);
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

  // Selecting a zoom moves the playhead to the middle of its first visible piece (UI
  // spec § 6.3), so the preview shows what the zoom does — but ONLY when the playhead
  // isn't already inside the segment: seeking unconditionally threw away a frame the
  // user had just scrubbed to while positioning the camera box (backlog/video-editor-
  // camera-box-ux § 2, candidate cause A; seekTargetForSegment carries the full
  // rationale and is unit-tested on its own in select-seek.test.ts).
  //
  // Regardless of whether we seek, focus moves into the inspector on the next frame —
  // the lane's own <button> would otherwise keep focus after the click, which is what
  // made the editor look like it "lost focus" (same backlog entry, candidate cause B).
  // Deferred to requestAnimationFrame so it runs after React commits the ZoomInspector
  // for the new selection, per focus-inspector.ts's documented contract.
  const handleSelectZoom = useCallback(
    (id: string) => {
      selectKind("zoom", id);
      const segment = controller.scene.zoomSegments.find((z) => z.id === id);
      if (segment) {
        const target = seekTargetForSegment(layout, playback.timelineTime, segment);
        if (target !== null) playback.seek(target);
      }
      requestAnimationFrame(() => focusInspectorFirstControl());
    },
    [selectKind, controller, layout, playback],
  );

  // Zoom tool (an action, not a mode): select the zoom under the playhead if there is
  // one, otherwise add a manual zoom there.
  const handleAddZoom = useCallback(() => {
    const at = sourceTimeAtTimeline(layout, playback.timelineTime);
    const existing =
      at === null ? undefined : zooms.visibleZooms.find((z) => at >= z.start && at < z.end);
    if (existing) {
      selectKind("zoom", existing.id);
      return;
    }
    const result = zooms.addAtPlayhead(playback.timelineTime);
    if (result.ok) selectKind("zoom", result.id);
    else if (result.reason === "on-slide") showToast({ message: t("zoomNotOnSlide") });
    else if (result.reason === "no-room") showToast({ message: t("zoomNoRoom") });
  }, [layout, playback.timelineTime, zooms, selectKind, t]);

  const handleRemoveZoom = useCallback(
    (id: string) => {
      zooms.remove(id);
      selectKind("zoom", null);
    },
    [zooms, selectKind],
  );

  const selectedZoom = selectedZoomId
    ? (zooms.visibleZooms.find((z) => z.id === selectedZoomId) ?? null)
    : null;
  const selectedOverlay = selectedOverlayId
    ? (scene.overlays.find((o) => o.id === selectedOverlayId) ?? null)
    : null;

  // Privacy (doc 10). While a privacy tool is active or a region is selected the preview
  // shows the unzoomed original frame, so drawing/editing maps 1:1 to frame coordinates.
  const privacyTool = isPrivacyTool(videoTools.tool) ? videoTools.tool : null;
  const onSlide = playback.activeSlideId !== null;
  const [draftRegion, setDraftRegion] = useState<NormRect | null>(null);
  const selectedRedaction = selectedRedactionId
    ? (redactionEdits.visibleRedactions.find((r) => r.id === selectedRedactionId) ?? null)
    : null;
  /** Timeline range covered by a source range's visible pieces (inspector + draw badge). */
  const timelineRangeOf = useCallback(
    (start: number, end: number): { from: number; to: number } => {
      const blocks = sourceRangeToTimelineBlocks(layout, start, end);
      return {
        from: blocks[0]?.timelineStart ?? 0,
        to: blocks[blocks.length - 1]?.timelineEnd ?? 0,
      };
    },
    [layout],
  );
  const drawWindow = privacyTool ? redactionEdits.windowAt(playback.timelineTime) : null;
  const drawRange = drawWindow ? timelineRangeOf(drawWindow.start, drawWindow.end) : null;

  const handleToolChange = useCallback(
    (tool: EditorTool) => {
      // Drawing a region starts from a clean slate: no zoom/region box competing with it.
      if (isPrivacyTool(tool)) clearSelection();
      videoTools.setTool(tool);
    },
    [clearSelection, videoTools],
  );

  const handleCreateRegion = useCallback(
    (rect: NormRect) => {
      if (!privacyTool) return;
      const result = redactionEdits.add(privacyTool, rect, playback.timelineTime);
      if (result.ok) {
        // UI spec § 4.4: on release the region is created, selected, and the tool returns to Select.
        selectKind("redaction", result.id);
        videoTools.setTool("select");
      } else if (result.reason === "on-slide") {
        showToast({ message: t("privacyNotOnSlide") });
      }
    },
    [privacyTool, redactionEdits, playback.timelineTime, selectKind, videoTools, t],
  );

  const handleSelectRedaction = useCallback(
    (id: string) => {
      selectKind("redaction", id);
      const r = controller.scene.redactions.find((x) => x.id === id);
      if (!r) return;
      const [first] = sourceRangeToTimelineBlocks(layout, r.start, r.end);
      if (first) playback.seek((first.timelineStart + first.timelineEnd) / 2);
    },
    [selectKind, controller, layout, playback],
  );

  const handleRemoveRedaction = useCallback(
    (id: string) => {
      redactionEdits.remove(id);
      selectKind("redaction", null);
    },
    [redactionEdits, selectKind],
  );

  // Preview camera (doc 09). Result view applies the camera; selecting a zoom switches to
  // the zoom-edit view (full frame + camera box); holding "original" shows the raw frame.
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [holdingOriginal, setHoldingOriginal] = useState(false);
  // Decoded source height, as STATE. It feeds the soft-zoom hint, and it cannot be read
  // off `playback.videoRef.current.videoHeight` during render: that is 0 until metadata
  // lands and changing it never re-renders, so the hint would appear or not depending on
  // whether some unrelated render happened to arrive after the metadata did.
  const [sourceHeight, setSourceHeight] = useState(0);
  useCameraPreview(
    playback.videoRef,
    contentRef,
    cameraPath,
    !holdingOriginal &&
      selectedZoom === null &&
      selectedRedaction === null &&
      privacyTool === null &&
      !onSlide,
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isEditingTarget(e.target)) return;
      // Don't fire editor shortcuts behind the discard-changes modal or the export
      // dialog — both block the scene from being safely mutated or played while open.
      if (blocker.state === "blocked" || videoExport.status !== "idle") return;
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
      // Tool shortcuts (plans/video-editor-v2/08 § PR 10 polish): V/R/A/T pick an
      // annotation tool, Z adds/selects a zoom at the playhead, B/C pick a privacy
      // drawing mode. Matches EditorToolbar's own tooltips (V R A T / Z / B C).
      const key = e.key.toLowerCase();
      if (!isMod && TOOL_SHORTCUT_KEYS.has(key)) {
        const next = toolForShortcut(key, { onSlide });
        // Through handleToolChange, not videoTools.setTool: the toolbar path clears
        // the selection before arming a privacy tool, and the keyboard must match —
        // otherwise B with a zoom selected leaves the RegionDrawer stacked over the
        // camera box (equal z-index, later sibling wins) and the box is unreachable.
        if (next) handleToolChange(next);
        return;
      }
      if (!isMod && key === "z") {
        handleAddZoom();
        return;
      }
      // `!document.fullscreenElement`: in fullscreen the browser handles Esc itself to
      // leave it — clearing the selection at the same time would be a second, invisible
      // action the user never asked for.
      if (e.key === "Escape" && !document.fullscreenElement) {
        clearSelection();
        return;
      }
      // Annotation selection takes precedence over segment deletion when both exist —
      // an annotation is almost always the more "local" thing the user just touched.
      // Cmd/Ctrl+Backspace is a common "delete line/word" chord in text contexts —
      // require !isMod so it doesn't also delete an overlay or a segment.
      if (!isMod && (e.key === "Delete" || e.key === "Backspace")) {
        if (selectedRedactionId) handleRemoveRedaction(selectedRedactionId);
        else if (selectedZoomId) handleRemoveZoom(selectedZoomId);
        else if (selectedOverlayId) handleDeleteOverlay();
        else if (!deleteDisabled) handleDeleteSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    playback,
    controller,
    blocker.state,
    videoExport.status,
    splitDisabled,
    deleteDisabled,
    handleSplit,
    handleDeleteSelected,
    selectedOverlayId,
    handleDeleteOverlay,
    clearSelection,
    selectedZoomId,
    selectedRedactionId,
    handleRemoveZoom,
    handleRemoveRedaction,
    videoTools,
    handleToolChange,
    handleAddZoom,
    onSlide,
  ]);

  return (
    <div className={styles.page}>
      <EditorToolbar
        canUndo={controller.canUndo}
        canRedo={controller.canRedo}
        onUndo={controller.undo}
        onRedo={controller.redo}
        onSplit={handleSplit}
        splitDisabled={splitDisabled}
        onDeleteSelected={handleDeleteSelected}
        deleteDisabled={deleteDisabled}
        onAddImage={handleAddImage}
        tool={videoTools.tool}
        onExport={handleExport}
        exportDisabled={videoExport.status === "exporting" || scene.items.length === 0}
      >
        {/* Not interactive — a reminder, not a control (plans/video-editor-v2/08 § PR 10
            polish, W12's "ORIGINAL UNTOUCHED" pill). The original recording on disk and
            its library thumbnail are untouched by every edit in this page. */}
        <Badge variant="neutral" className={styles.originalPill}>
          <Shield size={12} strokeWidth={2} /> {t("originalUntouched")}
        </Badge>
        {autosave.state !== "idle" && (
          <button
            type="button"
            className={styles.saveState}
            data-state={autosave.state}
            onClick={autosave.state === "failed" ? () => void autosave.retry() : undefined}
            disabled={autosave.state !== "failed"}
            aria-live="polite"
          >
            {autosave.state === "saving" && t("saveStateSaving")}
            {autosave.state === "saved" && t("saveStateSaved")}
            {autosave.state === "failed" && t("saveStateFailed")}
          </button>
        )}
      </EditorToolbar>
      <div className={styles.workspace}>
        <EditorToolRail
          tool={videoTools.tool}
          onToolChange={handleToolChange}
          onAddZoom={handleAddZoom}
          privacyDisabled={onSlide}
        />
        <main className={styles.stage} ref={stageRef}>
          {/* Video region: 1fr grid row — centers PreviewStage and constrains its height
              so the transport bar below is never clipped regardless of video aspect ratio.
              In fullscreen mode the 50 vh cap is lifted via an inline style override. */}
          <div
            className={styles.videoRegion}
            style={isFullscreen ? { maxHeight: "none" } : undefined}
          >
            <PreviewStage
              playback={playback}
              mediaUrl={mediaUrl}
              slideUrl={slideUrl}
              expanded={isFullscreen}
              contentRef={contentRef}
              onFrameSize={({ height }) => setSourceHeight(height)}
              underlay={
                <RedactionLayer
                  redactions={redactionEdits.visibleRedactions}
                  videoRef={playback.videoRef}
                  hidden={holdingOriginal || onSlide}
                />
              }
              chrome={
                <>
                  {selectedZoom && !holdingOriginal && !onSlide && (
                    <CameraBox
                      videoRef={playback.videoRef}
                      path={cameraPath}
                      segment={selectedZoom}
                      onBegin={zooms.begin}
                      onMove={(center) => zooms.liveLock(selectedZoom.id, center)}
                      onEnd={zooms.end}
                    />
                  )}
                  {selectedRedaction && !holdingOriginal && !onSlide && (
                    <RegionEditor
                      rect={selectedRedaction.rect}
                      onBegin={redactionEdits.begin}
                      onChange={(rect) => redactionEdits.livePatch(selectedRedaction.id, { rect })}
                      onEnd={redactionEdits.end}
                    />
                  )}
                  {privacyTool && !holdingOriginal && !onSlide && (
                    <RegionDrawer
                      kind={privacyTool}
                      videoRef={playback.videoRef}
                      range={
                        drawRange
                          ? { from: formatPrecise(drawRange.from), to: formatPrecise(drawRange.to) }
                          : null
                      }
                      onDraft={setDraftRegion}
                      onCreate={handleCreateRegion}
                    />
                  )}
                  <HoldOriginalButton holding={holdingOriginal} onHoldChange={setHoldingOriginal} />
                </>
              }
              // "Hold to see original" must show the ORIGINAL: the chip says UNEDITED,
              // so the annotation layer goes with the camera and the privacy regions.
              // The hold owns the pointer, so no in-progress draw can be interrupted.
              overlay={
                !holdingOriginal && (
                  <VideoAnnotationLayer
                    overlays={scene.overlays}
                    visibleIds={visibleIds}
                    selectedId={selectedOverlayId}
                    // A click on the canvas background deselects EVERYTHING (spec § 10.5),
                    // not just the annotation — otherwise a selected zoom would survive it
                    // and the inspector would keep showing the Zoom panel. The same click
                    // still toggles play/pause through onBackgroundClick below.
                    onSelect={(id) => (id === null ? clearSelection() : selectKind("overlay", id))}
                    tool={isPrivacyTool(videoTools.tool) ? "select" : videoTools.tool}
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
                )
              }
            />
          </div>
          {/* Transport bar lives outside the overflow:hidden video region so it is always
              visible even when the video fills the full available height. Three columns
              (see .transport): the play button stays optically centred however wide the
              side clusters get — v2 puts the zoom count on the right. */}
          <div className={styles.transport}>
            <div className={styles.transportSide}>
              <button
                type="button"
                className={styles.muteButton}
                aria-label={playback.muted ? t("unmute") : t("mute")}
                onClick={playback.toggleMute}
              >
                {playback.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
            </div>
            <button
              type="button"
              className={styles.playButton}
              aria-label={playback.playing ? t("pause") : t("play")}
              onClick={playback.toggle}
            >
              {playback.playing ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <div className={`${styles.transportSide} ${styles.transportRight}`}>
              <span className={styles.timeDisplay}>
                {formatTime(playback.timelineTime)} / {formatTime(playback.duration)}
              </span>
              {/* Shown whenever there is something to count: a pre-v2 recording has no
                  cursor track but can still carry hand-made zooms. */}
              {(cursorTrack || zooms.visibleZooms.length > 0) && (
                <span className={styles.counts}>
                  {t("zoomCount", { count: zooms.visibleZooms.length })}
                </span>
              )}
              {redactionEdits.visibleRedactions.length > 0 && (
                <span className={styles.counts}>
                  {t("privacyCount", { count: redactionEdits.visibleRedactions.length })}
                </span>
              )}
              <button
                type="button"
                className={styles.fullscreenButton}
                aria-label={isFullscreen ? t("exitFullscreen") : t("fullscreen")}
                onClick={handleFullscreen}
              >
                {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
            </div>
          </div>
        </main>
        <EditorInspector>
          {selectedRedaction?.kind === "blur" ? (
            <BlurInspector
              redaction={selectedRedaction}
              range={timelineRangeOf(selectedRedaction.start, selectedRedaction.end)}
              edits={redactionEdits}
              onRemoved={() => selectKind("redaction", null)}
            />
          ) : selectedRedaction?.kind === "cover" ? (
            <CoverInspector
              redaction={selectedRedaction}
              range={timelineRangeOf(selectedRedaction.start, selectedRedaction.end)}
              edits={redactionEdits}
              onRemoved={() => selectKind("redaction", null)}
            />
          ) : selectedZoom ? (
            <ZoomInspector
              segment={selectedZoom}
              index={zooms.visibleZooms.indexOf(selectedZoom) + 1}
              layout={layout}
              zooms={zooms}
              sourceHeight={sourceHeight}
              anchorNow={() =>
                boxCenterAt(
                  selectedZoom,
                  cameraPath,
                  sourceTimeAtTimeline(layout, playback.timelineTime) ?? selectedZoom.start,
                )
              }
              onRemoved={() => selectKind("zoom", null)}
            />
          ) : selectedOverlay ? (
            <AnnotationInspector
              overlay={selectedOverlay}
              tools={videoTools}
              // Unlike the redaction/zoom `start`/`end` above (source time, converted via
              // timelineRangeOf), an overlay's `start`/`end` are ALREADY timeline time
              // (scene.ts's OverlayBase docs) — so the inspector's range is the overlay's
              // own window verbatim, no block conversion needed.
              range={{ start: selectedOverlay.start, end: selectedOverlay.end }}
              onCommitOverlay={handleCommitOverlay}
              // handleDeleteOverlay reads `selectedOverlayId` itself rather than taking an
              // id argument, but the inspector only ever renders (and can only call
              // onRemove) for that same selected overlay, so the ids always match — one
              // undoable commit, no wrapper needed.
              onRemove={handleDeleteOverlay}
              onRemoved={() => setSelectedOverlayId(null)}
            />
          ) : videoTools.tool === "box" ||
            videoTools.tool === "arrow" ||
            videoTools.tool === "text" ? (
            <AnnotationDefaultsPanel tools={videoTools} />
          ) : (
            <DetectionPanel
              zooms={zooms}
              sensitivity={scene.zoomSensitivity}
              clicksAvailable={cursorTrack?.clicksAvailable ?? false}
            />
          )}
        </EditorInspector>
      </div>
      <footer className={styles.timeline}>
        <TimelineStrip
          layout={layout}
          playback={playback}
          thumbnails={thumbnails}
          selectedItemId={selectedItemId}
          onSelectItem={setSelectedItemId}
          onTrim={handleTrim}
          slideUrlFor={(assetId) => assetStoreRef.current.get(assetId)?.url ?? null}
          onSlideDuration={handleSlideDuration}
          overlays={scene.overlays}
          selectedOverlayId={selectedOverlayId}
          onSelectOverlay={setSelectedOverlayId}
          onWindowChange={handleWindowChange}
          extraLanes={[
            ...(cursorTrack
              ? [
                  {
                    key: "activity",
                    label: t("laneActivity"),
                    node: <ActivityLane marks={activity} layout={layout} />,
                  },
                ]
              : []),
            {
              key: "zooms",
              label: t("laneZooms"),
              node: (
                <ZoomLane
                  segments={zooms.visibleZooms}
                  layout={layout}
                  selectedId={selectedZoomId}
                  onSelect={handleSelectZoom}
                  onEdgeDrag={zooms.edgeDrag}
                  hasTrack={cursorTrack !== null}
                />
              ),
            },
            {
              key: "privacy",
              label: t("lanePrivacy"),
              node: (
                <PrivacyLane
                  redactions={redactionEdits.visibleRedactions}
                  layout={layout}
                  selectedId={selectedRedactionId}
                  onSelect={handleSelectRedaction}
                  onEdgeDrag={redactionEdits.edgeDrag}
                  ghost={
                    draftRegion && privacyTool && drawWindow
                      ? { kind: privacyTool, start: drawWindow.start, end: drawWindow.end }
                      : null
                  }
                />
              ),
            },
          ]}
        />
      </footer>
      {blocker.state === "blocked" && (
        <ModalOverlay onCancel={() => blocker.reset()} labelledBy="discard-video-dialog-title">
          <ModalIcon tone="danger">
            <TriangleAlert size={20} strokeWidth={1.8} />
          </ModalIcon>
          <ModalTitle id="discard-video-dialog-title">{t("discardTitle")}</ModalTitle>
          <ModalText>{t("discardBody")}</ModalText>
          <ModalActions>
            <ModalButton variant="ghost" onClick={() => blocker.reset()}>
              {t("keepEditing")}
            </ModalButton>
            <ModalButton
              variant="danger"
              onClick={() => {
                // Discard = drop the queued write, so the unmount flush does not save
                // the very edits the user just chose to throw away.
                autosave.cancel();
                blocker.proceed();
              }}
            >
              <Trash2 size={15} strokeWidth={1.8} />
              {t("discard")}
            </ModalButton>
          </ModalActions>
        </ModalOverlay>
      )}
      {videoExport.status !== "idle" && (
        <ExportDialog
          status={videoExport.status}
          fraction={videoExport.fraction}
          error={videoExport.error}
          onCancel={videoExport.cancel}
          onRetry={handleExport}
        />
      )}
    </div>
  );
}
