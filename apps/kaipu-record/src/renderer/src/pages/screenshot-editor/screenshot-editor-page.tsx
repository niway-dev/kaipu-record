import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Navigate, useBlocker, useLocation, useNavigate } from "react-router-dom";
import {
  Check,
  Copy,
  Download,
  FileText,
  Redo2,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { useImageSource, type ImageSource } from "@renderer/features/screenshots/image-source";
import {
  type AutoActions,
  autoActionsOnOpen,
  openKindOf,
} from "@renderer/features/screenshots/auto-capture-policy";
import { DiscardChangesDialog } from "@renderer/features/screenshots/discard-changes-dialog";
import { FitIcon } from "@renderer/features/screenshots/toolbar/editor-icons";
import type { CanvasSavePayload } from "@shared/types/screenshot-canvas";
import type { TextCacheSavePayload } from "@shared/types/text-recognition";
import { captureException, reportError } from "@renderer/features/analytics";
import { screenshotTitle } from "@shared/screenshot-title";
import {
  isAmbiguousIdentityError,
  notifyAmbiguousIdentity,
  notifyRenameOutcome,
} from "@renderer/features/library/rename-outcome";
import {
  BeautifiedFrame,
  BeautifyPanel,
  CropChip,
  CropOverlay,
  DEFAULT_BEAUTIFY,
  FLAT_BEAUTIFY,
} from "@renderer/features/screenshots/beautify";
import {
  ColorsPanel,
  InspectLayer,
  InspectModePill,
  InspectToggle,
  formatColor,
  formatShare,
  isEditingTarget,
  LocateOverlay,
  locatedColor,
  unpackRgb,
  useColors,
  useInspect,
} from "@renderer/features/screenshots/inspect";
import { SaveOptionsDialog } from "@renderer/features/screenshots/save-options-dialog";
import { CaptureTitleInput } from "@renderer/features/screenshots/capture-title-input";
import {
  savedAtOf,
  whyNoDocument,
  type CanvasLoad,
} from "@renderer/features/screenshots/reopen/canvas-load";
import { ReopenNoticeSlot } from "@renderer/features/screenshots/reopen/reopen-notice";
import {
  resolveCaptureTitle,
  useCaptureTitle,
} from "@renderer/features/screenshots/use-capture-title";
import {
  AnnotationLayer,
  AnnotationToolbar,
  BASE_ASSET_ID,
  ZERO_EXTENTS,
  bakeCanvasRedactions,
  buildCanvasDoc,
  contentExtents,
  exportPixelSize,
  extentsToDisplay,
  frameToWorld,
  intersectFrame,
  nextAnnotationId,
  parseCanvasDoc,
  reserveAnnotationIds,
  useAnnotationTools,
  useEditorScene,
  worldToFrame,
  type AnnotationTool,
  type CanvasAssets,
  type CanvasGeom,
  type Annotation,
  type CropRect,
  type Extents,
  type ImageAnnotation,
  type EditorScene,
  type Scene,
} from "@renderer/features/screenshots/annotations";
import {
  AddImageControl,
  CANVAS_ZOOM,
  ExportBox,
  OffContentNotice,
  RedactionNotice,
  SidePanel,
  ALL_PANEL_TABS,
  contentBoxFrame,
  hasSeenRedactionNotice,
  markRedactionNoticeSeen,
  isIdentityView,
  useCanvasViewport,
  useOffContent,
  useDotGrid,
  useExtentsCompensation,
  useShotMetrics,
  type PanelTab,
} from "@renderer/features/screenshots/canvas";
import { decodeToPng, imageFileFromPaste } from "@renderer/features/editor/paste-image";
import { isTextField, readFromMain } from "@renderer/features/editor/use-paste-to-editor";
import { useFlag } from "@renderer/features/analytics/use-flag";
import {
  redactionRectsInPixels,
  useRecognizedText,
  distinctLineCount,
  TextNotice,
  TextShimmer,
  useTextSelection,
  useTextSelectionKeys,
  type PixelSize,
  type TextLayerModel,
  type TextToolStatus,
} from "@renderer/features/screenshots/text-selection";
import { wordsOutsideRects } from "@kaipu/domain/schemas";
import {
  clearExportCache,
  exportScene,
  type ExportFormat,
} from "@renderer/features/screenshots/export";
import { useTransientValue } from "@renderer/ui/use-transient-value";
import { PanelToggle } from "@renderer/features/screenshots/toolbar/panel-toggle";
import { MoreMenu } from "@renderer/features/screenshots/toolbar/more-menu";
import { useCompactEditor } from "@renderer/features/screenshots/toolbar/use-compact-editor";
import { ToolPanel } from "@renderer/features/screenshots/tool-panel/tool-panel";
import { useToolShortcuts } from "@renderer/features/screenshots/toolbar/use-tool-shortcuts";
import { isMaintenanceError } from "@renderer/features/library/vault-errors";
import { showToast } from "@renderer/ui/toast-store";
import { ItemWorkspaceChip } from "@renderer/features/workspaces/move/item-workspace-chip";
import styles from "./screenshot-editor-page.module.css";
import "../../features/screenshots/theme/image-editor-theme.css";
import { uiArea } from "@renderer/lib/ui-area";

/** The gap, in source px, between the content box and an image added to its right. */
const ADDED_IMAGE_GAP_PX = 32;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;
/** How long the Copy/Save buttons stay in their "done" state. */
const FEEDBACK_MS = 2600;
/** How long after the last edit a shot in the vault saves it. */
const AUTOSAVE_DEBOUNCE_MS = 800;

/** The editor's transient success indicator. */
type Feedback =
  | { kind: "copied" }
  | { kind: "saved"; name: string }
  // A PDF went to a path the user picked; `name` is the file name there.
  | { kind: "exported"; name: string }
  // Both auto actions fired on open. One indicator, not two: `feedback` holds a
  // single value on purpose, so the combined outcome needs its own kind.
  | { kind: "savedAndCopied"; name: string };

/** The last path segment, whichever separator the OS used. */
const fileName = (path: string): string => path.split(/[\\/]/).pop() ?? path;

const clampZoom = (z: number): number =>
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));

/**
 * Route wrapper: guards on a missing source and, crucially, keys the editor by
 * the navigation entry so every fresh capture remounts it — resetting zoom,
 * annotations, and the beautify panel to their initial state.
 */
export function ScreenshotEditorPage(): React.JSX.Element {
  const location = useLocation();
  const source = location.state as ImageSource | null;
  if (!source) return <Navigate to="/screenshots" replace />;
  return <ScreenshotEditor key={location.key} source={source} fresh />;
}

/**
 * A reopened canvas document (ADR 0053), validated and ready to mount: the base asset's
 * bytes as the editor's image, and the scene it was saved with.
 */
interface LoadedCanvasDoc {
  bytes: ArrayBuffer;
  scene: Scene;
  /** The base image's pixel size as the document recorded it. */
  pixelWidth: number;
  pixelHeight: number;
  /** The bytes of every image annotation's asset (NIW2-703). */
  assets: CanvasAssets;
}

/** A new asset id for an added image: matches `CANVAS_ASSET_ID_PATTERN`, never "base". */
function newImageAssetId(): string {
  let id = "";
  while (id.length < 12) id += Math.random().toString(36).slice(2);
  return `img-${id.slice(0, 12)}`;
}

/**
 * Read and validate the document saved beside a vault shot. Anything but `loaded` means
 * "open the flattened PNG instead": `absent` when there is no document (a plain screenshot),
 * `unreadable` when one exists but is corrupt or unsupported, lacks its base asset, or could
 * not be read. It never rejects, so a bad document can never keep the editor from opening.
 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const isPng = (bytes: ArrayBuffer): boolean => {
  const head = new Uint8Array(bytes, 0, Math.min(8, bytes.byteLength));
  return head.length === 8 && PNG_SIGNATURE.every((b, i) => head[i] === b);
};

async function loadCanvasDoc(id: string): Promise<CanvasLoad<LoadedCanvasDoc>> {
  const unreadable: CanvasLoad<LoadedCanvasDoc> = { status: "unreadable" };
  try {
    const stored = await window.electronAPI.readScreenshotCanvas(id);
    // The reader answers null for a missing document and an unusable one alike.
    if (!stored) return { status: await whyNoDocument(id) };
    const parsed = parseCanvasDoc(stored.docJson);
    if (!parsed) return unreadable;
    const bytes = stored.assets[parsed.base.assetId];
    // Not a PNG: the image would never load and the editor would stay disabled.
    if (!bytes || !isPng(bytes)) return unreadable;
    // An image whose asset is gone or not a PNG cannot be drawn or exported: like a bad base,
    // open the flattened PNG (which still shows it) instead of a document that would throw.
    const assets: CanvasAssets = {};
    for (const a of parsed.scene.annotations) {
      if (a.kind !== "image") continue;
      const asset = stored.assets[a.assetId];
      if (!asset || !isPng(asset)) return unreadable;
      assets[a.assetId] = asset;
    }
    // New annotations must not reuse an id the document already holds.
    reserveAnnotationIds(parsed.scene.annotations);
    return {
      status: "loaded",
      doc: {
        bytes,
        scene: parsed.scene,
        pixelWidth: parsed.base.pixelWidth,
        pixelHeight: parsed.base.pixelHeight,
        assets,
      },
      savedAt: await savedAtOf(id),
    };
  } catch (error) {
    // The next save replaces the document with one built on the flat PNG, so a read that
    // failed (not a missing or invalid document) loses the editable layers: record it.
    captureException(error, { phase: "read-canvas" });
    return unreadable;
  }
}

/**
 * The image editor. The Editor workspace routes render it, keyed per item.
 *
 * In canvas mode a vault shot is reopened from its document, when it has a valid one. The
 * document is read BEFORE the editor body mounts, so the body's initial scene is the saved
 * one, set synchronously: a clean reopen is never marked dirty and never autosaves. Until
 * the read settles this renders nothing, as the body does while its image loads.
 */
