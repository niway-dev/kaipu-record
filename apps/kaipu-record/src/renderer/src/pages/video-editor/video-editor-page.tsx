import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { generatePath, Navigate, useBlocker, useLocation, useNavigate } from "react-router-dom";
import { ROUTES } from "@shared/routes";
import { AudioLines, Shield, Trash2, TriangleAlert, Webcam, ZoomIn } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { parseCursorTrack, type CursorTrack } from "@shared/cursor-track";
import type { WebcamTrackMeta } from "@shared/webcam-track";
import { captureEvent, captureException, reportError } from "@renderer/features/analytics";
import { buildEditorSpeedChangedProperties, EDITOR_SPEED_CHANGED_EVENT } from "@shared/analytics";
import {
  initialScene,
  reconcileWebcam,
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
} from "@kaipu/ui";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@kaipu/tokens/kaipu.stylex";
import { Badge, Button } from "@kaipu/ui";
import { clipBounds, sourceAxis } from "@renderer/features/video-editor/source-axis";
import {
  axisCursorTrack,
  axisOverlayTrack,
  frameCursorTrack,
} from "@renderer/features/video-editor/cursor/axis-cursor-track";
import { anyJoinedHasWebcam } from "@renderer/features/video-editor/joined-library";
import { useJoinedRecordings } from "@renderer/features/video-editor/use-joined-recordings";
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
import { useFlag } from "@renderer/features/analytics/use-flag";
import { mediaRows, placeMedia } from "@renderer/features/video-editor/media";
import {
  addFloatingImage,
  deleteMediaItem,
  dropMediaWithoutAsset,
  fillPicture,
  isMediaPlaced,
  moveMediaTo,
  putInCorner,
  reorderMediaItem,
  resizeMediaEdgeTo,
  setMediaBoxOf,
  setMediaDurationSeconds,
  setMediaFadesOf,
} from "@renderer/features/video-editor/media-page-edits";
import { MediaLayer } from "@renderer/features/video-editor/components/media-layer";
import { MediaInspector } from "@renderer/features/video-editor/components/inspector/media-inspector";
import type { TimelineMedia } from "@renderer/features/video-editor/components/media-lane-contract";
import { withInitialZooms } from "@renderer/features/video-editor/initial-zooms";
import {
  useEditorSelection,
  WEBCAM_LAYER_SELECTION,
} from "@renderer/features/video-editor/editor-selection";
import {
  sourceRangeToTimelineBlocks,
  sourceTimeAtTimeline,
  timelineTimeAtSource,
} from "@renderer/features/video-editor/source-time";
import { activityMarks } from "@renderer/features/video-editor/zoom/detect-zoom-segments";
import { useZoomEditing } from "@renderer/features/video-editor/zoom/use-zoom-editing";
import { seekTargetForSegment } from "@renderer/features/video-editor/zoom/select-seek";
import { focusInspectorFirstControl } from "@renderer/features/video-editor/focus-inspector";
import { ZoomLane } from "@renderer/features/video-editor/components/zoom-lane";
import { WebcamLane } from "@renderer/features/video-editor/components/webcam-lane";
import { WebcamLayer } from "@renderer/features/video-editor/components/webcam-layer";
import {
  WebcamInspector,
  WebcamSegmentInspector,
} from "@renderer/features/video-editor/components/inspector/webcam-inspector";
import { useWebcamEditing } from "@renderer/features/video-editor/webcam/use-webcam-editing";
import { webcamAt, webcamOverrideAt } from "@renderer/features/video-editor/webcam/webcam-model";
import type { WebcamRecordings } from "@renderer/features/video-editor/webcam/webcam-sync";
import {
  webcamInspectorTarget,
  webcamOutlined,
} from "@renderer/features/video-editor/webcam/webcam-selection";
import {
  EditorInspector,
  InspectorEmptyState,
} from "@renderer/features/video-editor/components/inspector/editor-inspector";
import { BackgroundPanel } from "@renderer/features/video-editor/components/inspector/background-panel";
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
import {
  useCompanionThumbnails,
  useRecordingThumbnails,
  useSourceThumbnails,
} from "@renderer/features/video-editor/use-source-thumbnails";
import {
  clipRecordings,
  noCameraItemIds,
  recordingsNeedingThumbnails,
  type RecordingInfo,
} from "@renderer/features/video-editor/clip-recordings";
import { useLatest } from "@renderer/features/video-editor/use-latest";
import { useVideoScene } from "@renderer/features/video-editor/use-video-scene";
import { useVideoTools } from "@renderer/features/video-editor/annotations/video-tools";
import { useVideoExport } from "@renderer/features/video-editor/export/use-video-export";
import {
  isVideoExportBusy,
  showExportBusyToast,
} from "@renderer/features/video-editor/export/export-runner";
import {
  useGifExport,
  type GifJobArgs,
} from "@renderer/features/video-editor/export/use-gif-export";
import { TimelineGuideModal } from "@renderer/features/video-editor/components/timeline-guide-modal";
import { type GuideTab } from "@renderer/features/video-editor/track-guide";
import {
  ExportSheet,
  type GifSettings,
  type VideoExportChoice,
} from "@renderer/features/video-editor/components/export-sheet";
import {
  editFingerprint,
  findReusableExports,
} from "@renderer/features/video-editor/export/export-reuse";
import { useSourceExports } from "@renderer/features/video-editor/export/use-source-exports";
import { RecordingUnavailableError } from "@renderer/features/video-editor/export/joined-files";
import { useStillCapture } from "@renderer/features/video-editor/export/use-still-capture";
import { planStill } from "@renderer/features/video-editor/export/still-plan";
import type { LibraryVideo } from "@renderer/features/library/types";
import { useSourceCaptures } from "@renderer/features/video-editor/use-source-captures";
import { useJoinRecording } from "@renderer/features/video-editor/use-join-recording";
import { useLibraryRecordings } from "@renderer/features/video-editor/use-library-recordings";
import {
  axisSecondsOfCapture,
  captureOriginAt,
  captureTitleTime,
  findCaptureAt,
  formatClock,
} from "@renderer/features/video-editor/capture-time";
import { CapturesPanel } from "@renderer/features/video-editor/components/captures-panel";
import { AddFromLibraryPanel } from "@renderer/features/video-editor/components/add-from-library-panel";
import { probeSource, type SourceProbe } from "@renderer/features/video-editor/export/probe-source";
import { useAppSettings } from "@renderer/pages/settings/use-app-settings";
import { useHiddenTracks } from "@renderer/features/video-editor/use-hidden-tracks";
import {
  availableTracks,
  isTrackHidden,
  trackForSelection,
  type TrackKey,
} from "@renderer/features/video-editor/tracks";
import { formatSize } from "@renderer/features/library/format";
import { VideoAnnotationLayer } from "@renderer/features/video-editor/annotations/video-annotation-layer";
import {
  EditorToolbar,
  EditorToolRail,
  nextToolInGroup,
  TOOL_GROUPS,
} from "@renderer/features/video-editor/components/editor-toolbar";
import { ExportDialog } from "@renderer/features/video-editor/components/export-dialog";
import {
  PreviewStage,
  type StageRecording,
} from "@renderer/features/video-editor/components/preview-stage";
import { TimelineStrip } from "@renderer/features/video-editor/components/timeline-strip";
import { TransportBar } from "@renderer/features/video-editor/components/transport-bar";
import { useTimelineViewStore } from "@renderer/features/video-editor/use-timeline-view";
import { showToast } from "@renderer/ui/toast-store";
import { isAmbiguousIdentityError } from "@renderer/features/library/rename-outcome";
import { registerSwitchFlush } from "@renderer/features/workspaces/prepare-switch";
import { ItemWorkspaceChip } from "@renderer/features/workspaces/move/item-workspace-chip";
import { HeaderActions } from "@renderer/features/workspaces/header-slot";
import styles from "./video-editor-page.module.css";

/** The "original" pill's own shape, moved out of video-editor-page.module.css:
 *  the shared Badge takes StyleX styles, not a className. */
const sxEditor = stylex.create({
  originalPill: {
    flexShrink: 0,
    // Kaipu Black badge (NIW2-616): mono caps, accent text on the soft accent fill.
    backgroundColor: tokens.accentSoft,
    color: tokens.accent,
    fontFamily: tokens.fontMono,
    fontSize: "9.5px",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
});
import { useBackgroundEditing } from "@renderer/features/video-editor/use-background-editing";
import { useMuteEditing } from "@renderer/features/video-editor/use-mute-editing";
import { AudioLane } from "@renderer/features/video-editor/components/audio-lane";
import { MuteInspector } from "@renderer/features/video-editor/components/inspector/mute-inspector";
import { mediaUrl } from "@renderer/lib/media-url";

import type { RecordingCapture } from "@shared/recording-capture";
import {
  DEFAULT_CURSOR,
  overlayLayerData,
} from "@renderer/features/video-editor/cursor/cursor-model";
import { canOverlayRecordedCursor } from "@shared/native-capture";
import { CursorLayer } from "@renderer/features/video-editor/cursor/cursor-layer";
import { CursorInspector } from "@renderer/features/video-editor/components/inspector/cursor-inspector";
import { uiArea } from "@renderer/lib/ui-area";

export interface VideoEditorSource {
  capture?: RecordingCapture | null;
  id: string;
  /** The source recording's stable identity — recorded on the export as provenance. */
  assetId: string;
  title: string;
  durationSeconds: number;
  /** The recording's file size, for the export sheet's before/after meter. */
  sizeBytes?: number;
  /** Its poster frame, for the export sheet's framing preview. */
  thumbnailUrl?: string | null;
  /** The recording's webcam track (ADR 0037), when it has one: seeds the webcam layer. */
  webcam?: WebcamTrackMeta | null;
}

export function isVideoEditorSource(value: unknown): value is VideoEditorSource {
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

/** Both tools belong to one rail group (Annotate, Privacy). */
function sameGroup(a: EditorTool, b: EditorTool): boolean {
  return Object.values(TOOL_GROUPS).some(
    (variants) =>
      (variants as readonly EditorTool[]).includes(a) &&
      (variants as readonly EditorTool[]).includes(b),
  );
}

/** Target is a text field or a dropdown — don't hijack its keys (Space, letters that pick
 *  an option) for play/pause or tool shortcuts. */
/** Input types whose keys the page must leave alone: Backspace, Space and letters edit them. */
const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "number",
  "password",
  "tel",
  "url",
  "date",
  "time",
  "datetime-local",
  "month",
  "week",
]);

/** Space toggles a focused checkbox or radio; the page must not steal it for playback. */
function ownsSpace(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement && (target.type === "checkbox" || target.type === "radio")
  );
}

/** Whether `target` edits text, so the page's single-key shortcuts must leave it alone. */
function isEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  // A range, checkbox or color input edits no text, and selecting a zoom focuses the
  // inspector's Level slider (focusInspectorFirstControl) — Delete from there must still
  // remove the zoom, so only text-like inputs count as editing.
  if (target instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(target.type);
  return target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable;
}

/** Replace the overlay with the same id, or append it if none exists yet — used to
 *  reflect a live move/resize (VideoAnnotationLayer's onDraft) into the scene. */
function upsertOverlay(overlays: VideoOverlay[], next: VideoOverlay): VideoOverlay[] {
  const i = overlays.findIndex((o) => o.id === next.id);
  return i === -1 ? [...overlays, next] : overlays.map((o, idx) => (idx === i ? next : o));
}

/**
 * Legacy `/video-editor` route. The editor is addressed by URL now
 * (`/editor/video/:assetId`); an old navigation that still carries the recording
 * in router state lands on the new URL, a stateless one on the Editor home.
 */
export function VideoEditorPage(): React.JSX.Element {
  const location = useLocation();
  const source = location.state;
  if (!isVideoEditorSource(source)) return <Navigate to={ROUTES.editor} replace />;
  return <Navigate to={generatePath(ROUTES.editorVideo, { assetId: source.assetId })} replace />;
}

/**
 * Async loading wrapper: loads any saved edit session before rendering the actual
 * editor, so `useVideoScene` always gets the correct initial scene on first render.
 * Without this split, `useVideoScene` would receive the fresh fallback scene before
 * the session IPC returns, and re-initializing a hook with a different value isn't
 * possible in React.
 *
 * The Editor workspace route renders this, keyed by asset id so a different
 * recording never inherits editor state.
 */