export function ScreenshotEditor({
  source,
  fresh = false,
}: {
  source: ImageSource;
  /** A capture that is not in the vault yet (`/editor/capture`), not a saved item. */
  fresh?: boolean;
}): React.JSX.Element {
  // Latched at mount, here and handed down: a shot never mixes the two models (see below).
  const [canvasMode] = useState(useFlag("image-canvas"));
  const needsRead = canvasMode && source.kind === "local";
  const localId = source.kind === "local" ? source.id : null;
  const [loaded, setLoaded] = useState<{ id: string; load: CanvasLoad<LoadedCanvasDoc> } | null>(
    null,
  );
  useEffect(() => {
    if (!needsRead || localId === null) return;
    let cancelled = false;
    void loadCanvasDoc(localId).then((load) => {
      if (!cancelled) setLoaded({ id: localId, load });
    });
    return () => {
      cancelled = true;
    };
  }, [needsRead, localId]);
  if (needsRead && loaded?.id !== localId) return <></>;
  return (
    <ScreenshotEditorBody
      source={source}
      fresh={fresh}
      canvasMode={canvasMode}
      doc={needsRead && loaded?.load.status === "loaded" ? loaded.load.doc : null}
      reopen={needsRead ? (loaded?.load ?? null) : null}
    />
  );
}