export function VideoEditorLoader({ source }: { source: VideoEditorSource }): React.JSX.Element {
  const t = useTranslations("videoEditor");
  // Asset store lives here so it can be populated by the session loader and passed
  // down to the editor without being torn down between the two renders.
  const assetStoreRef = useRef<SlideAssetStore>(createSlideAssetStore());
  useEffect(() => {
    return () => assetStoreRef.current.dispose();
  }, []);

  // The room this screen needs; released when it unmounts. See use-window-floor.

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
    /** The source under the id main acknowledged holding (see below). */
    source: VideoEditorSource;
    scene: VideoScene;
    cursorTrack: CursorTrack | null;
  } | null>(null);
  // Why nothing was loaded: the item is gone, or two files claim its identity.
  const [unavailable, setUnavailable] = useState<"gone" | "ambiguous" | null>(null);
  const navigate = useNavigate();
  const tLibrary = useTranslations("library");

  useEffect(() => {
    // Guards against calling restoreAsset or setting state after unmount —
    // without this, a mid-load unmount would run dispose() (other effect) and
    // then restoreAsset would recreate object URLs that are never revoked.
    let cancelled = false;
    // NIW2-560: this editor holds its source id for its lifetime (session autosave, cursor
    // track, source URL). Main serializes the hold with renames and answers the item's
    // CURRENT id; nothing is loaded or written before that answer, so a rename that was
    // moving the file as the editor opened can never leave it on the old name.
    let heldId: string | null = null;
    let ambiguous = false;
    void (async () => {
      try {
        heldId = await window.electronAPI.acquireEditorSession(source.assetId);
      } catch (error) {
        heldId = null;
        ambiguous = isAmbiguousIdentityError(error);
      }
      if (cancelled) {
        if (heldId !== null) window.electronAPI.closeEditorSession(heldId);
        return;
      }
      // No hold: the item is gone (or main could not say). Never fall back to the route's
      // id — another item may have taken that name since, and this editor would read its
      // media and overwrite its session.
      if (heldId === null) {
        setUnavailable(ambiguous ? "ambiguous" : "gone");
        return;
      }
      const editorSource: VideoEditorSource = { ...source, id: heldId };
      // The cursor track is best-effort and independent of the session: a missing or
      // malformed track just means no auto zooms (the editor behaves as before v2).
      let cursorTrack: CursorTrack | null = null;
      try {
        const trackJson = await window.electronAPI.loadCursorTrack(editorSource.id);
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
          source: editorSource,
          scene: withInitialZooms(scene, hasZoomData, cursorTrack, source.durationSeconds),
          cursorTrack,
        });
      };
      try {
        const saved = await window.electronAPI.loadVideoEditSession(editorSource.id);
        if (cancelled) return;
        if (saved !== null) {
          const session = parseSession(saved.sessionJson, source.durationSeconds);
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
            // Floating images (ADR 0057) go the same way: one whose asset is gone is dropped,
            // and a scene that had none keeps no `media` key.
            // A saved layer survives when a joined recording (ADR 0058) has a webcam although
            // the opened one does not: its meta is read here, before the editor exists, so
            // the layer is never stripped for want of metas the editor loads later.
            const joinedHasWebcam = await anyJoinedHasWebcam(session.scene.sources);
            if (cancelled) return;
            const filteredScene: VideoScene = dropMediaWithoutAsset(
              {
                // The sidecar decides whether the recording has a webcam, not the session.
                ...reconcileWebcam(
                  session.scene,
                  source.webcam ?? null,
                  source.durationSeconds,
                  joinedHasWebcam,
                ),
                items: session.scene.items.filter(
                  (item) => item.kind !== "slide" || loadedIds.has(item.assetId),
                ),
              },
              loadedIds,
            );
            showToast({ message: t("restored") });
            open(filteredScene, session.hasZoomData);
          } else {
            // Session file exists but is invalid (schema changed, corruption, etc.).
            showToast({ message: t("restoreError") });
            open(initialScene(source.durationSeconds, source.webcam ?? null), false);
          }
        } else {
          // No saved session — fresh start, no toast.
          open(initialScene(source.durationSeconds, source.webcam ?? null), false);
        }
      } catch {
        // IPC failure is non-fatal; open a fresh editor without surfacing the error.
        open(initialScene(source.durationSeconds, source.webcam ?? null), false);
      }
    })();
    return () => {
      cancelled = true;
      if (heldId !== null) window.electronAPI.closeEditorSession(heldId);
    };
  }, []); // [] correct: source is stable per VideoEditorLoader's key (the asset id)

  if (unavailable) {
    return (
      <div className={styles.unavailable} role="alert">
        <p>{unavailable === "ambiguous" ? tLibrary("itemAmbiguous") : t("sourceUnavailable")}</p>
        <Button variant="ghost" onClick={() => navigate(ROUTES.library)}>
          {tLibrary("backToLibrary")}
        </Button>
      </div>
    );
  }

  if (resolved === null) {
    // Brief loading state while the session IPC resolves. The editor grows the window
    // on mount; showing a blank page here avoids a visible size jump.
    return <div className={styles.page} />;
  }

  return (
    <>
      {/* "IN · Work ▾": where the recording belongs, and Move to (ADR 0033). */}
      <ItemWorkspaceChip assetId={resolved.source.assetId} />
      <VideoEditor
        source={resolved.source}
        resolvedScene={resolved.scene}
        cursorTrack={resolved.cursorTrack}
        assetStoreRef={assetStoreRef}
      />
    </>
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
  // Recordings joined after the opened one (ADR 0058), loaded once the editor is up. One
  // cursor track on the source axis (each joined track shifted by its offset) feeds everything
  // that reads the pointer, so the camera path, the activity marks and the cursor layer follow a
  // joined clip. A loading or missing recording simply adds nothing.
  const joinedRecordings = useJoinedRecordings(scene.sources);
  // The joined recordings as the MP4 export, the GIF export and the frame capture take them:
  // `id` is the CURRENT vault id, so a renamed recording is still fetched.
  const exportJoined = useMemo(
    () =>
      joinedRecordings.map((j) => ({
        sourceId: j.source.id,
        id: j.id,
        title: j.source.title,
        status: j.status,
        webcam: j.webcam,
      })),
    [joinedRecordings],
  );
  // What the MP4 export reads at each start, Retry included: a recording still loading when an
  // export was refused may be ready when the user retries, and a closure over this render's
  // list would refuse for ever. The ref follows the list only while this editor is mounted: a
  // Retry from another page reads the list as the editor left it.
  const exportJoinedRef = useRef(exportJoined);
  useEffect(() => {
    exportJoinedRef.current = exportJoined;
  }, [exportJoined]);

  // The decoded frame as one state object: the webcam layer places itself against it (the
  // preview's output frame is the source frame), and a stable object keeps its trigger quiet.
  // Floating images use it as the picture's size (only its aspect matters), 16:9 until it lands.
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const pictureSize = useMemo(
    () => (frameSize.width > 0 && frameSize.height > 0 ? frameSize : { width: 1920, height: 1080 }),
    [frameSize],
  );
  const axis = useMemo(
    () => sourceAxis(source.durationSeconds, scene.sources),
    [source.durationSeconds, scene.sources],
  );
  const axisEnd = useMemo(
    () => Math.max(...axis.recordings.map((r) => r.offset + r.duration)),
    [axis],
  );
  // Every joined track is mapped once into frame coordinates (the opened recording's aspect, the
  // letterbox of a recording of another one), before the camera path, the activity marks, the
  // auto-zoom detection and the cursor layer read it.
  const frameAspect =
    frameSize.width > 0 && frameSize.height > 0 ? frameSize.width / frameSize.height : 0;
  const joinedFrameTracks = useMemo(
    () =>
      joinedRecordings.map((j) =>
        frameCursorTrack(
          j.cursorTrack,
          frameAspect,
          j.source.width > 0 && j.source.height > 0 ? j.source.width / j.source.height : 0,
        ),
      ),
    [joinedRecordings, frameAspect],
  );
  const axisTrack = useMemo(
    () =>
      axisCursorTrack(
        cursorTrack,
        joinedRecordings.map((j, i) => ({ offset: j.source.offset, track: joinedFrameTracks[i] })),
      ),
    [cursorTrack, joinedRecordings, joinedFrameTracks],
  );
  // The pointer is drawn only inside the range of a recording that has a track AND whose own
  // pixels exclude it; the camera, the marks and the zooms above use every track.
  const overlayTrack = useMemo(
    () =>
      axisOverlayTrack(
        {
          offset: 0,
          duration: source.durationSeconds,
          track: cursorTrack,
          canOverlay: canOverlayRecordedCursor(source.capture),
        },
        joinedRecordings.map((j, i) => ({
          offset: j.source.offset,
          duration: j.source.durationSeconds,
          track: joinedFrameTracks[i],
          canOverlay: canOverlayRecordedCursor(j.capture),
        })),
      ),
    [source.durationSeconds, source.capture, cursorTrack, joinedRecordings, joinedFrameTracks],
  );
  // Sensitivity and Re-analyse run per recording on its own track and range: the opened one
  // and every joined recording that is READY (ADR 0058).
  const zoomRecordings = useMemo(
    () => [
      { offset: 0, duration: source.durationSeconds, track: cursorTrack },
      ...joinedRecordings.flatMap((j, i) =>
        j.status === "ready"
          ? [
              {
                offset: j.source.offset,
                duration: j.source.durationSeconds,
                track: joinedFrameTracks[i],
              },
            ]
          : [],
      ),
    ],
    [source.durationSeconds, cursorTrack, joinedRecordings, joinedFrameTracks],
  );
  const cursorData = useMemo(
    () => overlayLayerData(overlayTrack, scene.cursor ?? DEFAULT_CURSOR),
    [overlayTrack, scene.cursor],
  );
  const [cursorInspectorOpen, setCursorInspectorOpen] = useState(false);
  // The Captures panel (NIW2-764) takes the right column like the cursor settings do: one
  // of the two at a time, and anything that opens another inspector closes it.
  const [capturesOpen, setCapturesOpen] = useState(false);
  const layout = useMemo(() => toLayout(scene.items), [scene.items]);
  // Floating images over the Clips sequence (ADR 0057). The flag gates ADDING one (while it is
  // off the Captures panel shows no Add to timeline, NIW2-772); an edit that already carries
  // images keeps showing them, so a preview never hides what the export draws.
  const levelsOn = useFlag("timeline-levels");
  const showMedia = levelsOn || (scene.media?.length ?? 0) > 0;
  // Add recording (NIW2-782): Add from Library takes the right column like Captures does.
  // The state is only ever read through `addRecordingShown`, so with the flag off the panel
  // cannot open whatever the state holds.
  const [addRecordingOpen, setAddRecordingOpen] = useState(false);
  const addRecordingShown = levelsOn && addRecordingOpen;
  const libraryRecordings = useLibraryRecordings(addRecordingShown);
  // Writes the session ~800 ms after every commit/endInteract, and flushes on unmount
  // and beforeunload. See plans/video-editor-v2/07: before this, closing the window
  // threw away every cut, zoom and redaction, because useBlocker below only ever sees
  // in-app navigation.
  const autosave = useSessionAutosave(source.id, scene, controller.interacting, assetStoreRef);
  // A workspace switch writes the pending edit first, while this editor is still open and
  // its workspace still active (ADR 0032, decision 7); the leave guard below then sees it saved.
  const flushAutosave = autosave.flush;
  useEffect(() => registerSwitchFlush(flushAutosave), [flushAutosave]);
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
  const shouldBlock = useCallback(() => pendingSaveRef.current, [pendingSaveRef]);
  const blocker = useBlocker(shouldBlock);
  // The preview hears the scene's muting so scrubbing matches the export. Memoised on
  // the two fields rather than passed as `scene`: the scene object changes on every
  // commit, and the hook re-applies the mute whenever this value changes.
  const audioEdits = useMemo(
    () => ({ audioMuted: scene.audioMuted, mutedRanges: scene.mutedRanges }),
    [scene.audioMuted, scene.mutedRanges],
  );
  const playback = usePreviewPlayback(layout, audioEdits);
  // The timeline's zoom and scroll: view state, never saved, reset to fit on open. Held
  // in a store the transport bar and the strip subscribe to, not in this component's state,
  // so a scroll (a frame at a time) does not re-render the editor.
  const timelineView = useTimelineViewStore(playback.duration);
  const { setSpeed: setPreviewSpeed } = playback;
  // The speed is preview-only (NIW2-666): it lives in the playback hook and goes nowhere
  // else, not the scene, the session or the export. The one thing it leaves is the event.
  const handleSpeedChange = useCallback(
    (speed: number) => {
      setPreviewSpeed(speed);
      captureEvent(EDITOR_SPEED_CHANGED_EVENT, buildEditorSpeedChangedProperties({ speed }));
    },
    [setPreviewSpeed],
  );
  // Lane handlers read the current scene, layout and playback through these refs, so they keep
  // one identity across slider moves and the memoised lanes below do not re-render (NIW2-662).
  const controllerRef = useLatest(controller);
  const layoutRef = useLatest(layout);
  const playbackRef = useLatest(playback);
  const zooms = useZoomEditing({
    controller,
    layout,
    timelineDuration: playback.duration,
    axis,
    recordings: zoomRecordings,
  });
  const mutes = useMuteEditing(controller, layout, axis);
  // The picture's background, padding, corners and shadow (ADR 0051): a scene field like a
  // zoom, so the undo history, the session and the export fingerprint all carry it.
  const backgroundEdits = useBackgroundEditing(controller);
  const webcamEdits = useWebcamEditing({ controller, layout, axis });
  // The sidecar decides whether there is a webcam (the loader reconciled the scene with
  // it); without one there is no layer, lane, inspector section nor second <video>.
  const webcamTrack = source.webcam ?? null;
  // A scene has one webcam layout; it shows a face wherever the recording under the playhead has
  // one. So the layer, lane and inspector exist when ANY recording was recorded with a webcam.
  const hasWebcam =
    scene.webcam !== null &&
    (webcamTrack !== null || joinedRecordings.some((j) => j.webcam !== null));
  // Each recording's own webcam file and offset: the layer swaps files as the playhead crosses
  // from one recording into another and aims at the local second (ADR 0058).
  const webcamRecordings = useMemo<WebcamRecordings>(
    () => ({
      axis,
      files: new Map([
        [
          null,
          {
            src: webcamTrack ? mediaUrl("webcam", source.id) : null,
            startOffsetMs: webcamTrack?.startOffsetMs ?? 0,
          },
        ],
        ...joinedRecordings.map(
          (j) =>
            [
              j.source.id,
              {
                src: j.webcam && j.id ? mediaUrl("webcam", j.id) : null,
                startOffsetMs: j.webcam?.startOffsetMs ?? 0,
              },
            ] as const,
        ),
      ]),
    }),
    [axis, webcamTrack, source.id, joinedRecordings],
  );
  // One `<video>` per joined recording the stage can play; a missing one has none (the picture
  // says so while the playhead is on its clip), a loading one has none yet.
  const stageRecordings = useMemo<StageRecording[]>(
    () =>
      joinedRecordings.map((j) => ({
        sourceId: j.source.id,
        title: j.source.title,
        mediaUrl: j.status === "ready" && j.id ? mediaUrl("recording", j.id) : null,
        missing: j.status === "missing",
      })),
    [joinedRecordings],
  );
  const redactionEdits = useRedactionEditing({ controller, layout, axis });
  // One camera simulation shared by the preview (useCameraPreview) and the export (doc 05).
  // Declared before any callback that closes over it (handleExport).
  const cameraPath = useCameraPath(scene.zoomSegments, axisTrack, axisEnd);
  // Cursor activity: the marks drawn inside the Zooms lane — depend only on the (immutable) track.
  const activity = useMemo(
    () => (axisTrack ? activityMarks(axisTrack, axisEnd) : []),
    [axisTrack, axisEnd],
  );
  const videoTools = useVideoTools();
  const videoExport = useVideoExport();
  const gifExport = useGifExport();
  // A joined recording that finishes loading re-asks an estimate refused for it: the export
  // sheet re-requests only when a GIF setting changes.
  const { retryRefusedEstimate } = gifExport;
  useEffect(() => {
    retryRefusedEstimate(exportJoined);
  }, [exportJoined, retryRefusedEstimate]);
  const sourceUrl = mediaUrl("recording", source.id);
  const thumbnails = useSourceThumbnails(sourceUrl, source.durationSeconds);
  // Which recording each clip is (null without joins: the timeline then draws as before), and
  // each joined recording's own filmstrip, decoded only while it still has a clip (NIW2-780).
  const recordingInfos = useMemo<RecordingInfo[]>(
    () => [
      { sourceId: null, title: source.title, status: "ready", hasWebcam: webcamTrack !== null },
      ...joinedRecordings.map((j) => ({
        sourceId: j.source.id,
        title: j.source.title,
        status: j.status,
        hasWebcam: j.webcam !== null,
      })),
    ],
    [source.title, webcamTrack, joinedRecordings],
  );
  const clipRecordingMap = useMemo(
    () => clipRecordings(layout, axis, recordingInfos),
    [layout, axis, recordingInfos],
  );
  const noCameraClips = useMemo(
    () =>
      noCameraItemIds(
        clipRecordingMap,
        recordingInfos.some((r) => r.hasWebcam),
      ),
    [clipRecordingMap, recordingInfos],
  );
  const recordingStripRequests = useMemo(() => {
    const byId = new Map(joinedRecordings.map((j) => [j.source.id, j]));
    return recordingsNeedingThumbnails(
      clipRecordingMap,
      new Map(joinedRecordings.map((j) => [j.source.id, j.source.durationSeconds])),
    ).flatMap(({ sourceId, durationSeconds }) => {
      const joined = byId.get(sourceId);
      return joined?.id
        ? [{ key: sourceId, mediaUrl: mediaUrl("recording", joined.id), durationSeconds }]
        : [];
    });
  }, [clipRecordingMap, joinedRecordings]);
  const recordingThumbnails = useRecordingThumbnails(recordingStripRequests);
  // The webcam lane's filmstrip: the webcam file's frames, reported at SOURCE time, and the
  // source range it has footage for.
  const webcamStrip = useCompanionThumbnails(
    webcamTrack && scene.webcam !== null ? mediaUrl("webcam", source.id) : "",
    source.durationSeconds,
    (webcamTrack?.startOffsetMs ?? 0) / 1000,
  );
  // Per-user settings. `editor.hiddenTracks` is view state: it decides which lanes the
  // timeline draws and is read nowhere else (ADR 0050); the export sheet reads the rest.
  const appSettings = useAppSettings();
  const trackVisibility = useHiddenTracks(appSettings);
  const { hidden: hiddenTracks, showTrack } = trackVisibility;
  const selection = useEditorSelection();
  // `select` / `clear` are stable (useCallback, no deps); the `selection` object itself
  // is rebuilt every render, so never put it in a dependency array.
  const { select: selectSelection, clear: clearSelection } = selection;
  // Selecting anything, like picking a tool (handleToolChange), hands the inspector back
  // from the cursor settings to that thing.
  // Selecting an item on a hidden lane shows that lane first, so a selection is never
  // invisible (a zoom clicked on the preview, a mute added from the rail). Every kind of
  // selection goes through here, so no caller has to remember.
  const selectKind = useCallback((...args: Parameters<typeof selectSelection>) => {
    const [kind, id] = args;
    const lane = id === null ? null : trackForSelection(kind);
    if (lane) showTrack(lane);
    setCursorInspectorOpen(false);
    // Selecting something opens its inspector, which replaces the captures; a deselect
    // (null id) opens nothing, so the panel stays.
    if (id !== null) {
      setCapturesOpen(false);
      setAddRecordingOpen(false);
    }
    selectSelection(...args);
  }, [selectSelection, showTrack]);
  // Hiding a lane clears a selection that lives on it: the item would stay selected on a
  // lane nobody can see, and Delete (the page's key handler) would remove it unseen. The
  // other direction (selecting on a hidden lane shows the lane) is `selectKind` above.
  // Decided here, at the toggle, and not by watching `hiddenTracks`: that list reaches the
  // page one round trip after `showTrack`, so a watcher would clear a selection that was
  // just made on a lane that is about to be shown.
  const selectedKind = selection.selection?.kind ?? null;
  const toggleTrack = useCallback(
    (key: TrackKey) => {
      const lane = selectedKind === null ? null : trackForSelection(selectedKind);
      if (lane === key && !isTrackHidden(key, hiddenTracks)) clearSelection();
      trackVisibility.toggle(key);
    },
    [selectedKind, hiddenTracks, clearSelection, trackVisibility],
  );
  const selectedItemId = selection.itemId;
  const selectedOverlayId = selection.overlayId;
  const selectedMediaId = selection.mediaId;
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

  // Deleting the footage under a floating image's start unplaces it (it leaves the timeline, the
  // preview and the export together; undo brings it back): its selection goes with it.
  useEffect(() => {
    if (selectedMediaId && !isMediaPlaced(scene, selectedMediaId)) selectKind("media", null);
  }, [scene, selectedMediaId, selectKind]);

  const selectedZoomId = selection.zoomId;
  const selectedRedactionId = selection.redactionId;
  const selectedMuteId = selection.muteId;
  const selectedWebcamId = selection.webcamId;
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
  useEffect(() => {
    if (selectedMuteId && !scene.mutedRanges.some((r) => r.id === selectedMuteId)) {
      selectKind("mute", null);
    }
  }, [scene.mutedRanges, selectedMuteId, selectKind]);
  useEffect(() => {
    if (
      selectedWebcamId &&
      selectedWebcamId !== WEBCAM_LAYER_SELECTION &&
      !scene.webcam?.segments.some((s) => s.id === selectedWebcamId)
    ) {
      selectKind("webcam", null);
    }
  }, [scene.webcam, selectedWebcamId, selectKind]);

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
  // discrete action here. The only source of images is a capture's Add to timeline.
  const insertImageSlide = useCallback(
    async (bytes: ArrayBuffer, mime: string) => {
      // Same guard as every other discrete action: don't mutate the scene while a
      // trim or overlay drag owns it via begin/updateLive/endInteract.
      if (controller.interacting) return;
      // Wrap the image decode in a try/catch so a corrupt or unsupported file
      // surfaces a clear toast rather than an unhandled rejection.
      let asset: SlideAsset;
      try {
        asset = await assetStoreRef.current.put(bytes, mime);
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

  // Add to timeline with `timeline-levels` on: the image is stored exactly as a slide's is, then
  // floats over the sequence at the playhead (10 s, fitted, in front) and is selected. The
  // sequence is untouched. Reads the scene and the playhead after the decode, not from the
  // click: they may have moved while the image was being decoded. The playhead comes from
  // `readTimelineTime`, not the `timelineTime` state: while playing, the state lags the frame
  // on screen (as in Capture frame).
  const insertFloatingImage = useCallback(
    async (bytes: ArrayBuffer, mime: string) => {
      if (controller.interacting) return;
      let asset: SlideAsset;
      try {
        asset = await assetStoreRef.current.put(bytes, mime);
      } catch {
        showToast({ message: t("imageLoadError") });
        return;
      }
      const current = controllerRef.current;
      if (current.interacting) return;
      const id = newId();
      const next = addFloatingImage(current.scene, {
        id,
        assetId: asset.assetId,
        naturalWidth: asset.naturalWidth,
        naturalHeight: asset.naturalHeight,
        playhead: playbackRef.current.readTimelineTime(),
        picture: pictureSize,
      });
      if (next === current.scene) return;
      current.commit(next);
      selectKind("media", id);
    },
    [controller, controllerRef, playbackRef, pictureSize, selectKind, t],
  );

  // A capture's Add to timeline: main reads the vault PNG by id (fetch on the media scheme
  // returns no bytes here), then it goes in as a floating image (flag on) or as any image slide.
  const addCaptureToTimeline = useCallback(
    async (capture: LibraryVideo) => {
      const id = capture.id;
      if (!id) return;
      let bytes: ArrayBuffer;
      try {
        bytes = await window.electronAPI.readScreenshotBytes(id);
      } catch {
        showToast({ message: t("imageLoadError") });
        return;
      }
      if (levelsOn) await insertFloatingImage(bytes, "image/png");
      else await insertImageSlide(bytes, "image/png");
    },
    [insertImageSlide, insertFloatingImage, levelsOn, t],
  );

  // Reads the live preview <video>'s native/displayed size at click time (not
  // memoized — the box can resize between renders) and hands off to the export
  // hook, which owns the whole worker/writer pipeline. `markClean` runs before
  // navigating so `useBlocker` doesn't intercept this programmatic navigation.
  // NIW2-218: frame rate + audio layout for the preset estimates and bitrates. Probed once
  // per source; until it resolves the presets assume 30 fps with audio (conservative).
  const [sourceProbe, setSourceProbe] = useState<SourceProbe | null>(null);
  useEffect(() => {
    let alive = true;
    void probeSource(source.id).then((probe) => {
      if (alive) setSourceProbe(probe);
    });
    return () => {
      alive = false;
    };
  }, [source.id]);
  // The scene as it is now, for an export that finishes after the user kept editing (or
  // left): see `onSaved` below.
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const startVideoExport = useCallback(
    (choice: VideoExportChoice) => {
      // The OPENED recording's decoded size, held as state when its metadata lands (never the
      // element on screen, which can be a joined recording of another size). It is 0 until the
      // browser has decoded the stream's metadata. Starting the export before that hands the
      // worker a 0×0 OffscreenCanvas, which produces a corrupt file — refuse early.
      if (frameSize.width === 0 || frameSize.height === 0) {
        showToast({ message: t("videoStillLoading") });
        return;
      }
      // What this file carries, so the sheet can offer it again while the edit is unchanged,
      // and the session save below: taken NOW, because the export runs in the background
      // and the user can keep editing (or leave) while it encodes.
      const fingerprint = editFingerprint(scene, cursorData !== null);
      const sessionJson = serializeSession(scene);
      const assets = assetStoreRef.current
        .entries()
        .map((a) => ({ assetId: a.assetId, bytes: a.bytes }));
      void videoExport.start({
        scene,
        sourceId: source.id,
        title: source.title,
        derivedFromAssetId: source.assetId,
        sourceSizeBytes: source.sizeBytes ?? null,
        videoWidth: frameSize.width,
        videoHeight: frameSize.height,
        previewWidth: contentRef.current?.clientWidth ?? 0,
        slideAssets: assetStoreRef.current,
        cameraPath,
        cursor: cursorData,
        // The sidecar's webcam track: with a webcam layer in the scene, the export composes it.
        webcamTrack: source.webcam ?? null,
        joined: () => exportJoinedRef.current,
        presetId: choice.presetId,
        framing: choice.framing,
        sourceInfo: sourceProbe,
        fingerprint,
        // NIW2-218 export redesign: the export runs in the background and the user stays in
        // the editor; the "Ready to share" card takes it from here. What is left is stamping
        // the edit session as exported — the stamp clears the library's "not exported"
        // badge — but only while the session still holds the edit that was exported.
        onSaved: async () => {
          if (mountedRef.current) {
            // Still here: edited since the export started → that newer edit is what the
            // autosave writes, and it is rightly not exported.
            if (editFingerprint(sceneRef.current, cursorData !== null) !== fingerprint) return;
            // This save supersedes whatever the autosave still had queued.
            autosave.cancel();
          } else {
            // Left the editor: its unmount flush wrote the latest edit (or Discard dropped
            // it). Stamp only if what is on disk is the edit that was exported.
            const saved = await window.electronAPI.loadVideoEditSession(source.id);
            const parsedScene = saved
              ? parseSession(saved.sessionJson, source.durationSeconds)?.scene
              : null;
            // Reconciled like the loader does, or an old session (no webcam key) on a webcam
            // recording would never fingerprint like the scene that was exported.
            const savedScene = parsedScene
              ? reconcileWebcam(
                  parsedScene,
                  source.webcam ?? null,
                  source.durationSeconds,
                  await anyJoinedHasWebcam(parsedScene.sources),
                )
              : null;
            if (savedScene && editFingerprint(savedScene, cursorData !== null) !== fingerprint)
              return;
          }
          try {
            // `true`: this scene is exactly what was just burned into the file, so the write
            // stamps it as exported.
            await window.electronAPI.saveVideoEditSession(source.id, sessionJson, assets, true);
            if (mountedRef.current) controller.markClean();
          } catch (error) {
            // Session save failure is non-fatal — the export already succeeded.
            captureException(error, { context: "video-edit-session-save" });
          }
        },
      });
    },
    [
      t,
      sourceProbe,
      frameSize,
      videoExport,
      scene,
      source,
      controller,
      assetStoreRef,
      autosave,
      cameraPath,
      cursorData,
    ],
  );

  // NIW2-217: "Export" opens the export sheet (format choice). The metadata guard runs
  // here too, so the sheet never offers a GIF of a 0×0 stream.
  const [exportSheetOpen, setExportSheetOpen] = useState(false);
  // NIW2-679: the Timeline guide. `tab` null = closed. Focus goes back to whatever opened it
  // (a lane label, the Tracks `?`, the header button): the dialog cannot know which.
  const [guideTab, setGuideTab] = useState<GuideTab | null>(null);
  const guideOpenerRef = useRef<HTMLElement | null>(null);
  const openGuide = useCallback((tab: GuideTab) => {
    guideOpenerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setGuideTab(tab);
  }, []);
  const openGuideFirstTab = useCallback(() => openGuide("clips"), [openGuide]);
  const closeGuide = useCallback(() => {
    setGuideTab(null);
    guideOpenerRef.current?.focus();
    guideOpenerRef.current = null;
  }, []);
  // NIW2-218 "already exported → reuse": this source's exports, re-read when the sheet opens.
  const sourceExports = useSourceExports(source.assetId, exportSheetOpen);
  const lastGifSettingsRef = useRef<GifSettings | null>(null);
  const handleExport = useCallback(() => {
    if (frameSize.width === 0 || frameSize.height === 0) {
      showToast({ message: t("videoStillLoading") });
      return;
    }
    // One export at a time: say which one is running instead of opening a second sheet.
    if (isVideoExportBusy()) {
      showExportBusyToast(t);
      return;
    }
    setExportSheetOpen(true);
  }, [frameSize, t]);

  const closeExportSheet = useCallback(() => {
    gifExport.cancelEstimate();
    setExportSheetOpen(false);
  }, [gifExport]);

  // Shared job inputs for the GIF estimate and export; null while the video is loading.
  const gifJobArgs = useCallback(
    (settings: GifSettings): GifJobArgs | null => {
      if (frameSize.width === 0 || frameSize.height === 0) return null;
      return {
        scene,
        sourceId: source.id,
        videoWidth: frameSize.width,
        videoHeight: frameSize.height,
        previewWidth: contentRef.current?.clientWidth ?? 0,
        slideAssets: assetStoreRef.current,
        cameraPath,
        cursor: cursorData,
        webcamTrack: source.webcam ?? null,
        joined: exportJoined,
        range: settings.range,
        width: settings.width,
        fps: settings.fps,
      };
    },
    [
      frameSize,
      scene,
      source.id,
      source.webcam,
      exportJoined,
      assetStoreRef,
      cameraPath,
      cursorData,
    ],
  );

  const handleGifSettingsChange = useCallback(
    (settings: GifSettings | null) => {
      const args = settings ? gifJobArgs(settings) : null;
      if (args) gifExport.requestEstimate(args);
      else gifExport.cancelEstimate();
    },
    [gifJobArgs, gifExport],
  );

  const startGifExport = useCallback(
    (settings: GifSettings) => {
      const args = gifJobArgs(settings);
      if (!args) {
        showToast({ message: t("videoStillLoading") });
        return;
      }
      lastGifSettingsRef.current = settings;
      setExportSheetOpen(false);
      void gifExport.start({
        ...args,
        title: source.title,
        derivedFromAssetId: source.assetId,
        onSaved: async (recording) => {
          // Same session save as the MP4 export (stamped as exported), but the user stays
          // in the editor: GIF users often export several ranges in a row (FR 11).
          autosave.cancel();
          try {
            const sessionJson = serializeSession(scene);
            const assets = assetStoreRef.current
              .entries()
              .map((a) => ({ assetId: a.assetId, bytes: a.bytes }));
            await window.electronAPI.saveVideoEditSession(source.id, sessionJson, assets, true);
            controller.markClean();
          } catch (error) {
            captureException(error, { context: "video-edit-session-save" });
          }
          showToast({
            message: t("gifSaved", { size: formatSize(recording.sizeBytes) }),
            action: {
              label: t("gifOpen"),
              // Unsaved edits made after the export still go through the discard guard.
              onClick: () => navigate(`/library/${recording.assetId}`),
            },
            durationMs: 8000,
          });
        },
      });
    },
    [gifJobArgs, gifExport, source, autosave, scene, assetStoreRef, controller, navigate, t],
  );

  // Frame captures (NIW2-764): the composed frame at the playhead, saved into the library
  // with the video and second it came from, then listed in the Captures panel.
  const stillCapture = useStillCapture();
  // Read from the first render, panel open or not: the top-bar Capture frame needs the real
  // list for its duplicate check, so it stays disabled until this read lands.
  // The opened recording's captures and those of every recording the scene joins: a frame
  // taken over a joined clip is listed here too, and counts for the duplicate check.
  const captureAssetIds = useMemo(
    () => [source.assetId, ...(scene.sources ?? []).map((s) => s.assetId)],
    [source.assetId, scene.sources],
  );
  const sourceCaptures = useSourceCaptures(captureAssetIds, true);
  const refreshCaptures = sourceCaptures.refresh;
  const latestCaptures = sourceCaptures.latest;
  // The capture a repeated press found already saved: outlined for ~2 s in the panel.
  const [highlightedCaptureId, setHighlightedCaptureId] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    },
    [],
  );
  const captureFrame = stillCapture.capture;
  // Held from the press until the list holds the new capture: `stillCapture.busy` ends when
  // the frame is composed, and a second press before the list refreshes would miss the
  // duplicate check.
  const captureInFlight = useRef(false);
  const handleCaptureFrame = useCallback(async () => {
    // The opened recording's decoded size (state), not the element on screen.
    if (frameSize.width === 0 || frameSize.height === 0) {
      showToast({ message: t("videoStillLoading") });
      return;
    }
    if (captureInFlight.current) return;
    captureInFlight.current = true;
    // Timeline seconds: the clock the transport and the scene share, never source time.
    // Read now, not from state: while playing, state lags the frame on screen.
    const playhead = playback.readTimelineTime();
    try {
      // The same frame twice is a duplicate: point at the saved one instead of composing.
      // The recording under the playhead and the second INSIDE ITS OWN file: a frame of a joined
      // recording links to that recording's asset, not to the opened one. The captures read here
      // hold every recording the scene joins, so the check is by asset, second and copy.
      const origin = captureOriginAt(
        axis,
        scene.sources,
        source.assetId,
        planStill(scene, playhead).sourceSeconds,
      );
      const existing = origin
        ? findCaptureAt(latestCaptures(), origin.localSeconds, origin.sourceId, origin.assetId)
        : undefined;
      if (existing) {
        clearSelection();
        setCursorInspectorOpen(false);
        setAddRecordingOpen(false);
        setCapturesOpen(true);
        setHighlightedCaptureId(existing.assetId);
        if (highlightTimer.current) clearTimeout(highlightTimer.current);
        highlightTimer.current = setTimeout(() => setHighlightedCaptureId(null), 2000);
        showToast({
          message: t("captureExists", { time: formatClock(existing.sourceTimeSeconds as number) }),
        });
        return;
      }
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      setHighlightedCaptureId(null);
      const frame = await captureFrame({
        scene,
        sourceId: source.id,
        videoWidth: frameSize.width,
        videoHeight: frameSize.height,
        previewWidth: contentRef.current?.clientWidth ?? 0,
        slideAssets: assetStoreRef.current,
        cameraPath,
        cursor: cursorData,
        webcamTrack: source.webcam ?? null,
        joined: exportJoined,
        playhead,
      });
      // The link stores the SOURCE second (what the library page and the sidecar show). A
      // slide has no source footage: its link has no time (seeking to it does nothing), and
      // only the title uses the timeline second.
      const titleSeconds = frame.sourceSeconds ?? frame.timelineSeconds;
      // Where the composed frame really came from (a slide has no recording: no time).
      const saved = captureOriginAt(axis, scene.sources, source.assetId, frame.sourceSeconds);
      await window.electronAPI.saveScreenshot(frame.png, {
        // The title becomes the file name (ADR 0035): compact time, nothing a name refuses.
        title: t("captureTitle", { title: source.title, time: captureTitleTime(titleSeconds) }),
        manual: false,
        source: {
          videoAssetId: saved?.assetId ?? source.assetId,
          timeSeconds: saved ? saved.localSeconds : frame.sourceSeconds,
          sceneSourceId: saved?.sourceId ?? null,
        },
      });
      // The panel takes the inspector's place, so the selection goes too (as the cursor
      // inspector does): Delete must never remove an item whose inspector is not on screen.
      clearSelection();
      setCursorInspectorOpen(false);
      setAddRecordingOpen(false);
      setCapturesOpen(true);
      await refreshCaptures();
    } catch (error) {
      // A recording that cannot be read is named; anything else is the generic message.
      reportError(
        error instanceof RecordingUnavailableError ? error.message : t("captureError"),
        error,
        {
          context: { phase: "capture-frame", assetId: source.assetId },
          // The latest handler: a retry captures what is on screen now, with any redaction
          // added since the failed attempt, never the scene of that attempt.
          retry: () => void captureFrameRef.current(),
        },
      );
    } finally {
      captureInFlight.current = false;
    }
  }, [
    playback,
    frameSize,
    axis,
    captureFrame,
    latestCaptures,
    scene,
    source,
    assetStoreRef,
    cameraPath,
    cursorData,
    exportJoined,
    refreshCaptures,
    clearSelection,
    t,
  ]);
  const captureFrameRef = useLatest(handleCaptureFrame);

  const deleteCapture = useCallback(
    async (capture: LibraryVideo): Promise<void> => {
      if (!capture.id) return;
      await window.electronAPI.deleteLocalRecording(capture.id);
      await refreshCaptures();
    },
    [refreshCaptures],
  );

  const toggleCaptures = useCallback(() => {
    if (capturesOpen) {
      setCapturesOpen(false);
      return;
    }
    clearSelection();
    setCursorInspectorOpen(false);
    setAddRecordingOpen(false);
    setCapturesOpen(true);
  }, [capturesOpen, clearSelection]);

  // Add recording (NIW2-782). The join itself is `useJoinRecording`: the clip lands at the
  // boundary nearest the time it is given, as one undo step. `source.durationSeconds` is the
  // opened recording's span on the shared axis (ADR 0058), `frameAspect` the frame the joined
  // recording's cursor is mapped into.
  const joinRecordingAt = useJoinRecording(controller, source.durationSeconds, frameAspect);
  const toggleAddRecording = useCallback(() => {
    if (addRecordingOpen) {
      setAddRecordingOpen(false);
      return;
    }
    // Like Captures, the panel takes the inspector's place, so the selection goes too.
    clearSelection();
    setCursorInspectorOpen(false);
    setCapturesOpen(false);
    setAddRecordingOpen(true);
  }, [addRecordingOpen, clearSelection]);
  const addRecording = useCallback(
    async (video: LibraryVideo, at: number): Promise<void> => {
      // `busy` (a drag owns the scene) does nothing: the click is simply not taken.
      if ((await joinRecordingAt(video, at)) === "missing") {
        showToast({ message: t("addRecordingMissing", { title: video.title }) });
      }
    },
    [joinRecordingAt, t],
  );
  // The row being dragged onto the sequence. A drag's contents are hidden until the drop, so
  // the panel hands the video over here when the drag starts and the Clips row reads it on drop.
  const draggedRecordingRef = useRef<LibraryVideo | null>(null);
  const dropRecording = useCallback(
    (boundaryTime: number) => {
      const video = draggedRecordingRef.current;
      draggedRecordingRef.current = null;
      if (video) void addRecording(video, boundaryTime);
    },
    [addRecording],
  );

  /** A capture's image: move the playhead to its moment, if that moment is still on the timeline. */
  const seekToCapture = useCallback(
    (seconds: number, sceneSourceId?: string | null, assetId?: string | null) => {
      // The link keeps seconds inside ITS recording's file; the timeline speaks axis seconds.
      // The capture's own asset: a joined recording's capture made in its own editor carries no
      // copy id, and must land in that recording's range, not at the same second of this one.
      const axisSeconds = axisSecondsOfCapture(
        scene.sources,
        source.assetId,
        assetId ?? source.assetId,
        seconds,
        sceneSourceId,
      );
      if (axisSeconds === null) return;
      const at = timelineTimeAtSource(layout, axisSeconds);
      if (at !== null) playback.seek(at);
    },
    [layout, playback, scene.sources, source.assetId],
  );

  const handleDeleteOverlay = useCallback(() => {
    // Same rationale as handleDeleteSelected: don't touch scene/selection while a
    // move/resize drag owns it via begin/updateLive/endInteract.
    if (controller.interacting) return;
    if (!selectedOverlayId) return;
    const overlays = scene.overlays.filter((o) => o.id !== selectedOverlayId);
    controller.commit({ ...scene, overlays });
    setSelectedOverlayId(null);
  }, [scene, controller, selectedOverlayId]);

  // Floating images (ADR 0057). Gestures (the preview's drag, the timeline's drag) go through
  // begin/updateLive/endInteract, so a drag is one undo step; the panel's buttons and fields are
  // each one commit. Every edit reads the CURRENT scene from the controller and goes through
  // media-page-edits.ts, which composes the model in media.ts.
  const handleSelectMedia = useCallback(
    (id: string | null) => selectKind("media", id),
    [selectKind],
  );
  const handleMediaBox = useCallback(
    (id: string, box: { x: number; y: number; width: number }) => {
      const current = controllerRef.current;
      current.updateLive(setMediaBoxOf(current.scene, id, box));
    },
    [controllerRef],
  );
  const handleMediaMove = useCallback(
    (id: string, startTime: number) => {
      const current = controllerRef.current;
      current.updateLive(moveMediaTo(current.scene, id, startTime));
    },
    [controllerRef],
  );
  const handleMediaResizeEdge = useCallback(
    (id: string, edge: "start" | "end", time: number) => {
      const current = controllerRef.current;
      current.updateLive(resizeMediaEdgeTo(current.scene, id, edge, time));
    },
    [controllerRef],
  );
  // One panel action = one commit. `commit` already ignores a call mid-drag and a scene that
  // came back unchanged, but the guard keeps the selection side effects out of a drag too.
  const commitMediaEdit = useCallback(
    (edit: (scene: VideoScene) => VideoScene) => {
      const current = controllerRef.current;
      if (current.interacting) return;
      current.commit(edit(current.scene));
    },
    [controllerRef],
  );
  const handleDeleteMedia = useCallback(() => {
    if (!selectedMediaId) return;
    if (controllerRef.current.interacting) return;
    commitMediaEdit((current) => deleteMediaItem(current, selectedMediaId));
    selectKind("media", null);
  }, [selectedMediaId, controllerRef, commitMediaEdit, selectKind]);

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

  // The overlays as they were when the current trim/slide drag began. Clamping from the
  // live scene would truncate annotations permanently on the way down; clamping from this
  // snapshot lets a shorten-then-lengthen drag give the windows back. One shared ref is
  // fine: only one drag is active at a time.
  const dragOverlaysRef = useRef<VideoOverlay[] | null>(null);

  // Trim drags don't go through commit(): a continuous drag must collapse into one
  // undo step, so "move" only updates the live scene and "start"/"end" own history.
  const handleTrim = useCallback(
    (
      itemId: string,
      edge: "start" | "end",
      sourceTime: number,
      phase: "start" | "move" | "end",
    ) => {
      if (phase === "start") {
        dragOverlaysRef.current = controllerRef.current.scene.overlays;
        controllerRef.current.beginInteract();
      }
      if (phase === "move") {
        const current = controllerRef.current.scene;
        const dragged = current.items.find((item) => item.id === itemId);
        const items = trimClip(
          current.items,
          itemId,
          edge,
          sourceTime,
          dragged?.kind === "clip"
            ? clipBounds(sourceAxis(source.durationSeconds, current.sources), dragged)
            : { start: 0, end: source.durationSeconds },
        );
        const duration = layoutDuration(toLayout(items));
        controllerRef.current.updateLive({
          ...controllerRef.current.scene,
          items,
          overlays: clampOverlays(
            dragOverlaysRef.current ?? controllerRef.current.scene.overlays,
            duration,
          ),
        });
      }
      if (phase === "end") {
        dragOverlaysRef.current = null;
        controllerRef.current.endInteract();
      }
    },
    [controllerRef, source.durationSeconds],
  );

  // A slide's right-edge duration drag. Same begin/live/end contract as handleTrim so a
  // continuous drag collapses into one undo step; setSlideDuration clamps to the minimum.
  const handleSlideDuration = useCallback(
    (itemId: string, nextDuration: number, phase: "start" | "move" | "end") => {
      if (phase === "start") {
        dragOverlaysRef.current = controllerRef.current.scene.overlays;
        controllerRef.current.beginInteract();
      }
      if (phase === "move") {
        const items = setSlideDuration(controllerRef.current.scene.items, itemId, nextDuration);
        const duration = layoutDuration(toLayout(items));
        controllerRef.current.updateLive({
          ...controllerRef.current.scene,
          items,
          overlays: clampOverlays(
            dragOverlaysRef.current ?? controllerRef.current.scene.overlays,
            duration,
          ),
        });
      }
      if (phase === "end") {
        dragOverlaysRef.current = null;
        controllerRef.current.endInteract();
      }
    },
    [controllerRef],
  );

  // Same begin/live/end contract as handleTrim, driving the overlay lane's pill
  // body-drag (move) and end-handle (resize) interactions.
  const handleWindowChange = useCallback(
    (id: string, start: number, end: number, phase: "start" | "move" | "end") => {
      if (phase === "start") controllerRef.current.beginInteract();
      if (phase === "move") {
        controllerRef.current.updateLive({
          ...controllerRef.current.scene,
          overlays: controllerRef.current.scene.overlays.map((o) =>
            o.id === id ? ({ ...o, start, end } as VideoOverlay) : o,
          ),
        });
      }
      if (phase === "end") controllerRef.current.endInteract();
    },
    [controllerRef],
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
      const segment = controllerRef.current.scene.zoomSegments.find((z) => z.id === id);
      if (segment) {
        const live = playbackRef.current;
        const target = seekTargetForSegment(layoutRef.current, live.timelineTime, segment);
        if (target !== null) live.seek(target);
      }
      requestAnimationFrame(() => focusInspectorFirstControl());
    },
    [selectKind, controllerRef, layoutRef, playbackRef],
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

  const handleAddMute = useCallback(() => {
    const result = mutes.addAtPlayhead(playback.timelineTime);
    if (result.ok) selectKind("mute", result.id);
    else if (result.reason === "on-slide") showToast({ message: t("muteOnSlide") });
    else if (result.reason === "no-room") showToast({ message: t("muteNoRoom") });
  }, [mutes, playback.timelineTime, selectKind, t]);

  // "Hide webcam here": a hidden segment from the playhead to the next one, selected so its
  // edges can be dragged straight away; inside a segment, that segment is selected instead.
  const handleHideWebcam = useCallback(() => {
    const result = webcamEdits.hideAtPlayhead(playback.timelineTime);
    if (result.ok) selectKind("webcam", result.id);
    else if (result.reason === "on-slide") showToast({ message: t("webcamHideOnSlide") });
    else if (result.reason === "no-room") showToast({ message: t("webcamHideNoRoom") });
  }, [webcamEdits, playback.timelineTime, selectKind, t]);

  const handleRemoveWebcamSegment = useCallback(
    (id: string) => {
      webcamEdits.remove(id);
      selectKind("webcam", null);
    },
    [webcamEdits, selectKind],
  );

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
  // With the layer selected and the playhead inside an override, this is that override.
  // A drag freezes the playhead the target is resolved at (review S1): playback crossing an
  // override mid-drag would otherwise swap the inspector and unmount the dragged slider.
  const playheadSource = sourceTimeAtTimeline(layout, playback.timelineTime);
  const webcamTargetPlayhead = useRef(playheadSource);
  if (!controller.interacting) webcamTargetPlayhead.current = playheadSource;
  const webcamTarget =
    hasWebcam && scene.webcam
      ? webcamInspectorTarget(
          scene.webcam,
          webcamEdits.visibleSegments,
          selectedWebcamId,
          webcamTargetPlayhead.current,
        )
      : null;
  const selectedWebcamSegment = webcamTarget?.kind === "segment" ? webcamTarget.segment : null;

  // Privacy (doc 10). While a privacy tool is active or a region is selected the preview
  // shows the unzoomed original frame, so drawing/editing maps 1:1 to frame coordinates.
  const privacyTool = isPrivacyTool(videoTools.tool) ? videoTools.tool : null;
  const onSlide = playback.activeSlideId !== null;
  const [draftRegion, setDraftRegion] = useState<NormRect | null>(null);
  const selectedMute = selectedMuteId
    ? (scene.mutedRanges.find((r) => r.id === selectedMuteId) ?? null)
    : null;
  const selectedRedaction = selectedRedactionId
    ? (redactionEdits.visibleRedactions.find((r) => r.id === selectedRedactionId) ?? null)
    : null;
  const setVideoTool = videoTools.setTool;
  // The drawn cursor's hit-test, filled in by CursorLayer; the annotation layer asks it
  // when a Select press lands on empty space.
  const cursorClaimRef = useRef<((clientX: number, clientY: number) => boolean) | null>(null);
  const openCursorInspector = useCallback(() => {
    clearSelection();
    setVideoTool("select");
    setCapturesOpen(false);
    setAddRecordingOpen(false);
    setCursorInspectorOpen(true);
  }, [clearSelection, setVideoTool]);
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
      setCursorInspectorOpen(false);
      setCapturesOpen(false);
      setAddRecordingOpen(false);
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
      const r = controllerRef.current.scene.redactions.find((x) => x.id === id);
      if (!r) return;
      const [first] = sourceRangeToTimelineBlocks(layoutRef.current, r.start, r.end);
      if (first) playbackRef.current.seek((first.timelineStart + first.timelineEnd) / 2);
    },
    [selectKind, controllerRef, layoutRef, playbackRef],
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
  const cameraApplied =
    !holdingOriginal &&
    selectedZoom === null &&
    selectedRedaction === null &&
    privacyTool === null &&
    !onSlide;
  useCameraPreview(playback.videoRef, contentRef, cameraPath, cameraApplied);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isEditingTarget(e.target)) return;
      // Don't fire editor shortcuts behind the discard-changes modal, the export sheet or
      // the GIF export dialog — they block the scene from being safely mutated or played
      // while open. A video export runs in the background and blocks nothing.
      if (blocker.state === "blocked" || gifExport.status !== "idle" || exportSheetOpen) return;
      // The Timeline guide is a modal: its own Esc closes it, and nothing behind it reacts.
      if (guideTab !== null) return;
      // Any other modal (a capture's delete confirmation) owns the keys while it is open.
      if (document.querySelector('[aria-modal="true"]')) return;
      if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "h") {
        // In fullscreen only the stage is drawn: a guide portaled to <body> would be invisible.
        if (!document.fullscreenElement) openGuideFirstTab();
        return;
      }
      if (e.key === " ") {
        // A focused checkbox or radio (cursor and webcam inspectors) owns Space: it
        // toggles the control, not playback. Other shortcuts still reach them.
        if (ownsSpace(e.target)) return;
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
        // Shift+<variant letter> cycles that variant's group (Photoshop's Shift+key):
        // from the tool in use when it belongs to the group, else from the pressed one.
        const pressed = toolForShortcut(key, { onSlide });
        const next =
          pressed && e.shiftKey
            ? nextToolInGroup(sameGroup(videoTools.tool, pressed) ? videoTools.tool : pressed)
            : pressed;
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
        setCursorInspectorOpen(false);
        setCapturesOpen(false);
        setAddRecordingOpen(false);
        return;
      }
      // Annotation selection takes precedence over segment deletion when both exist —
      // an annotation is almost always the more "local" thing the user just touched.
      // Cmd/Ctrl+Backspace is a common "delete line/word" chord in text contexts —
      // require !isMod so it doesn't also delete an overlay or a segment.
      if (!isMod && (e.key === "Delete" || e.key === "Backspace")) {
        if (selectedRedactionId) handleRemoveRedaction(selectedRedactionId);
        else if (selectedMuteId) {
          mutes.remove(selectedMuteId);
          selectKind("mute", null);
        } else if (selectedZoomId) handleRemoveZoom(selectedZoomId);
        else if (selectedWebcamId && selectedWebcamId !== WEBCAM_LAYER_SELECTION)
          handleRemoveWebcamSegment(selectedWebcamId);
        else if (selectedMediaId) handleDeleteMedia();
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
    gifExport.status,
    exportSheetOpen,
    splitDisabled,
    deleteDisabled,
    handleSplit,
    handleDeleteSelected,
    selectedOverlayId,
    handleDeleteOverlay,
    selectedMediaId,
    handleDeleteMedia,
    clearSelection,
    selectedZoomId,
    selectedMuteId,
    mutes,
    selectKind,
    selectedRedactionId,
    handleRemoveZoom,
    handleRemoveRedaction,
    selectedWebcamId,
    handleRemoveWebcamSegment,
    videoTools,
    handleToolChange,
    handleAddZoom,
    onSlide,
    guideTab,
    openGuideFirstTab,
  ]);

  // Lane inputs that used to be inline closures/literals: with stable identities the memoised
  // lanes skip the re-render a slider drag would otherwise force on every one of them (NIW2-662).
  const handleSelectWebcam = useCallback((id: string) => selectKind("webcam", id), [selectKind]);
  const handleSelectMute = useCallback((id: string) => selectKind("mute", id), [selectKind]);
  const slideUrlFor = useCallback(
    (assetId: string) => assetStoreRef.current.get(assetId)?.url ?? null,
    [assetStoreRef],
  );
  // What the Clips section draws above the sequence (contract: media-lane-contract.ts). The
  // lane only reports gestures; the anchors are rewritten by the model through the handlers above.
  const placedMedia = useMemo(() => placeMedia(scene.media, layout), [scene.media, layout]);
  const timelineMedia = useMemo<TimelineMedia | undefined>(
    () =>
      showMedia
        ? {
            placed: placedMedia,
            rows: mediaRows(placedMedia),
            selectedId: selectedMediaId,
            imageUrl: slideUrlFor,
            onSelect: handleSelectMedia,
            onMove: handleMediaMove,
            onResizeEdge: handleMediaResizeEdge,
            onInteractionStart: controller.beginInteract,
            onInteractionEnd: controller.endInteract,
          }
        : undefined,
    [
      showMedia,
      placedMedia,
      selectedMediaId,
      slideUrlFor,
      handleSelectMedia,
      handleMediaMove,
      handleMediaResizeEdge,
      controller.beginInteract,
      controller.endInteract,
    ],
  );
  const selectedMedia = placedMedia.find((p) => p.item.id === selectedMediaId) ?? null;
  const ghostKind = draftRegion && privacyTool && drawWindow ? privacyTool : null;
  const ghostStart = drawWindow?.start ?? 0;
  const ghostEnd = drawWindow?.end ?? 0;
  const privacyGhost = useMemo(
    () => (ghostKind ? { kind: ghostKind, start: ghostStart, end: ghostEnd } : null),
    [ghostKind, ghostStart, ghostEnd],
  );
  const webcamSelectedId = selectedWebcamId === WEBCAM_LAYER_SELECTION ? null : selectedWebcamId;
  const extraLanes = useMemo(
    () =>
      [
        {
          key: "zooms",
          label: t("laneZooms"),
          icon: ZoomIn,
          node: (
            <ZoomLane
              segments={zooms.visibleZooms}
              layout={layout}
              selectedId={selectedZoomId}
              onSelect={handleSelectZoom}
              onEdgeDrag={zooms.edgeDrag}
              hasTrack={axisTrack !== null}
              marks={activity}
              showMarks={axisTrack !== null && !isTrackHidden("activity", hiddenTracks)}
            />
          ),
        },
        ...(hasWebcam
          ? [
              {
                key: "webcam",
                label: t("laneWebcam"),
                icon: Webcam,
                node: (
                  <WebcamLane
                    segments={webcamEdits.visibleSegments}
                    layout={layout}
                    thumbnails={webcamStrip.thumbnails}
                    covered={webcamStrip.covered}
                    noCameraItemIds={noCameraClips}
                    selectedId={webcamSelectedId}
                    onSelect={handleSelectWebcam}
                    onEdgeDrag={webcamEdits.edgeDrag}
                  />
                ),
              },
            ]
          : []),
        {
          key: "privacy",
          label: t("lanePrivacy"),
          icon: Shield,
          node: (
            <PrivacyLane
              redactions={redactionEdits.visibleRedactions}
              layout={layout}
              selectedId={selectedRedactionId}
              onSelect={handleSelectRedaction}
              onEdgeDrag={redactionEdits.edgeDrag}
              ghost={privacyGhost}
            />
          ),
        },
        {
          key: "audio",
          label: t("laneAudio"),
          icon: AudioLines,
          node: (
            <AudioLane
              ranges={mutes.mutedRanges}
              layout={layout}
              audioMuted={mutes.audioMuted}
              selectedId={selectedMuteId}
              onSelect={handleSelectMute}
              onEdgeDrag={mutes.edgeDrag}
            />
          ),
        },
      ].filter((lane) => !isTrackHidden(lane.key as TrackKey, hiddenTracks)),
    [
      axisTrack,
      activity,
      hiddenTracks,
      layout,
      t,
      zooms.visibleZooms,
      zooms.edgeDrag,
      selectedZoomId,
      handleSelectZoom,
      hasWebcam,
      webcamEdits.visibleSegments,
      webcamEdits.edgeDrag,
      webcamStrip.thumbnails,
      webcamStrip.covered,
      noCameraClips,
      webcamSelectedId,
      handleSelectWebcam,
      redactionEdits.visibleRedactions,
      redactionEdits.edgeDrag,
      selectedRedactionId,
      handleSelectRedaction,
      privacyGhost,
      mutes.mutedRanges,
      mutes.audioMuted,
      mutes.edgeDrag,
      selectedMuteId,
      handleSelectMute,
    ],
  );

  return (
    <div {...uiArea("editorVideo.page")} className={styles.page}>
      <div className={styles.workspace}>
        <main className={styles.stage} ref={stageRef}>
          {/* Video region: 1fr grid row — centers PreviewStage and constrains its height
              so the transport bar below is never clipped regardless of video aspect ratio.
              In fullscreen mode the height cap is lifted via an inline style override. */}
          <div
            {...uiArea("editorVideo.preview")}
            className={styles.videoRegion}
            style={isFullscreen ? { maxHeight: "none" } : undefined}
          >
            <PreviewStage
              playback={playback}
              mediaUrl={sourceUrl}
              axis={axis}
              recordings={stageRecordings}
              slideUrl={slideUrl}
              expanded={isFullscreen}
              contentRef={contentRef}
              background={backgroundEdits.background}
              onFrameSize={(size) => {
                setSourceHeight(size.height);
                setFrameSize(size);
              }}
              cursor={
                cursorData && (
                  <CursorLayer
                    data={cursorData}
                    claim={cursorClaimRef}
                    onSelect={openCursorInspector}
                    selected={cursorInspectorOpen}
                    videoRef={playback.videoRef}
                    path={cameraPath}
                    cameraEnabled={cameraApplied}
                    hidden={holdingOriginal || onSlide}
                    frame={frameSize}
                    redactions={scene.redactions}
                  />
                )
              }
              webcam={
                hasWebcam &&
                scene.webcam && (
                  <WebcamLayer
                    videoRef={playback.videoRef}
                    src={webcamTrack ? mediaUrl("webcam", source.id) : null}
                    startOffsetMs={webcamTrack?.startOffsetMs ?? 0}
                    recordings={webcamRecordings}
                    webcam={scene.webcam}
                    path={cameraPath}
                    cameraEnabled={cameraApplied}
                    frame={frameSize}
                    // "Hold to see original" shows the original, which has no face (spec
                    // open question 2); a slide has no webcam either.
                    hidden={holdingOriginal || onSlide}
                    interactive={videoTools.tool === "select"}
                    selected={webcamOutlined(scene.webcam, selectedWebcamId)}
                    onSelect={(sourceTime) => {
                      // Grabbing the bubble inside an override selects (and edits) that
                      // override, so the inspector shows what the user is looking at.
                      const override = scene.webcam && webcamOverrideAt(scene.webcam, sourceTime);
                      selectKind("webcam", override?.id ?? WEBCAM_LAYER_SELECTION);
                    }}
                    onBegin={webcamEdits.begin}
                    onMove={(position, sourceTime) =>
                      webcamEdits.liveLayout({ position }, sourceTime)
                    }
                    onEnd={webcamEdits.end}
                  />
                )
              }
              media={
                showMedia &&
                !holdingOriginal && (
                  <MediaLayer
                    media={scene.media}
                    layout={layout}
                    time={playback.timelineTime}
                    playing={playback.playing}
                    readTime={playback.readTimelineTime}
                    picture={pictureSize}
                    selectedId={selectedMediaId}
                    // A drawing tool armed: a stroke can start over an image.
                    interactive={videoTools.tool === "select"}
                    imageUrl={slideUrlFor}
                    onSelect={handleSelectMedia}
                    onBegin={controller.beginInteract}
                    onBoxChange={handleMediaBox}
                    onEnd={controller.endInteract}
                  />
                )
              }
              underlay={
                <RedactionLayer
                  redactions={redactionEdits.visibleRedactions}
                  videoRef={playback.videoRef}
                  hidden={holdingOriginal || onSlide}
                  frame={frameSize}
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
                    onBackgroundPress={(x, y) => cursorClaimRef.current?.(x, y) ?? false}
                    overlays={scene.overlays}
                    visibleIds={visibleIds}
                    selectedId={selectedOverlayId}
                    // A click on the canvas background deselects EVERYTHING (spec § 10.5),
                    // not just the annotation — otherwise a selected zoom would survive it
                    // and the inspector would keep showing the Zoom panel. It does not
                    // toggle playback: only the play button and Space do (NIW2-611), so a
                    // click meant to deselect never starts the video by surprise.
                    onSelect={(id) => {
                      if (id !== null) return selectKind("overlay", id);
                      // Deselecting everything includes the drawn cursor.
                      clearSelection();
                      setCursorInspectorOpen(false);
                    }}
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
                  />
                )
              }
            />
          </div>
          {/* Transport bar lives outside the overflow:hidden video region so it is always
              visible even when the video fills the full available height. */}
          <TransportBar
            layout={layout}
            playing={playback.playing}
            muted={playback.muted}
            speed={playback.speed}
            timelineTime={playback.timelineTime}
            duration={playback.duration}
            isFullscreen={isFullscreen}
            zoomCount={
              axisTrack || zooms.visibleZooms.length > 0 ? zooms.visibleZooms.length : null
            }
            privacyCount={redactionEdits.visibleRedactions.length}
            tracks={{
              available: availableTracks({ hasCursorTrack: axisTrack !== null, hasWebcam }),
              hidden: hiddenTracks,
              onToggle: toggleTrack,
            }}
            onTogglePlay={playback.toggle}
            onToggleMute={playback.toggleMute}
            onSpeedChange={handleSpeedChange}
            onSeek={playback.seek}
            onSplit={handleSplit}
            splitDisabled={splitDisabled}
            onDeleteSelected={handleDeleteSelected}
            deleteDisabled={deleteDisabled}
            onToggleFullscreen={handleFullscreen}
            timelineView={timelineView}
            onOpenGuide={openGuideFirstTab}
            onAddRecording={levelsOn ? toggleAddRecording : undefined}
            addRecordingActive={addRecordingShown}
          />
        </main>
        {/* NIW2-611: the video takes the left edge and the tools sit on its right, so the
            picture gets the width and the height the top bar used. */}
        <EditorToolRail
          onAddMute={handleAddMute}
          onToggleMuteAll={mutes.toggleAll}
          audioMuted={mutes.audioMuted}
          tool={videoTools.tool}
          onToolChange={handleToolChange}
          onAddZoom={handleAddZoom}
          privacyDisabled={onSlide}
          onHideWebcam={hasWebcam ? handleHideWebcam : undefined}
          onOpenCursor={
            cursorData
              ? () => (cursorInspectorOpen ? setCursorInspectorOpen(false) : openCursorInspector())
              : undefined
          }
          cursorSelected={cursorInspectorOpen && cursorData !== null}
          onToggleCaptures={toggleCaptures}
          capturesOpen={capturesOpen}
        />
        {/* The editor's actions live in the title bar's right side (Kaipu Black,
            NIW2-619), mounted and unmounted with this page. */}
        <HeaderActions>
          <EditorToolbar
            canUndo={controller.canUndo}
            canRedo={controller.canRedo}
            onUndo={controller.undo}
            onRedo={controller.redo}
            onCaptureFrame={() => void handleCaptureFrame()}
            // Until the first captures read lands: the duplicate check needs the real list.
            captureDisabled={stillCapture.busy || !sourceCaptures.loaded}
            onExport={handleExport}
            exportDisabled={gifExport.status === "exporting" || scene.items.length === 0}
            onOpenGuide={openGuideFirstTab}
          >
            {/* Not interactive — a reminder, not a control (plans/video-editor-v2/08 § PR 10
                polish, W12's "ORIGINAL UNTOUCHED" pill). The original recording on disk and
                its library thumbnail are untouched by every edit in this page. */}
            {/* data-collapse: the first thing a crowded title bar hides (title-bar.module.css). */}
            <span data-collapse="badge" className={styles.badgeSlot}>
              <Badge variant="neutral" style={sxEditor.originalPill}>
                <Shield size={12} strokeWidth={2} /> {t("originalUntouched")}
              </Badge>
            </span>
            {autosave.state !== "idle" && (
              <button
                type="button"
                className={styles.saveState}
                data-state={autosave.state}
                data-collapse="save"
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
        </HeaderActions>
        <div className={styles.side}>
          {capturesOpen ? (
            <CapturesPanel
              captures={sourceCaptures.captures}
              loaded={sourceCaptures.loaded}
              onSeek={seekToCapture}
              onAddToTimeline={(capture) => void addCaptureToTimeline(capture)}
              onDelete={deleteCapture}
              highlightedId={highlightedCaptureId}
              onClose={() => setCapturesOpen(false)}
            />
          ) : addRecordingShown ? (
            <AddFromLibraryPanel
              videos={libraryRecordings.videos}
              openedAssetId={source.assetId}
              loaded={libraryRecordings.loaded}
              onAdd={(video) => void addRecording(video, playback.timelineTime)}
              onDragStart={(video) => {
                draggedRecordingRef.current = video;
              }}
              onDragEnd={() => {
                draggedRecordingRef.current = null;
              }}
              onClose={() => setAddRecordingOpen(false)}
            />
          ) : (
            <EditorInspector>
              {cursorInspectorOpen && cursorData ? (
                <CursorInspector
                  controller={controller}
                  clicksAvailable={cursorData.track.clicksAvailable}
                />
              ) : selectedMedia ? (
                <MediaInspector
                  item={selectedMedia.item}
                  seconds={selectedMedia.end - selectedMedia.start}
                  canBringForward={
                    reorderMediaItem(scene, selectedMedia.item.id, "forward") !== scene
                  }
                  canSendBackward={
                    reorderMediaItem(scene, selectedMedia.item.id, "backward") !== scene
                  }
                  onDuration={(seconds) =>
                    commitMediaEdit((current) =>
                      setMediaDurationSeconds(current, selectedMedia.item.id, seconds),
                    )
                  }
                  onFull={() =>
                    commitMediaEdit((current) =>
                      fillPicture(current, selectedMedia.item.id, pictureSize),
                    )
                  }
                  onBox={() =>
                    commitMediaEdit((current) =>
                      putInCorner(current, selectedMedia.item.id, pictureSize),
                    )
                  }
                  onBringForward={() =>
                    commitMediaEdit((current) =>
                      reorderMediaItem(current, selectedMedia.item.id, "forward"),
                    )
                  }
                  onSendBackward={() =>
                    commitMediaEdit((current) =>
                      reorderMediaItem(current, selectedMedia.item.id, "backward"),
                    )
                  }
                  onFades={(fades) =>
                    commitMediaEdit((current) =>
                      setMediaFadesOf(current, selectedMedia.item.id, fades),
                    )
                  }
                  onDelete={handleDeleteMedia}
                />
              ) : selectedRedaction?.kind === "blur" ? (
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
              ) : selectedMute ? (
                <MuteInspector
                  range={selectedMute}
                  index={scene.mutedRanges.indexOf(selectedMute) + 1}
                  layout={layout}
                  mutes={mutes}
                  onRemoved={() => selectKind("mute", null)}
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
              ) : scene.webcam && webcamTarget?.kind === "layer" ? (
                <WebcamInspector
                  layout={scene.webcam.layout}
                  edits={webcamEdits}
                  frame={frameSize}
                  onHideHere={handleHideWebcam}
                />
              ) : selectedWebcamSegment ? (
                <WebcamSegmentInspector
                  segment={selectedWebcamSegment}
                  index={webcamEdits.visibleSegments.indexOf(selectedWebcamSegment) + 1}
                  range={timelineRangeOf(selectedWebcamSegment.start, selectedWebcamSegment.end)}
                  layout={webcamAt(scene, selectedWebcamSegment.start) ?? scene.webcam!.layout}
                  edits={webcamEdits}
                  frame={frameSize}
                  onRemoved={() => selectKind("webcam", null)}
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
              ) : (
                // Nothing selected: the empty state, then the drawing defaults while a
                // drawing tool is armed, or the Detection panel.
                <>
                  <InspectorEmptyState tool={videoTools.tool} />
                  <BackgroundPanel edits={backgroundEdits} />
                  {videoTools.tool === "box" ||
                  videoTools.tool === "arrow" ||
                  videoTools.tool === "text" ? (
                    <AnnotationDefaultsPanel tools={videoTools} />
                  ) : (
                    <DetectionPanel
                      zooms={zooms}
                      sensitivity={scene.zoomSensitivity}
                      clicksAvailable={axisTrack?.clicksAvailable ?? false}
                    />
                  )}
                </>
              )}
            </EditorInspector>
          )}
        </div>
      </div>
      <footer {...uiArea("editorVideo.timeline")} className={styles.timeline}>
        <TimelineStrip
          layout={layout}
          playback={playback}
          thumbnails={thumbnails}
          clipRecordings={clipRecordingMap}
          recordingThumbnails={recordingThumbnails}
          selectedItemId={selectedItemId}
          onSelectItem={setSelectedItemId}
          onTrim={handleTrim}
          slideUrlFor={slideUrlFor}
          onSlideDuration={handleSlideDuration}
          overlays={scene.overlays}
          showOverlays={!isTrackHidden("annotations", hiddenTracks)}
          selectedOverlayId={selectedOverlayId}
          onSelectOverlay={setSelectedOverlayId}
          onWindowChange={handleWindowChange}
          timelineView={timelineView}
          extraLanes={extraLanes}
          media={timelineMedia}
          onOpenGuide={openGuide}
          onDropRecording={levelsOn ? dropRecording : undefined}
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
      {guideTab && (
        <TimelineGuideModal tab={guideTab} onTabChange={setGuideTab} onClose={closeGuide} />
      )}
      {exportSheetOpen && (
        <ExportSheet
          sourceTitle={source.title}
          sourceSizeBytes={source.sizeBytes ?? null}
          thumbnailUrl={source.thumbnailUrl ?? null}
          timelineDuration={playback.duration}
          sourceWidth={frameSize.width}
          estimate={gifExport.estimate}
          presetSource={{
            width: frameSize.width,
            height: frameSize.height,
            fps: sourceProbe?.fps ?? 30,
            hasAudio: (sourceProbe?.hasAudio ?? true) && !scene.audioMuted,
            sampleRate: sourceProbe?.sampleRate,
          }}
          // Settings → Export quality; another row applies to this export only and is
          // never remembered, nor written to the edit session (FR13).
          defaultPreset={appSettings.settings?.exportQuality}
          // A row whose file already carries exactly this edit opens it instead of encoding.
          reusable={findReusableExports(sourceExports, editFingerprint(scene, cursorData !== null))}
          onOpenExisting={(existing) => {
            closeExportSheet();
            // Edits not yet written still go through the discard guard.
            navigate(`/library/${existing.assetId}`);
          }}
          onGifSettingsChange={handleGifSettingsChange}
          onExportVideo={(choice) => {
            closeExportSheet();
            startVideoExport(choice);
          }}
          onExportGif={startGifExport}
          onCancel={closeExportSheet}
        />
      )}
      {gifExport.status !== "idle" && (
        <ExportDialog
          status={gifExport.status}
          fraction={gifExport.fraction}
          error={gifExport.error}
          title={t("exportingGif")}
          errorTitle={t("gifExportError")}
          onCancel={gifExport.cancel}
          onRetry={() => {
            const settings = lastGifSettingsRef.current;
            gifExport.cancel();
            if (settings) startGifExport(settings);
          }}
        />
      )}
    </div>
  );
}