function ScreenshotEditorBody({
  source,
  fresh,
  canvasMode,
  doc,
  reopen,
}: {
  source: ImageSource;
  fresh: boolean;
  canvasMode: boolean;
  /** The document a canvas-mode reopen found, or null (flat PNG, no annotations). */
  doc: LoadedCanvasDoc | null;
  /** What the reopen found, for the notice on the stage (null: not a canvas-mode reopen). */
  reopen: CanvasLoad<LoadedCanvasDoc> | null;
}): React.JSX.Element {
  const t = useTranslations("screenshots");
  const tLibrary = useTranslations("library");
  const tCommon = useTranslations("common");
  // A reopened document shows its base asset, resolved like a blob. Everything else below
  // (open kind, save binding, auto actions) still reads the ORIGINAL `source`: a reopen is
  // a vault item, never a fresh capture to auto-save or auto-copy.
  const imageSource = useMemo<ImageSource>(
    () => (doc ? { kind: "blob", bytes: doc.bytes, origin: "quiet" } : source),
    [doc, source],
  );
  const image = useImageSource(imageSource);
  // A re-opened saved shot is already framed/flattened — start it unframed so the
  // editor doesn't beautify it twice; a fresh capture gets the default frame.
  // A pasted image is the user's own picture (often a photo), not a screenshot to
  // show off, so it opens unframed too.
  const openKind = openKindOf(source);
  const scene = useEditorScene(
    doc ? doc.scene.beautify : openKind === "capture" ? DEFAULT_BEAUTIFY : FLAT_BEAUTIFY,
    doc?.scene,
  );
  const tools = useAnnotationTools();
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  // Infinite canvas (NIW2-698): content may leave the image, the view pans, export is the
  // content box. `canvasMode` is latched at mount by `ScreenshotEditor`: `useFlag` is
  // reactive, but a shot must never mix the two models (a classic crop would be dropped, or
  // outside content clipped, on the next export or autosave). A flag change applies to the
  // next editor that opens. Everything below branches on this boolean. Off = today's editor.
  // Inspect mode (NIW2-699): latched like `canvasMode`. Off = no button, no key, no listener,
  // no decode: the editor is exactly what it was.
  const [inspectEnabled] = useState(useFlag("image-inspect"));
  const inspect = useInspect({
    enabled: inspectEnabled,
    canvasMode,
    image,
    imgRef,
    // Inspect reads the image, it does not edit it: leave any drawing tool (a crop included).
    onEnter: () => {
      tools.setTool("select");
      scene.select(null);
    },
    // A click while the ruler shows a run pins it (NIW2-702). It stays in image pixels, so it
    // moves with the image and its label is the same at any zoom; Inspect stays on, so the
    // next run can be measured straight away. Esc + Select edits it like any annotation.
    onPin: (run) => {
      scene.addAnnotation({
        id: nextAnnotationId().id,
        kind: "measure",
        axis: run.axis,
        from: run.from,
        to: run.to,
        at: run.at,
        imageW: run.imageW,
        imageH: run.imageH,
        color: tools.color,
      });
    },
  });
  // The colors panel (NIW2-704) counts Inspect's decoded pixels in a worker.
  const colors = useColors({ active: inspect.active, buffer: inspect.buffer });
  const [zoom, setZoom] = useState(1);
  // Text recognition (NIW2-705, behind `image-text`). Latched at mount like `canvasMode`:
  // a shot never gains or loses the tool halfway through an edit.
  const [textEnabled] = useState(useFlag("image-text"));
  // One transient "last action" indicator — copied or saved-with-name — that
  // auto-clears; avoids the illegal "both shown" state two flags allowed.
  const [feedback, showFeedback] = useTransientValue<Feedback>(FEEDBACK_MS);
  // Export needs the displayed <img> size to scale beautify/annotations to the
  // shot's native (Retina) pixels — gate Copy/Save until the image has laid out.
  const [imageReady, setImageReady] = useState(false);
  // Exports and saves run one at a time, in click order. A click during another
  // export WAITS instead of being dropped; the queue also keeps a double-click on a
  // fresh shot from creating two library entries (see `bindToSaved`).
  const queueTail = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = <T,>(job: () => Promise<T>): Promise<T> => {
    const run = queueTail.current.then(job);
    queueTail.current = run.catch(() => undefined);
    return run;
  };
  // False after unmount: jobs that start later and toast Retry buttons become no-ops
  // (a stale Retry would re-save a discarded capture with the wrong export scale).
  // Unmount also drops the memoized export, which pins one composite PNG.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true; // StrictMode re-runs effects
    return () => {
      alive.current = false;
      clearExportCache();
    };
  }, []);
  // The vault id this editor is bound to: set when re-opening a saved shot, and
  // after the first save. While set, Save asks overwrite-or-copy.
  const [savedId, setSavedId] = useState<string | null>(source.kind === "local" ? source.id : null);
  // Queued jobs read these when they RUN, not from the render that queued them.
  const savedIdRef = useRef(savedId);
  // The saved item's identity: an overwrite names it so main can follow a rename.
  const savedAssetIdRef = useRef<string | undefined>(
    source.kind === "local" ? source.assetId : undefined,
  );
  // The item the auto-save on open created: the ONLY thing Discard may delete.
  const autoSavedId = useRef<string | null>(null);
  /** The latest save main refused during maintenance mode, retried when it ends. */
  const refusedDuringMaintenance = useRef<Parameters<typeof persist>[0] | null>(null);
  // Recognition runs once per image on open, never blocks the canvas, and reads the saved id
  // when its call goes out (the id a first save creates does not re-run it).
  // Picking Select text bumps this: an `unavailable` result is then requested once more.
  const [textPicks, setTextPicks] = useState(0);
  const recognized = useRecognizedText({
    enabled: textEnabled,
    retryKey: textPicks,
    getBytes: image?.getBytes ?? null,
    assetId: BASE_ASSET_ID,
    getId: () => savedIdRef.current,
  });
  const recognizedRef = useRef(recognized);
  recognizedRef.current = recognized;
  // The base image's pixel size: the space the recognized words are in. The decoded image
  // first; the known sizes cover an image that has not reported one, in `basePixels`' order:
  // a reopened document's base before the source, whose size is the flat export's (with added
  // images, the whole content box).
  const naturalNow = (): PixelSize => ({
    w: imgRef.current?.naturalWidth || doc?.pixelWidth || source.width || 0,
    h: imgRef.current?.naturalHeight || doc?.pixelHeight || source.height || 0,
  });
  const [natural, setNatural] = useState<PixelSize | null>(null);
  // The words a person can select: those no redaction of this session (saved or not) covers.
  const visibleWords = useMemo(() => {
    if (recognized.status !== "ready" || !natural || natural.w <= 0 || natural.h <= 0) return [];
    return wordsOutsideRects(recognized.words, redactionRectsInPixels(scene.annotations, natural));
  }, [recognized, natural, scene.annotations]);
  const textSelection = useTextSelection(visibleWords);
  const textActive = textEnabled && tools.tool === "selectText";
  // The redact tool hides recognized lines in one click (NIW2-706), canvas mode only.
  const hideActive = textEnabled && canvasMode && tools.tool === "blur";
  useEffect(() => {
    if (textActive || hideActive) setTextPicks((n) => n + 1);
  }, [textActive, hideActive]);
  // Leaving the tool drops the selection: a highlight nobody can see must not be copied.
  const { clear: clearTextSelection } = textSelection;
  useEffect(() => {
    if (!textActive) clearTextSelection();
  }, [textActive, clearTextSelection]);
  const copyText = async (): Promise<void> => {
    const value = textSelection.text;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      showToast({
        message: t("textCopied"),
        detail: t("textCopiedLines", { count: distinctLineCount(textSelection.selected) }),
      });
    } catch (error) {
      reportError(t("textCopyError"), error, { context: { phase: "copy-text" } });
    }
  };
  useTextSelectionKeys({
    active: textActive,
    hasSelection: textSelection.selected.length > 0,
    onCopy: () => void copyText(),
    onSelectAll: textSelection.selectAll,
  });
  const textLayer = useMemo<TextLayerModel | undefined>(
    () =>
      textEnabled && natural && natural.w > 0 && natural.h > 0
        ? {
            words: textSelection.ordered,
            natural,
            selected: textSelection.selectedSet,
            select: textSelection.select,
            clear: textSelection.clear,
          }
        : undefined,
    [
      textEnabled,
      natural,
      textSelection.ordered,
      textSelection.selectedSet,
      textSelection.select,
      textSelection.clear,
    ],
  );
  const textTool: TextToolStatus | undefined = textEnabled
    ? {
        status: recognized.status,
        wordCount: visibleWords.length,
        selectedCount: textSelection.selected.length,
        onCopy: () => void copyText(),
        onSelectAll: textSelection.selectAll,
      }
    : undefined;
  // The auto actions come from the capture's own policy (the copy mode of the workspace it
  // started in, bound when it started, ADR 0034). The editor never reads the setting for a
  // capture, so a switch or a Settings edit between the shot and the editor neither copies
  // nor skips the copy. Only a fresh capture has auto actions at all (`openKind`); one with
  // no policy (its settings were unreadable) copies nothing.
  const autoActionsRef = useRef<AutoActions | null>(null);
  if (autoActionsRef.current === null) {
    const copyMode =
      source.kind === "blob" ? (source.policy?.screenshotCopy ?? "manual") : "manual";
    autoActionsRef.current = autoActionsOnOpen(copyMode, openKind);
  }
  // True once THIS editor created the item on open — enables Discard.
  const [autoSaved, setAutoSaved] = useState(false);
  const navigate = useNavigate();
  const [askSave, setAskSave] = useState(false);
  // The auto title is computed once; the toolbar field starts from it and is
  // what Save writes. On a saved shot, committing the field renames the vault item
  // in place — the same IPC the Library's inline rename uses.
  const [autoTitle] = useState(() => source.title ?? screenshotTitle());
  // NIW2-560: a rename moves the file, so the vault id changes. It runs through the
  // same queue as saves, so a save never overwrites the old (vanished) name while the
  // file is moving, and the new id is adopted everywhere this editor holds it.
  const renameSaved = (next: string): Promise<void> =>
    enqueue(async () => {
      const id = savedIdRef.current;
      const assetId = savedAssetIdRef.current;
      if (!id || !alive.current) return;
      try {
        // A reopened vault shot reads its original bytes lazily, by the id it opened
        // with. Read (and cache) them now, while the file is still there: after the move
        // that id names nothing, and the next save would fail.
        // Best effort: an unreadable file must not block the title.
        if (image) await image.getBytes().catch(() => {});
        // The identity rides along: main renames the item it names, wherever it lives now.
        if (!assetId) throw new Error("rename: the saved shot has no assetId");
        const result = await window.electronAPI.renameLocalRecording(id, assetId, next);
        const newId = result.recording.id;
        savedIdRef.current = newId;
        savedAssetIdRef.current = result.recording.assetId;
        setSavedId(newId);
        if (autoSavedId.current === id) autoSavedId.current = newId;
        notifyRenameOutcome(result, { library: tLibrary, common: tCommon }, () => {
          if (alive.current) void renameSaved(next);
        });
      } catch (error) {
        if (isAmbiguousIdentityError(error)) {
          notifyAmbiguousIdentity(tLibrary);
          return;
        }
        reportError(t("renameError"), error, {
          context: { phase: "rename", id },
          retry: () => void renameSaved(next),
        });
      }
    });
  const captureTitle = useCaptureTitle(
    autoTitle,
    savedId ? (next) => void renameSaved(next) : null,
  );

  // Unsaved-changes guard. A fresh capture (blob) lives ONLY in memory, so it's
  // dirty from the moment it opens — leaving loses the only copy; a re-opened
  // saved shot starts clean. Either way, any scene edit re-dirties it, and a
  // successful save clears it.
  const isFreshCapture = source.kind !== "local";
  const [dirty, setDirty] = useState(isFreshCapture);
  // `beautify.state`/`annotations`/`crop` are stable per-scene-state refs (they
  // only change on an actual edit — see useEditorScene), so this fires exactly
  // when the scene changes. Skip the initial run so a clean re-opened shot isn't
  // marked dirty just by mounting.
  const sceneSettled = useRef(false);
  // Bumped per scene edit. A save clears `dirty` only if no edit landed while it ran.
  const sceneRevision = useRef(0);
  const currentScene = (): Scene => ({
    beautify: scene.beautify.state,
    annotations: scene.annotations,
    crop: scene.crop,
    exportFrame: scene.exportFrame,
  });
  // The scene and title field as of the latest render, for queued jobs to read.
  const latest = useRef({ scene: currentScene(), draft: captureTitle.draft });
  latest.current = { scene: currentScene(), draft: captureTitle.draft };
  useEffect(() => {
    if (!sceneSettled.current) {
      sceneSettled.current = true;
      return;
    }
    sceneRevision.current += 1;
    setDirty(true);
  }, [scene.beautify.state, scene.annotations, scene.crop, scene.exportFrame]);

  // Hold in-app navigation (sidebar clicks, ⌘⌃V start-recording, ⌘⇧1 new
  // capture — all go through the router) while there are unsaved changes. A shot that
  // is in the vault saves its edits and then leaves (see `autosaveEdits`); only an
  // image the vault has never seen asks before it is lost.
  // Discard deletes the auto-saved item and leaves. The blocker reads `dirty` from the
  // render it was called in, so navigating in the same tick as `setDirty(false)` would
  // still be blocked after an edit; instead, flip `discarding`, let the blocker lift on
  // re-render, and navigate from the effect below.
  const [discarding, setDiscarding] = useState(false);
  const blocker = useBlocker(dirty && !discarding);
  useEffect(() => {
    if (discarding) navigate("/screenshots");
  }, [discarding, navigate]);

  // ⌘/Ctrl + wheel (and trackpad pinch, which arrives as ctrlKey wheel) zooms the
  // view. Non-passive so we can preventDefault Electron's own page zoom. Attaches
  // once the canvas mounts (image resolves) — keyed on a stable boolean, not the
  // `image` object (which is fresh each render), so it doesn't re-subscribe. Plain
  // scroll still pans.
  const hasImage = image != null;
  // Canvas mode has its own wheel handling (`useCanvasViewport`): pan, and zoom around the
  // pointer. This one is the classic editor's.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || canvasMode) return;
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => clampZoom(z * Math.exp(-e.deltaY * 0.0015)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [hasImage, canvasMode]);

  const zoomBy = (delta: number): void => setZoom((z) => clampZoom(z + delta));

  // Canvas mode. The view (zoom + pan) is view-only: it never reaches the scene or the export.
  const viewport = useCanvasViewport(canvasRef, canvasMode, hasImage);
  const metrics = useShotMetrics(imgRef, canvasMode, imageReady);
  // How far the content sticks out past each side of the shot, in display px, from the
  // live annotations (the same measure the export uses, at the same scale).
  // While a shape is drawn or moved the stored annotations do not hold it yet: the layer
  // reports what is on screen (`onLive`) and the extents (in source px) follow the drag, so
  // the box and its label grow live instead of jumping on release (mock A3). Only the
  // extents are kept, and only when they change, so a drag that stays inside the shot does
  // not re-render the page on every pointer move.
  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;
  const [liveExtents, setLiveExtents] = useState<Extents | null>(null);
  const onLive = useCallback((shown: readonly Annotation[] | null): void => {
    const m = metricsRef.current;
    if (!shown || !m || m.w <= 0 || m.naturalW <= 0) {
      setLiveExtents(null);
      return;
    }
    const next = contentExtents(shown, m.naturalW, m.naturalH, m.naturalW / m.w);
    setLiveExtents((prev) =>
      prev &&
      prev.left === next.left &&
      prev.top === next.top &&
      prev.right === next.right &&
      prev.bottom === next.bottom
        ? prev
        : next,
    );
  }, []);
  // The content box's overhang in source px (the export's own measure), live or stored.
  const extentsNatural = useMemo(() => {
    if (!canvasMode || !metrics || metrics.w <= 0 || metrics.naturalW <= 0) return ZERO_EXTENTS;
    return (
      liveExtents ??
      contentExtents(
        scene.annotations,
        metrics.naturalW,
        metrics.naturalH,
        metrics.naturalW / metrics.w,
      )
    );
  }, [canvasMode, metrics, scene.annotations, liveExtents]);
  const extents = useMemo(() => {
    if (!canvasMode || !metrics || metrics.w <= 0 || metrics.naturalW <= 0) return ZERO_EXTENTS;
    return extentsToDisplay(extentsNatural, metrics.naturalW / metrics.w);
  }, [canvasMode, metrics, extentsNatural]);
  // Growing or shrinking the content box re-centres the frame, which would slide the shot
  // on screen. Move the pan by the same amount so the shot stays where the user left it.
  // The first measurement is the baseline, so a reopened document with content outside the
  // image opens with its content box in view instead of panned off-centre.
  const { compensate, fit } = viewport;
  // A reopened document wider or taller than the canvas opens fitted, not clipped.
  const fitOnOpen = useCallback(() => fit({ onlyIfOverflowing: true }), [fit]);
  useExtentsCompensation(
    extents,
    canvasMode && metrics != null && metrics.w > 0 && metrics.naturalW > 0,
    compensate,
    fitOnOpen,
  );
  // An added image lands past the content box's right edge, often off screen: once its
  // extents are laid out (after the compensation above), fit the view so it shows.
  const fitAfterAdd = useRef(false);
  useLayoutEffect(() => {
    if (!fitAfterAdd.current) return;
    fitAfterAdd.current = false;
    fit();
    // Keyed on the annotations too: an add always changes them, so the flag never outlives
    // the render that placed the image.
  }, [scene.annotations, extents, fit]);
  // The dot grid behind the frame: pinned to the shot's top-left, so it pans and zooms with it.
  useDotGrid(canvasRef, canvasMode, viewport.view, {
    x: scene.beautify.state.padding + extents.left,
    y: scene.beautify.state.padding + extents.top,
  });
  const hasContentOutside =
    extents.left > 0 || extents.top > 0 || extents.right > 0 || extents.bottom > 0;
  // The composed frame in display px, to move the crop tool's 0–1 rect to and from the
  // export frame (world units). Both sides use display px, so only the ratios matter.
  const canvasGeom: CanvasGeom | null =
    canvasMode && metrics && metrics.w > 0 && metrics.h > 0
      ? { naturalW: metrics.w, naturalH: metrics.h, pad: scene.beautify.state.padding, extents }
      : null;
  // The exact pixel size Copy and Save produce (mock A1's label), from the export's own
  // computation, so the label cannot say a size the export does not have.
  const exportSize = useMemo(
    () =>
      canvasMode && metrics && metrics.w > 0 && metrics.naturalW > 0
        ? exportPixelSize(
            {
              beautify: scene.beautify.state,
              annotations: scene.annotations,
              crop: scene.crop,
              exportFrame: scene.exportFrame,
            },
            metrics.naturalW,
            metrics.naturalH,
            metrics.w,
            extentsNatural,
          )
        : null,
    [
      canvasMode,
      metrics,
      scene.beautify.state,
      scene.annotations,
      scene.crop,
      scene.exportFrame,
      extentsNatural,
    ],
  );
  const exportFrameCrop: CropRect | undefined =
    canvasGeom && scene.exportFrame
      ? intersectFrame(worldToFrame(scene.exportFrame, canvasGeom))
      : undefined;
  // A stored frame that now lies fully outside the content box (the content it framed was
  // removed) paints and exports nothing. The crop tool must still know it exists, or Reset
  // and Esc would do nothing while the frame stays and silently comes back with the content.
  // It reads as the full frame (what the export really uses) and Reset / Esc clear it.
  const frameHidden = canvasGeom != null && scene.exportFrame != null && !exportFrameCrop;
  // In canvas mode the Crop tool edits the export frame: the same overlay and Reset button,
  // fed a scene whose `crop` is the frame and whose `setCrop` writes the frame.
  const cropScene: EditorScene = canvasMode
    ? {
        ...scene,
        crop: exportFrameCrop ?? (frameHidden ? { x: 0, y: 0, w: 1, h: 1 } : undefined),
        setCrop: (crop) => {
          if (!canvasGeom) return;
          scene.setExportFrame(crop ? frameToWorld(crop, canvasGeom) : undefined);
        },
      }
    : scene;
  // Mock A5: the exact size an export of a window of the frame has (0–1 of the composed
  // frame), from the export's own computation, for the frame's label while it is dragged.
  const framePixelSize = (c: CropRect): { w: number; h: number } | null =>
    canvasGeom && metrics && metrics.naturalW > 0
      ? exportPixelSize(
          {
            beautify: scene.beautify.state,
            annotations: scene.annotations,
            crop: scene.crop,
            exportFrame: frameToWorld(c, canvasGeom),
          },
          metrics.naturalW,
          metrics.naturalH,
          metrics.w,
          extentsNatural,
        )
      : null;
  const shownZoom = canvasMode ? viewport.view.zoom : zoom;
  const zoomMin = canvasMode ? CANVAS_ZOOM.min : ZOOM_MIN;
  const zoomMax = canvasMode ? CANVAS_ZOOM.max : ZOOM_MAX;
  // Mock A6: which way the content went once most of it left the visible stage.
  const offContent = useOffContent(canvasRef, canvasMode && hasImage, [
    viewport.view,
    extents,
    metrics,
    scene.beautify.state.padding,
    scene.exportFrame,
  ]);

  // Images added to the canvas (NIW2-703). The bytes live in a ref: queued save and export jobs
  // read them when they RUN, and nothing renders from the bytes themselves. The display side is
  // `imageUrls`, assetId -> object URL, a new object only when an asset is added so the layer
  // can depend on it. An undone image keeps its asset (redo brings it back); a save sends only
  // what the scene still references.
  const assetsRef = useRef<CanvasAssets>(doc ? { ...doc.assets } : {});
  const [imageUrls, setImageUrls] = useState<Readonly<Record<string, string>>>({});
  const urlsRef = useRef(new Map<string, string>());
  const registerAsset = (assetId: string, png: ArrayBuffer): string => {
    const known = urlsRef.current.get(assetId);
    if (known) return known;
    const url = URL.createObjectURL(new Blob([png], { type: "image/png" }));
    urlsRef.current.set(assetId, url);
    return url;
  };
  useEffect(() => {
    if (!canvasMode) return;
    const urls = urlsRef.current;
    // Registered in the effect, not at render, so StrictMode's mount/unmount/mount pass
    // revokes and recreates them together instead of leaving the state holding dead URLs.
    for (const [assetId, png] of Object.entries(assetsRef.current)) registerAsset(assetId, png);
    setImageUrls(Object.fromEntries(urls));
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount
  }, [canvasMode]);

  // Composite the beautify frame + annotations and encode them as `format`: PNG is
  // what Copy and Save use, PDF what Export writes. Only ever invoked once
  // `imageReady` is true (see the guards below), which itself can only happen once
  // `image` has resolved, so the non-null assert is safe.
  const exportAs = async (format: ExportFormat, snap: Scene): Promise<ArrayBuffer> =>
    exportScene(format, {
      scene: snap,
      bytes: await image!.getBytes(),
      displayedW: imgRef.current?.clientWidth ?? 0,
      ...(canvasMode ? { canvas: true, assets: assetsRef.current } : {}),
    });

  /** The base image's pixel size: the decoded image first, then the sizes already known. */
  const basePixels = (): { width: number; height: number } => ({
    // A reopened document's base size comes before the source's, which is the flat export's.
    width: imgRef.current?.naturalWidth || doc?.pixelWidth || source.width || 0,
    height: imgRef.current?.naturalHeight || doc?.pixelHeight || source.height || 0,
  });

  // The image `addImage` just placed, where it placed it (mock E3).
  const [justAdded, setJustAdded] = useState<{
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  // The memory ends the moment the selection moves to anything else or the image leaves its
  // landing spot or size (a corner drag resizes it with x/y fixed), so the tag never comes back,
  // even if the image is dragged back there.
  // (An undone add leaves an id no annotation has: nothing shows.)
  const justAddedAnnotation = justAdded
    ? scene.annotations.find((a) => a.id === justAdded.id)
    : undefined;
  const justAddedMoved =
    justAddedAnnotation?.kind === "image" &&
    (justAddedAnnotation.x !== justAdded?.x ||
      justAddedAnnotation.y !== justAdded?.y ||
      justAddedAnnotation.w !== justAdded?.w ||
      justAddedAnnotation.h !== justAdded?.h);
  useEffect(() => {
    if (justAdded && (scene.selectedId !== justAdded.id || justAddedMoved)) setJustAdded(null);
  }, [justAdded, justAddedMoved, scene.selectedId]);
  const justAddedId =
    justAdded &&
    scene.selectedId === justAdded.id &&
    justAddedAnnotation &&
    justAddedAnnotation.kind === "image" &&
    justAddedAnnotation.x === justAdded.x &&
    justAddedAnnotation.y === justAdded.y &&
    justAddedAnnotation.w === justAdded.w &&
    justAddedAnnotation.h === justAdded.h
      ? justAdded.id
      : null;

  /**
   * Put a PNG on the canvas as an image annotation (NIW2-703): to the right of the content
   * box, top-aligned with the base, selected, with the select tool active so it can be moved.
   * Its tag says "just added" until it moves or the selection changes, and a toast says
   * where it went (mock E3, NIW2-715).
   * It goes through `addAnnotation`, so it is an undoable edit that marks the scene dirty.
   */
  const addImage = (png: ArrayBuffer, pixelWidth: number, pixelHeight: number): void => {
    // A capture or a Library read that answers after the editor closed adds nothing.
    if (!alive.current) return;
    const { width: naturalW, height: naturalH } = basePixels();
    if (naturalW <= 0 || naturalH <= 0 || pixelWidth <= 0 || pixelHeight <= 0) {
      // Usually a paste before the base has loaded (its size is not known yet): say so
      // rather than drop the image the user just pasted.
      showToast({ message: t("addImageError") });
      return;
    }
    // The same scale the live extents use; before the first measurement the displayed width
    // is unknown and 1 only affects the size of text bounds.
    const scale = metrics && metrics.w > 0 ? naturalW / metrics.w : 1;
    const { right } = contentExtents(scene.annotations, naturalW, naturalH, scale);
    const assetId = newImageAssetId();
    assetsRef.current = { ...assetsRef.current, [assetId]: png };
    const url = registerAsset(assetId, png);
    setImageUrls((prev) => ({ ...prev, [assetId]: url }));
    const annotation: ImageAnnotation = {
      id: nextAnnotationId().id,
      kind: "image",
      assetId,
      x: (naturalW + right + ADDED_IMAGE_GAP_PX) / naturalW,
      y: 0,
      w: pixelWidth / naturalW,
      h: pixelHeight / naturalH,
      pixelWidth,
      pixelHeight,
    };
    fitAfterAdd.current = true;
    scene.addAnnotation(annotation);
    scene.select(annotation.id);
    tools.setTool("select");
    setJustAdded({
      id: annotation.id,
      x: annotation.x,
      y: annotation.y,
      w: annotation.w,
      h: annotation.h,
    });
    showToast({ message: t("imageAddedRight"), tone: "success" });
  };
  // The paste listener below outlives a render: it calls the latest closure.
  const addImageRef = useRef(addImage);
  addImageRef.current = addImage;
  // What the Add image control gets: a capture or a Library read finishes after an await,
  // when the props it was rendered with may be stale (another image added meanwhile), so it
  // always calls the latest closure.
  const addImageLatest = useCallback(
    (png: ArrayBuffer, pixelWidth: number, pixelHeight: number): void =>
      addImageRef.current(png, pixelWidth, pixelHeight),
    [],
  );

  // Pasting an image adds it to the canvas (canvas mode only). Text fields keep their own
  // paste. Like the home pages, the paste event's image wins and main's clipboard reader
  // answers when the event carries none; a clipboard with no image does nothing.
  const pasting = useRef(false);
  useEffect(() => {
    if (!canvasMode) return;
    const onPaste = (e: ClipboardEvent): void => {
      if (isTextField(e.target)) return;
      // A modal (the Library picker, the unsaved-changes dialog) owns the keyboard: nothing
      // lands on the canvas behind it.
      if (document.querySelector('[aria-modal="true"]')) return;
      const file = imageFileFromPaste(e.clipboardData);
      e.preventDefault();
      if (pasting.current) return;
      pasting.current = true;
      void (async () => {
        try {
          const image = await (file ? decodeToPng(file) : readFromMain());
          if (image && alive.current) addImageRef.current(image.png, image.width, image.height);
        } catch (error) {
          reportError(t("addImageError"), error, { context: { phase: "paste-image" } });
        } finally {
          pasting.current = false;
        }
      })();
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads latest state through refs
  }, [canvasMode]);

  /**
   * Export the scene and put it on the clipboard. Reports its own failures; the
   * caller owns the "Copied" indicator, because the auto path shows a combined one.
   */
  const copyToClipboard = (): Promise<boolean> => {
    if (!imageReady) return Promise.resolve(false);
    return enqueue(async () => {
      if (!alive.current) return false;
      try {
        await window.electronAPI.copyImageToClipboard(await exportAs("png", latest.current.scene));
        return true;
      } catch (error) {
        // Without this the button just never flips to "Copied" and the rejection is
        // unhandled — the user has no idea the copy failed.
        reportError(t("copyError"), error, {
          context: { phase: "copy" },
          retry: () => {
            if (alive.current) void onCopy();
          },
        });
        return false;
      }
    });
  };

  const onCopy = async (): Promise<void> => {
    if (await copyToClipboard()) showFeedback({ kind: "copied" });
  };

  // The one-time notice before redactions become permanent (mock H4b). This editor saves as you
  // edit and every save bakes redactions into the stored asset, so the notice opens the first
  // time an unsaved redaction exists on a machine that has not acknowledged it. It is derived,
  // not scheduled: no unsaved redaction (none drawn, all undone, or all already locked in a
  // reopened document) means no notice. The edit autosave keeps running while it is open: the
  // in-memory image stays unredacted, so "Undo redaction" still works after a save.
  const [noticeSeen, setNoticeSeen] = useState(hasSeenRedactionNotice);
  const [noticeHidden, setNoticeHidden] = useState(false);
  const hasUnsavedRedaction =
    canvasMode && scene.annotations.some((a) => a.kind === "blur" && !a.locked);
  useEffect(() => {
    // "Undo redaction" closes it without acknowledging; the next first redaction opens it again.
    if (!hasUnsavedRedaction) setNoticeHidden(false);
  }, [hasUnsavedRedaction]);
  const noticeOpen = hasUnsavedRedaction && !noticeSeen && !noticeHidden;
  // Queued saves run later than the render that enqueued them: they read the live value.
  const noticeOpenRef = useRef(noticeOpen);
  noticeOpenRef.current = noticeOpen;
  const acknowledgeNotice = (): void => {
    markRedactionNoticeSeen();
    setNoticeSeen(true);
  };
  const undoLastRedaction = (): void => {
    const last = scene.annotations.findLast((a) => a.kind === "blur" && !a.locked);
    if (last) scene.removeAnnotation(last.id);
    setNoticeHidden(true);
  };

  const firstSave = useRef(new Map<string, number>());
  /**
   * The first save that baked this redaction: later autosaves of the session keep it.
   * A new stamp goes into `staged`, not `firstSave`: it only counts once the save succeeded.
   */
  const firstSaveAt = (id: string, staged: Map<string, number>): number => {
    const known = firstSave.current.get(id) ?? staged.get(id);
    if (known !== undefined) return known;
    const now = Date.now();
    staged.set(id, now);
    return now;
  };

  /**
   * The document and base asset a canvas-mode save stores beside the PNG (ADR 0053).
   *
   * The asset is the in-memory image with this session's redactions baked in; the document
   * marks every blur `locked` (see `buildCanvasDoc`). The in-memory image itself stays the
   * UNREDACTED bytes until the editor closes, so a redaction drawn this session can still
   * be moved, resized or deleted. After a reopen the stored asset no longer has those
   * pixels, so the locked redaction is fixed.
   *
   * Null when the image's pixel size is unknown (the document would be invalid): the save
   * then stores the flat PNG alone, and main drops any stale document.
   */
  const buildCanvasPayload = async (
    snap: Scene,
    staged: Map<string, number>,
  ): Promise<CanvasSavePayload | null> => {
    // The decoded image first; the known sizes cover an image that has not reported one.
    const { width: pixelWidth, height: pixelHeight } = basePixels();
    if (pixelWidth <= 0 || pixelHeight <= 0) return null;
    const baked = await bakeCanvasRedactions(
      await image!.getBytes(),
      assetsRef.current,
      snap.annotations,
    );
    const docJson = JSON.stringify(
      buildCanvasDoc(
        snap,
        { pixelWidth, pixelHeight },
        { lockedAt: (id) => firstSaveAt(id, staged) },
      ),
    );
    // The base, then each image asset the scene still references, once (one asset may sit on
    // the canvas twice). Main prunes whatever else the vault held for this shot.
    const assets: CanvasSavePayload["assets"] = [{ assetId: BASE_ASSET_ID, png: baked.base }];
    const sent = new Set<string>();
    for (const a of snap.annotations) {
      if (a.kind !== "image" || sent.has(a.assetId)) continue;
      const png = baked.assets[a.assetId];
      // Every image is added with its bytes, so this is a bug: fail the save visibly rather
      // than store a document whose reopen would fall back to the flat PNG.
      if (!png) throw new Error(`save: no bytes for image asset ${a.assetId}`);
      sent.add(a.assetId);
      assets.push({ assetId: a.assetId, png });
    }
    return { docJson, assets };
  };

  /**
   * The recognized words a canvas save writes to the text cache: every word the redactions
   * of this save do not cover, in base-image pixels. Null when recognition has not finished
   * with words (or the flag is off), so the save sends no `text` at all.
   */
  const buildTextPayload = (snap: Scene): TextCacheSavePayload | null => {
    const result = recognizedRef.current;
    if (!textEnabled || result.status !== "ready") return null;
    const words = wordsOutsideRects(
      result.words,
      redactionRectsInPixels(snap.annotations, naturalNow()),
    );
    return { assets: [{ assetId: BASE_ASSET_ID, words }] };
  };

  /** Returns the saved title, or null when the save failed (already reported). */
  const persist = (opts: {
    overwriteId?: string;
    title?: string;
    /** The auto path shows one combined indicator instead of this one. */
    silent?: boolean;
    /**
     * Whether the save counts as the user's work (the Editor home's Continue list).
     * Defaults to `!silent`; the edit autosave is silent but still the user's work.
     */
    manual?: boolean;
    /** The auto-save on open: the item it creates is the one Discard may delete. */
    autoOnOpen?: boolean;
    /** First Save of an unsaved shot: if an earlier queued save already created the item, overwrite it. */
    bindToSaved?: boolean;
  }): Promise<string | null> =>
    enqueue(async () => {
      if (!alive.current) return null;
      // An explicit save bakes the redactions in: it counts as having read the notice.
      if (!opts.silent && noticeOpenRef.current) acknowledgeNotice();
      const revision = sceneRevision.current;
      const snap = latest.current.scene;
      const draftAtStart = latest.current.draft;
      // Callers pass the saved id they saw; a rename queued before this save moved it.
      const overwriteId =
        opts.overwriteId !== undefined
          ? (savedIdRef.current ?? opts.overwriteId)
          : opts.bindToSaved
            ? (savedIdRef.current ?? undefined)
            : undefined;
      try {
        const png = await exportAs("png", snap);
        const stagedStamps = new Map<string, number>();
        const canvas = canvasMode ? await buildCanvasPayload(snap, stagedStamps) : null;
        const text = canvas ? buildTextPayload(snap) : null;
        const saved = await window.electronAPI.saveScreenshot(png, {
          // The live field, not only its committed value: Save must write what the
          // user sees even if the field has not blurred yet (e.g. a shortcut).
          title: opts.title ?? resolveCaptureTitle(draftAtStart, captureTitle.autoTitle),
          overwriteId,
          ...(overwriteId !== undefined ? { overwriteAssetId: savedAssetIdRef.current } : {}),
          // The auto-save on open is not the user's work; every other save is.
          manual: opts.manual ?? !opts.silent,
          // Flag off sends no `canvas` at all: the flat PNG stays the truth.
          ...(canvas ? { canvas } : {}),
          // Only a canvas save with finished recognition: main then rewrites the text cache
          // with these words. Without it main deletes the cache, which is right whenever the
          // words are not known (flag off, still pending, unavailable).
          ...(text ? { text } : {}),
        });
        // The save landed: its redaction stamps are now the first-save times.
        for (const [id, at] of stagedStamps) {
          if (!firstSave.current.has(id)) firstSave.current.set(id, at);
        }
        savedIdRef.current = saved.id;
        savedAssetIdRef.current = saved.assetId;
        setSavedId(saved.id);
        // Don't clobber a title typed while the save was running.
        if (latest.current.draft === draftAtStart) captureTitle.adopt(saved.title);
        // Clean only if no edit landed during the save; otherwise the edit is still
        // unsaved and the autosave / leave guard must see it.
        if (sceneRevision.current === revision) setDirty(false);
        if (opts.autoOnOpen) {
          autoSavedId.current = saved.id;
          setAutoSaved(true);
        } else if (!opts.silent) {
          // The user's own save is the keeper: Discard must not delete it, or the
          // auto-saved item it would now point at.
          autoSavedId.current = null;
          setAutoSaved(false);
          showFeedback({ kind: "saved", name: saved.title });
        }
        return saved.title;
      } catch (error) {
        // A swallowed save (vault on a disconnected drive, disk full, composite
        // failure) let the user close the editor believing the shot was saved.
        // Surface it with a retry so the work isn't silently lost.
        if (isAmbiguousIdentityError(error)) {
          // Two files claim this shot: main refused before writing. A retry would refuse again.
          notifyAmbiguousIdentity(tLibrary);
          return null;
        }
        if (isMaintenanceError(error)) {
          // "Check and fix files" is running (NIW2-561): nothing was written and nothing
          // was queued in main. The edits stay dirty; the latest save runs again when it
          // ends. Only a save the user asked for says so.
          refusedDuringMaintenance.current = opts;
          if (!opts.silent) showToast({ message: tLibrary("maintenanceRefused") });
          return null;
        }
        reportError(t("saveError"), error, {
          context: { phase: "save", overwrite: overwriteId !== undefined },
          retry: () => {
            if (alive.current) void persist(opts);
          },
        });
        return null;
      }
    });

  /**
   * Export a PDF to a path the user picks. Independent of the vault: it neither
   * binds the editor to a saved item nor clears `dirty` — a shared file is not a
   * library copy. A cancelled dialog is not an error and shows nothing.
   */
  const onExportPdf = (): Promise<void> => {
    if (!imageReady) return Promise.resolve();
    return enqueue(async () => {
      if (!alive.current) return;
      try {
        const written = await window.electronAPI.exportScreenshotFile(
          await exportAs("pdf", latest.current.scene),
          {
            suggestedName: resolveCaptureTitle(latest.current.draft, captureTitle.autoTitle),
            extension: "pdf",
          },
        );
        if (written) showFeedback({ kind: "exported", name: fileName(written.path) });
      } catch (error) {
        reportError(t("exportPdfError"), error, {
          context: { phase: "export", format: "pdf" },
          retry: () => {
            if (alive.current) void onExportPdf();
          },
        });
      }
    });
  };

  /**
   * Whatever the two preferences asked for, once, on open. Sequential on purpose:
   * both paths export the same scene through the queue (the second is served by
   * `exportScene`'s memo), and the combined indicator needs both outcomes. Copy
   * goes first — it is the one the user is waiting on to paste; the save
   * round-trips to disk.
   */
  const runAutoActions = async (actions: AutoActions): Promise<void> => {
    const copied = actions.copy ? await copyToClipboard() : false;
    const savedTitle = actions.save ? await persist({ silent: true, autoOnOpen: true }) : null;
    if (savedTitle && copied) showFeedback({ kind: "savedAndCopied", name: savedTitle });
    else if (savedTitle) showFeedback({ kind: "saved", name: savedTitle });
    else if (copied) showFeedback({ kind: "copied" });
  };

  // Auto modes act the moment the image can be exported, before any edit. A failed save
  // leaves the editor in manual behaviour (dirty, guarded) — `persist` already
  // reports with a retry.
  const autoActionsFired = useRef(false);
  useEffect(() => {
    const actions = autoActionsRef.current;
    if (!imageReady || autoActionsFired.current || !actions || savedId) return;
    if (!actions.save && !actions.copy) return;
    autoActionsFired.current = true;
    void runAutoActions(actions);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once, when the image is ready
  }, [imageReady]);

  // NIW2-561: retry the latest refused save once the files are fixed.
  const persistRef = useRef(persist);
  persistRef.current = persist;
  useEffect(
    () =>
      window.electronAPI.onLibraryMaintenanceEnded?.(() => {
        const opts = refusedDuringMaintenance.current;
        refusedDuringMaintenance.current = null;
        if (opts && alive.current) void persistRef.current(opts);
      }),
    [],
  );

  /**
   * Write the current edits over the vault item, quietly. Every capture is in the vault,
   * so an edit is never the only copy of anything: it is saved the way a document is,
   * not guarded behind a dialog. False when there was nothing to write or it failed.
   * A save or copy already running just delays it: the queue runs it afterwards.
   */
  const autosaveEdits = async (): Promise<boolean> => {
    if (!savedId || !imageReady) return false;
    return (await persist({ overwriteId: savedId, silent: true, manual: true })) !== null;
  };

  // Save the edits a moment after the last one, so closing the window loses at most that.
  useEffect(() => {
    if (!dirty || !savedId || !imageReady || discarding) return;
    const timer = setTimeout(() => void autosaveEdits(), AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the scene change re-arms it
  }, [
    dirty,
    savedId,
    imageReady,
    discarding,
    scene.beautify.state,
    scene.annotations,
    scene.crop,
    scene.exportFrame,
  ]);

  // Leaving a shot that is in the vault: save what is pending, then go. A failed save
  // stays here (`persist` reported it with a retry) instead of dropping the edits.
  useEffect(() => {
    if (blocker.state !== "blocked" || !savedId) return;
    void autosaveEdits().then((saved) => (saved ? blocker.proceed() : blocker.reset()));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per blocked navigation
  }, [blocker.state]);

  // Deletes only the item the auto-save on open created, never a save the user made.
  const onDiscardSaved = (): Promise<void> =>
    enqueue(async () => {
      const id = autoSavedId.current;
      if (!id) return;
      try {
        await window.electronAPI.deleteLocalRecording(id);
        setDiscarding(true);
      } catch (error) {
        reportError(t("saveError"), error, { context: { phase: "discard", id } });
      }
    });

  // First save just writes; a subsequent save (or a re-opened shot) asks whether to
  // overwrite the existing item or branch off a copy.
  const onSave = (): void => {
    if (!imageReady) return;
    if (savedId) setAskSave(true);
    else void persist({ bindToSaved: true });
  };
  const onOverwrite = (): void => {
    setAskSave(false);
    if (savedId) void persist({ overwriteId: savedId });
  };
  const onSaveCopy = (): void => {
    setAskSave(false);
    void persist({ title: `${captureTitle.title} (${t("copySuffix")})` });
  };

  // "savedAndCopied" lights both indicators at once — that combined state is exactly
  // what the two auto preferences produce together.
  const copied = feedback?.kind === "copied" || feedback?.kind === "savedAndCopied";
  const savedName =
    feedback?.kind === "saved" || feedback?.kind === "savedAndCopied" ? feedback.name : null;
  const exportedName = feedback?.kind === "exported" ? feedback.name : null;

  // Compact layout (mock B3): below 1000 px the toolbar folds and the right panel becomes a
  // sheet. Measured on the page element; the revision re-measures once the image has mounted it.
  const compact = useCompactEditor(pageRef, image !== null);
  const [panelOpen, setPanelOpen] = useState(false);
  const sheetOpen = compact && panelOpen;
  // The Colors panel is the side panel's second tab. In compact the panel is the sheet, and
  // the sheet opens when Colors does, so pressing Colors shows something.
  const colorsOpen = colors.open;
  const colorsShown = inspectEnabled && inspect.active && colorsOpen;
  const colorsInSheet = compact && colorsShown;
  useEffect(() => {
    if (colorsInSheet) setPanelOpen(true);
  }, [colorsInSheet]);
  // Colors lives only in the sheet in compact, so closing the sheet turns it off: otherwise its
  // button would read "on" with nothing visible, and the next press would only turn it off.
  const colorsSetOpen = colors.setOpen;
  const wasSheetOpen = useRef(false);
  useEffect(() => {
    if (wasSheetOpen.current && !sheetOpen && compact) colorsSetOpen(false);
    wasSheetOpen.current = sheetOpen;
  }, [sheetOpen, compact, colorsSetOpen]);
  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      // A field or a dialog keeps its own Esc.
      // A range slider or checkbox takes no text, so Esc on it still closes the sheet.
      const t = e.target;
      const keysOwnEsc =
        isEditingTarget(t) &&
        !(t instanceof HTMLInputElement && ["range", "checkbox", "radio"].includes(t.type));
      if (keysOwnEsc || document.querySelector('[aria-modal="true"]')) return;
      // An open toolbar menu takes this Esc; the sheet closes on the next one.
      if (document.querySelector('[role="menu"]')) return;
      // Capture phase + stop: the crop overlay also leaves the tool on Esc.
      e.stopPropagation();
      setPanelOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [sheetOpen]);

  // Colors' Group switch lives here: the panel unmounts when another tab opens.
  const [colorsGrouped, setColorsGrouped] = useState(true);
  const colorsPanel = (
    <ColorsPanel
      colors={colors}
      grouped={colorsGrouped}
      onGroupedChange={setColorsGrouped}
      format={inspect.format}
      reading={inspect.status === "decoding"}
      unreadable={inspect.status === "error"}
    />
  );

  // The side panel's tab (NIW2-723). It is the user's pick, and the page moves it: to Tool when
  // a tool is picked, something is selected or Inspect turns on, to Colors when its panel opens,
  // as the video editor's inspector follows its selection. It starts on Beautify: with the
  // Select tool and nothing selected the Tool tab has nothing to show yet.
  const [tab, setTab] = useState<PanelTab>("beautify");
  // Colors is only a tab while its panel is open (it reads Inspect's pixels).
  const panelTab: PanelTab = tab === "colors" && !colorsShown ? "beautify" : tab;
  // Colors reads Inspect's decoded pixels, so choosing it from Annotate turns Inspect on.
  // Tool leaves the Colors panel open behind it: its values follow the Inspect format, whose
  // control is in the Tool tab, so the format can be changed with the list still in play.
  // Beautify closes it.
  const selectPanelTab = (next: PanelTab): void => {
    if (next === "colors") {
      inspect.setActive(true);
      colors.setOpen(true);
    } else if (next === "beautify") colors.setOpen(false);
    setTab(next);
  };
  useEffect(() => {
    if (colorsShown) setTab("colors");
  }, [colorsShown]);
  // Inspect's controls are the Tool tab's content while it is on, so entering it shows them.
  // Leaving it to a tool with no options (Select) goes back to Beautify rather than to an empty
  // Tool tab, and any other tool shows its options.
  const wasInspecting = useRef(false);
  const inspectActive = inspect.active;
  const selectedId = scene.selectedId;
  useEffect(() => {
    if (inspectActive) {
      if (!colorsOpen) setTab("tool");
    } else if (wasInspecting.current) {
      setTab(tools.tool === "select" && selectedId === null ? "beautify" : "tool");
    }
    wasInspecting.current = inspectActive;
    // Only the Inspect on/off edge matters: the tool, selection and Colors are read as they stand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectActive]);
  // A selected annotation has options (colour, size, delete): show them where they live now.
  const selectedToolId = inspectActive ? null : selectedId;
  useEffect(() => {
    if (selectedToolId !== null) setTab("tool");
  }, [selectedToolId]);
  const beautifyPanel = (
    <BeautifyPanel beautify={scene.beautify} canvasMode={canvasMode} embedded />
  );
  const toolPanel = (
    <ToolPanel
      tools={tools}
      scene={cropScene}
      canvasMode={canvasMode}
      {...(textTool ? { textTool } : {})}
      inspect={inspectEnabled && inspect.active ? inspect : null}
      colors={colors}
      {...(canvasMode
        ? {
            exportFrame: {
              hasFrame: scene.exportFrame != null,
              onFit: () => {
                if (canvasGeom) scene.setExportFrame(contentBoxFrame(canvasGeom));
              },
              onRemove: () => scene.setExportFrame(undefined),
            },
          }
        : {})}
    />
  );
  const sidePanel = (
    <SidePanel
      tab={panelTab}
      onSelect={selectPanelTab}
      tabs={inspectEnabled ? ALL_PANEL_TABS : ALL_PANEL_TABS.filter((name) => name !== "colors")}
    >
      {panelTab === "colors" ? colorsPanel : panelTab === "tool" ? toolPanel : beautifyPanel}
    </SidePanel>
  );
  // The tag under the largest area of the highlighted color (mock F3).
  const locatedRgb = locatedColor(colors.analysis, colors.located);
  const locateLabel =
    colors.analysis && colors.overlay?.bounds && locatedRgb !== null
      ? t("inspectColorsTag", {
          color: formatColor(unpackRgb(locatedRgb), inspect.format),
          areas: colors.overlay.areas,
          share: formatShare(colors.overlay.matched, colors.analysis.counted),
        })
      : null;

  // Picking a tool, by click or by key, leaves Inspect, starts the tool clean and shows its
  // options in the Tool tab. Select has none, so it leaves the tab as it was.
  const afterPick = (tool: AnnotationTool): void => {
    scene.select(null);
    inspect.setActive(false);
    if (tool !== "select") setTab("tool");
  };
  const pickTool = (tool: AnnotationTool): void => {
    tools.setTool(tool);
    afterPick(tool);
  };
  // Leaving and re-entering the crop tool (NIW2-759). The crop is committed on every drag, so
  // leaving is only a tool change: the stage then shows the cropped part, and the chip, the
  // double-click and the X key bring the crop tool back with the same crop. Both go through
  // `pickTool`, like the toolbar and the X key, so re-entering shows the Tool tab with Done.
  const leaveCrop = (): void => pickTool("select");
  const enterCrop = (): void => pickTool("crop");
  // The Add image menu is open: the page owns it so the `M` key and "•••" can open it too.
  const [addOpen, setAddOpen] = useState(false);
  useToolShortcuts({
    onTool: pickTool,
    // Leave Inspect first, as picking a tool does, so the menu opens over the editing view.
    ...(canvasMode
      ? {
          onAddImage: () => {
            inspect.setActive(false);
            setAddOpen(true);
          },
        }
      : {}),
  });

  // The Add image control: a toolbar button, or (compact) only its menu, opened from "•••".
  const addImageControl = (showButton: boolean): React.JSX.Element => (
    <AddImageControl
      onAdd={addImageLatest}
      excludeId={savedId}
      excludeAssetId={savedAssetIdRef.current ?? null}
      open={addOpen}
      onOpenChange={setAddOpen}
      showButton={showButton}
    />
  );

  // `image` is null on the first render while the reader resolves — render nothing.
  // Moved here (past every hook) so the auto-save effect above stays unconditional.
  if (!image) return <></>;

  return (
    <div
      {...(fresh ? uiArea("editorCapture.page") : uiArea("editorImage.page"))}
      ref={pageRef}
      className={styles.editor}
    >
      {/* "IN · Work ▾" once the shot is saved in a workspace (ADR 0033). */}
      <ItemWorkspaceChip assetId={savedId ? (savedAssetIdRef.current ?? null) : null} />
      <div
        {...uiArea("editorImage.toolbar")}
        className={styles.toolbar}
        role="toolbar"
        aria-label={t("editorToolbar")}
        data-compact={compact}
      >
        {inspectEnabled && (
          <>
            <InspectToggle active={inspect.active} compact={compact} onSelect={inspect.setActive} />
            <span className={styles.divider} aria-hidden />
          </>
        )}
        <AnnotationToolbar
          tools={tools}
          onPick={afterPick}
          textTool={textEnabled}
          canvasMode={canvasMode}
          compact={compact}
          idle={inspect.active}
          addImage={canvasMode ? addImageControl(true) : undefined}
        />
        {compact ? (
          <>
            <MoreMenu
              canvasMode={canvasMode}
              textTool={textEnabled}
              onPick={pickTool}
              onAddImage={() => setAddOpen(true)}
              undo={{ onSelect: scene.undo, disabled: !scene.canUndo }}
              redo={{ onSelect: scene.redo, disabled: !scene.canRedo }}
              pdf={{ onSelect: () => void onExportPdf(), disabled: !imageReady }}
            />
            {canvasMode && addImageControl(false)}
          </>
        ) : (
          <>
            <span className={styles.divider} aria-hidden />
            <button
              type="button"
              className={styles.iconBtn}
              title={t("undo")}
              disabled={!scene.canUndo}
              onClick={scene.undo}
            >
              <Undo2 size={17} />
            </button>
            <button
              type="button"
              className={styles.iconBtn}
              title={t("redo")}
              disabled={!scene.canRedo}
              onClick={scene.redo}
            >
              <Redo2 size={17} />
            </button>
            <CaptureTitleInput title={captureTitle} />
          </>
        )}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondary}
            data-done={copied}
            disabled={!imageReady}
            aria-label={copied ? t("copied") : t("copy")}
            title={copied ? t("copiedTitle") : t("copyTitle")}
            onClick={onCopy}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            <span className={styles.label}>{copied ? t("copied") : t("copy")}</span>
          </button>
          <button
            type="button"
            className={styles.save}
            data-done={savedName !== null}
            disabled={!imageReady}
            aria-label={savedName ? t("saved") : t("save")}
            title={
              savedName
                ? feedback?.kind === "savedAndCopied"
                  ? t("savedAndCopiedTitle", { name: savedName })
                  : t("savedAsTitle", { name: savedName })
                : t("saveTitle")
            }
            onClick={onSave}
          >
            {savedName ? <Check size={16} /> : <Download size={16} />}
            <span className={styles.saveLabel}>{savedName ? t("saved") : t("save")}</span>
          </button>
          {!compact && (
            <button
              type="button"
              className={styles.secondary}
              data-done={exportedName !== null}
              disabled={!imageReady}
              title={
                exportedName ? t("exportedPdfTitle", { name: exportedName }) : t("exportPdfTitle")
              }
              onClick={() => void onExportPdf()}
            >
              {exportedName ? <Check size={16} /> : <FileText size={16} />}
              <span className={styles.label}>
                {exportedName ? t("exportedPdf") : t("exportPdf")}
              </span>
            </button>
          )}
          {autoSaved && (
            <button
              type="button"
              className={styles.secondary}
              aria-label={t("discardSaved")}
              title={t("discardSavedTitle")}
              onClick={() => void onDiscardSaved()}
            >
              <Trash2 size={16} />
              <span className={styles.label}>{t("discardSaved")}</span>
            </button>
          )}
          {compact && <PanelToggle open={sheetOpen} onToggle={() => setPanelOpen(!panelOpen)} />}
        </div>
      </div>
      <div className={styles.body}>
        <div {...uiArea("editorImage.canvas")} className={styles.canvasArea}>
          <div
            ref={canvasRef}
            className={styles.canvas}
            data-zoomed={shownZoom > 1}
            // The chrome drawn in the zoomed frame (the export box, selection frames) reads this
            // to stay one screen pixel / one font size at any zoom.
            style={
              canvasMode
                ? ({ "--canvas-zoom": viewport.view.zoom } as React.CSSProperties)
                : undefined
            }
            {...(inspectEnabled ? { "data-inspect": String(inspect.active) } : {})}
            // A click on the stage itself, outside the frame, leaves the crop tool (with a crop
            // set). Never one that ends a pan, nor one that began on the frame (its target).
            onClick={(e) => {
              // Read first so every click clears a finished pan, whatever else it does.
              const endsPan = viewport.consumePanClick();
              if (tools.tool !== "crop" || cropScene.crop == null) return;
              if (e.target !== e.currentTarget || e.button !== 0) return;
              if (canvasMode && (endsPan || viewport.panMode !== "idle")) return;
              leaveCrop();
            }}
            {...(canvasMode
              ? {
                  ...viewport.bindings,
                  ...uiArea("editorImage.canvasView"),
                  "data-canvas": "true",
                  "data-panned": String(viewport.view.panX !== 0 || viewport.view.panY !== 0),
                  "data-zoomed-out": String(shownZoom < 1),
                  "data-pan": viewport.panMode,
                  "data-export-frame": String(scene.exportFrame != null),
                  "data-has-content-outside": String(hasContentOutside),
                }
              : {})}
          >
            <BeautifiedFrame
              src={image.displayUrl}
              beautify={scene.beautify.state}
              crop={tools.tool === "crop" ? undefined : canvasMode ? exportFrameCrop : scene.crop}
              windowChip={<CropChip onEnter={enterCrop} zoom={shownZoom} />}
              onWindowDoubleClick={() => {
                if (tools.tool === "select" && !(inspectEnabled && inspect.active)) enterCrop();
              }}
              overlay={
                <>
                  <AnnotationLayer
                    scene={scene}
                    tools={tools}
                    src={image.displayUrl}
                    canvas={canvasMode}
                    canvasMode={canvasMode}
                    justAddedId={justAddedId}
                    {...(canvasMode
                      ? {
                          imageUrls,
                          onLive,
                          ...(metrics && metrics.naturalW > 0
                            ? { natural: { w: metrics.naturalW, h: metrics.naturalH } }
                            : {}),
                        }
                      : {})}
                    text={textLayer}
                  />
                  <TextShimmer
                    enabled={textEnabled}
                    loaded={image != null}
                    status={recognized.status}
                  />
                  {inspectEnabled && <LocateOverlay image={colors.overlay} label={locateLabel} />}
                </>
              }
              frameOverlay={
                tools.tool === "crop" ? (
                  <CropOverlay
                    scene={cropScene}
                    onLeave={leaveCrop}
                    chrome={
                      canvasMode
                        ? { zoom: viewport.view.zoom, pixelSize: framePixelSize }
                        : undefined
                    }
                  />
                ) : undefined
              }
              boxLayer={
                canvasMode && scene.exportFrame == null ? (
                  <ExportBox
                    size={exportSize}
                    filled={scene.beautify.state.bg === "none"}
                    labeled={
                      !inspect.active && tools.tool !== "blur" && tools.tool !== "selectText"
                    }
                  />
                ) : undefined
              }
              imgRef={imgRef}
              zoom={shownZoom}
              pan={canvasMode ? { x: viewport.view.panX, y: viewport.view.panY } : undefined}
              extents={canvasMode ? extents : undefined}
              onImageLoad={() => {
                setNatural(naturalNow());
                setImageReady(true);
              }}
            />
            {inspectEnabled && inspect.active && <InspectLayer inspect={inspect} />}
          </div>

          {inspectEnabled && inspect.active && (
            <InspectModePill copied={inspect.copied} readout={inspect.copiedText} />
          )}

          {/* Zoom pinned at the foot of the canvas — a familiar editor convention. */}
          <div className={styles.zoomFloat}>
            <button
              type="button"
              className={styles.zoomBtn}
              title={t("zoomOut")}
              disabled={shownZoom <= zoomMin}
              onClick={() => (canvasMode ? viewport.zoomStep(-1) : zoomBy(-ZOOM_STEP))}
            >
              <ZoomOut size={16} />
            </button>
            <button
              type="button"
              className={styles.zoomLabel}
              title={t("zoomReset")}
              disabled={canvasMode ? isIdentityView(viewport.view) : zoom === 1}
              onClick={() => (canvasMode ? viewport.reset() : setZoom(1))}
            >
              {Math.round(shownZoom * 100)}%
            </button>
            <button
              type="button"
              className={styles.zoomBtn}
              title={t("zoomIn")}
              disabled={shownZoom >= zoomMax}
              onClick={() => (canvasMode ? viewport.zoomStep(1) : zoomBy(ZOOM_STEP))}
            >
              <ZoomIn size={16} />
            </button>
            {canvasMode && (
              <>
                <span className={styles.zoomDivider} aria-hidden />
                <button
                  type="button"
                  className={styles.zoomFit}
                  data-notice={offContent != null}
                  title={t("zoomFit")}
                  aria-label={t("zoomFitLabel")}
                  onClick={() => viewport.fit()}
                >
                  <FitIcon size={16} />
                </button>
              </>
            )}
          </div>
          <ReopenNoticeSlot reopen={reopen} edited={dirty} />
          <TextNotice
            enabled={textEnabled}
            loaded={image != null}
            status={recognized.status}
            wide={canvasMode}
          />
          {canvasMode && offContent && (
            <OffContentNotice direction={offContent} onFit={() => viewport.fit()} />
          )}
          {noticeOpen && (
            <RedactionNotice onUndo={undoLastRedaction} onAcknowledge={acknowledgeNotice} />
          )}
        </div>
        {compact
          ? sheetOpen && (
              <>
                <div
                  className={styles.sheetScrim}
                  onClick={() => setPanelOpen(false)}
                  aria-hidden
                />
                <div className={styles.sheet}>{sidePanel}</div>
              </>
            )
          : sidePanel}
      </div>

      {savedName && (
        <div className={styles.savedToast} role="status">
          <span className={styles.savedToastIcon}>
            <Check size={14} strokeWidth={3} />
          </span>
          <span className={styles.savedToastText}>
            <span className={styles.savedToastTitle}>{t("savedToast")}</span>
            <span className={styles.savedToastName}>{savedName}</span>
          </span>
        </div>
      )}

      {askSave && (
        <SaveOptionsDialog
          title={captureTitle.title}
          onOverwrite={onOverwrite}
          onSaveCopy={onSaveCopy}
          onCancel={() => setAskSave(false)}
        />
      )}

      {blocker.state === "blocked" && !savedId && (
        <DiscardChangesDialog
          neverSaved={savedId === null}
          onDiscard={() => blocker.proceed()}
          onCancel={() => blocker.reset()}
        />
      )}
    </div>
  );
}
