import React, { useEffect, useRef, useState } from "react";
import { Navigate, useBlocker, useLocation, useNavigate } from "react-router-dom";
import { Check, Copy, Download, Redo2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { useImageSource, type ImageSource } from "@renderer/features/screenshots/image-source";
import {
  type AutoActions,
  autoActionsOnOpen,
} from "@renderer/features/screenshots/auto-capture-policy";
import { DiscardChangesDialog } from "@renderer/features/screenshots/discard-changes-dialog";
import { reportError } from "@renderer/features/analytics";
import { useAppSettings } from "@renderer/pages/settings/use-app-settings";
import {
  BeautifiedFrame,
  BeautifyPanel,
  CropOverlay,
  DEFAULT_BEAUTIFY,
  FLAT_BEAUTIFY,
} from "@renderer/features/screenshots/beautify";
import { SaveOptionsDialog } from "@renderer/features/screenshots/save-options-dialog";
import {
  AnnotationLayer,
  AnnotationOptions,
  AnnotationToolbar,
  compositeScene,
  useAnnotationTools,
  useEditorScene,
} from "@renderer/features/screenshots/annotations";
import { useTransientValue } from "@renderer/ui/use-transient-value";
import styles from "./screenshot-editor-page.module.css";
import { useWindowPreset } from "@renderer/shell/use-window-preset";

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;
/** How long the Copy/Save buttons stay in their "done" state. */
const FEEDBACK_MS = 2600;

/** The editor's transient success indicator. */
type Feedback =
  | { kind: "copied" }
  | { kind: "saved"; name: string }
  // Both auto actions fired on open. One indicator, not two: `feedback` holds a
  // single value on purpose, so the combined outcome needs its own kind.
  | { kind: "savedAndCopied"; name: string };

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
  return <ScreenshotEditor key={location.key} source={source} />;
}

function ScreenshotEditor({ source }: { source: ImageSource }): React.JSX.Element {
  const t = useTranslations("screenshots");
  const image = useImageSource(source);
  // A re-opened saved shot is already framed/flattened — start it unframed so the
  // editor doesn't beautify it twice; a fresh capture gets the default frame.
  const scene = useEditorScene(source.kind === "local" ? FLAT_BEAUTIFY : DEFAULT_BEAUTIFY);
  const tools = useAnnotationTools();
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  // One transient "last action" indicator — copied or saved-with-name — that
  // auto-clears; avoids the illegal "both shown" state two flags allowed.
  const [feedback, showFeedback] = useTransientValue<Feedback>(FEEDBACK_MS);
  // Export needs the displayed <img> size to scale beautify/annotations to the
  // shot's native (Retina) pixels — gate Copy/Save until the image has laid out.
  const [imageReady, setImageReady] = useState(false);
  // Guards against a double-click firing two exports/saves (the second Save of a
  // fresh shot would create a duplicate library entry).
  const busy = useRef(false);
  // The vault id this editor is bound to: set when re-opening a saved shot, and
  // after the first save. While set, Save asks overwrite-or-copy.
  const [savedId, setSavedId] = useState<string | null>(source.kind === "local" ? source.id : null);
  // The auto save/copy modes are read ONCE when the editor opens; a Settings change
  // while this capture is open neither retro-saves nor un-saves nor re-copies it.
  const { settings } = useAppSettings();
  const autoActionsRef = useRef<AutoActions | null>(null);
  if (autoActionsRef.current === null && settings) {
    autoActionsRef.current = autoActionsOnOpen(
      settings.screenshotSave,
      settings.screenshotCopy,
      source.kind,
    );
  }
  // True once THIS editor created the item on open — enables Discard.
  const [autoSaved, setAutoSaved] = useState(false);
  const navigate = useNavigate();
  const [askSave, setAskSave] = useState(false);
  const [baseTitle] = useState(
    () => source.title ?? `${t("screenshotPrefix")} — ${new Date().toLocaleString()}`,
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
  useEffect(() => {
    if (!sceneSettled.current) {
      sceneSettled.current = true;
      return;
    }
    setDirty(true);
  }, [scene.beautify.state, scene.annotations, scene.crop]);

  // Block in-app navigation (sidebar clicks, ⌘⌃V start-recording, ⌘⌃X new
  // capture — all go through the router) while there are unsaved changes.
  // Discard deletes the auto-saved item and leaves. The blocker reads `dirty` from the
  // render it was called in, so navigating in the same tick as `setDirty(false)` would
  // still be blocked after an edit; instead, flip `discarding`, let the blocker lift on
  // re-render, and navigate from the effect below.
  const [discarding, setDiscarding] = useState(false);
  const blocker = useBlocker(dirty && !discarding);
  useEffect(() => {
    if (discarding) navigate("/screenshots");
  }, [discarding, navigate]);

  // The editor needs more room than the rest of the app. The base preset comes
  // back from the shell when the user navigates out.
  useWindowPreset("screenshotEditor");

  // ⌘/Ctrl + wheel (and trackpad pinch, which arrives as ctrlKey wheel) zooms the
  // view. Non-passive so we can preventDefault Electron's own page zoom. Attaches
  // once the canvas mounts (image resolves) — keyed on a stable boolean, not the
  // `image` object (which is fresh each render), so it doesn't re-subscribe. Plain
  // scroll still pans.
  const hasImage = image != null;
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => clampZoom(z * Math.exp(-e.deltaY * 0.0015)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [hasImage]);

  const zoomBy = (delta: number): void => setZoom((z) => clampZoom(z + delta));

  // Composite the beautify frame + annotations to a PNG — what Copy and Save export.
  // Only ever invoked once `imageReady` is true (see the guards below), which itself
  // can only happen once `image` has resolved, so the non-null assert is safe.
  const exportPng = async (): Promise<ArrayBuffer> =>
    compositeScene(
      { beautify: scene.beautify.state, annotations: scene.annotations, crop: scene.crop },
      await image!.getBytes(),
      imgRef.current?.clientWidth ?? 0,
    );

  /**
   * Export the scene and put it on the clipboard. Reports its own failures; the
   * caller owns the "Copied" indicator, because the auto path shows a combined one.
   */
  const copyToClipboard = async (): Promise<boolean> => {
    if (busy.current || !imageReady) return false;
    busy.current = true;
    try {
      await window.electronAPI.copyImageToClipboard(await exportPng());
      return true;
    } catch (error) {
      // Without this the button just never flips to "Copied" and the rejection is
      // unhandled — the user has no idea the copy failed.
      reportError(t("copyError"), error, {
        context: { phase: "copy" },
        retry: () => void onCopy(),
      });
      return false;
    } finally {
      busy.current = false;
    }
  };

  const onCopy = async (): Promise<void> => {
    if (await copyToClipboard()) showFeedback({ kind: "copied" });
  };

  /** Returns the saved title, or null when the save failed (already reported). */
  const persist = async (opts: {
    overwriteId?: string;
    title?: string;
    /** The auto path shows one combined indicator instead of this one. */
    silent?: boolean;
  }): Promise<string | null> => {
    if (busy.current) return null;
    busy.current = true;
    try {
      const saved = await window.electronAPI.saveScreenshot(await exportPng(), {
        title: opts.title ?? baseTitle,
        overwriteId: opts.overwriteId,
      });
      setSavedId(saved.id);
      setDirty(false); // now safely in the vault — leaving no longer loses work
      if (!opts.silent) showFeedback({ kind: "saved", name: saved.title });
      return saved.title;
    } catch (error) {
      // A swallowed save (vault on a disconnected drive, disk full, composite
      // failure) let the user close the editor believing the shot was saved.
      // Surface it with a retry so the work isn't silently lost.
      reportError(t("saveError"), error, {
        context: { phase: "save", overwrite: opts.overwriteId !== undefined },
        retry: () => void persist(opts),
      });
      return null;
    } finally {
      busy.current = false;
    }
  };

  /**
   * Whatever the two preferences asked for, once, on open. Sequential on purpose:
   * both paths take the `busy` lock and composite the same scene, so running them
   * together would silently drop one. Copy goes first — it is the one the user is
   * waiting on to paste; the save round-trips to disk.
   */
  const runAutoActions = async (actions: AutoActions): Promise<void> => {
    const copied = actions.copy ? await copyToClipboard() : false;
    const savedTitle = actions.save ? await persist({ silent: true }) : null;
    if (savedTitle) setAutoSaved(true);
    if (savedTitle && copied) showFeedback({ kind: "savedAndCopied", name: savedTitle });
    else if (savedTitle) showFeedback({ kind: "saved", name: savedTitle });
    else if (copied) showFeedback({ kind: "copied" });
  };

  // Auto modes act the moment the image can be exported, before any edit. A failed
  // save leaves the editor in manual behaviour (dirty, guarded) — `persist` already
  // reports with a retry.
  const autoActionsFired = useRef(false);
  useEffect(() => {
    const actions = autoActionsRef.current;
    if (!imageReady || autoActionsFired.current || !actions || savedId) return;
    if (!actions.save && !actions.copy) return;
    autoActionsFired.current = true;
    void runAutoActions(actions);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once when the image is ready
  }, [imageReady]);

  const onDiscardSaved = async (): Promise<void> => {
    if (!savedId || busy.current) return;
    busy.current = true;
    try {
      await window.electronAPI.deleteLocalRecording(savedId);
      setDiscarding(true);
    } catch (error) {
      reportError(t("saveError"), error, { context: { phase: "discard", id: savedId } });
    } finally {
      busy.current = false;
    }
  };

  // First save just writes; a subsequent save (or a re-opened shot) asks whether to
  // overwrite the existing item or branch off a copy.
  const onSave = (): void => {
    if (!imageReady || busy.current) return;
    if (savedId) setAskSave(true);
    else void persist({});
  };
  const onOverwrite = (): void => {
    setAskSave(false);
    if (savedId) void persist({ overwriteId: savedId });
  };
  const onSaveCopy = (): void => {
    setAskSave(false);
    void persist({ title: `${baseTitle} (${t("copySuffix")})` });
  };

  // "savedAndCopied" lights both indicators at once — that combined state is exactly
  // what the two auto preferences produce together.
  const copied = feedback?.kind === "copied" || feedback?.kind === "savedAndCopied";
  const savedName =
    feedback?.kind === "saved" || feedback?.kind === "savedAndCopied" ? feedback.name : null;

  // `image` is null on the first render while the reader resolves — render nothing.
  // Moved here (past every hook) so the auto-save effect above stays unconditional.
  if (!image) return <></>;

  return (
    <div className={styles.editor}>
      <div className={styles.toolbar}>
        <AnnotationToolbar tools={tools} onPick={() => scene.select(null)} />
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.iconBtn}
            title={t("undo")}
            disabled={!scene.canUndo}
            onClick={scene.undo}
          >
            <Undo2 size={18} />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            title={t("redo")}
            disabled={!scene.canRedo}
            onClick={scene.redo}
          >
            <Redo2 size={18} />
          </button>
          <span className={styles.divider} />
          <button
            type="button"
            className={styles.secondary}
            data-done={copied}
            disabled={!imageReady}
            title={copied ? t("copiedTitle") : t("copyTitle")}
            onClick={onCopy}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? t("copied") : t("copy")}
          </button>
          <button
            type="button"
            className={styles.save}
            data-done={savedName !== null}
            disabled={!imageReady}
            title={
              savedName
                ? feedback?.kind === "savedAndCopied"
                  ? t("savedAndCopiedTitle", { name: savedName })
                  : t("savedAsTitle", { name: savedName })
                : t("saveTitle")
            }
            onClick={onSave}
          >
            {savedName ? <Check size={16} /> : <Download size={16} />}{" "}
            {savedName ? t("saved") : t("save")}
          </button>
          {autoSaved && savedId && (
            <button
              type="button"
              className={styles.secondary}
              title={t("discardSavedTitle")}
              onClick={() => void onDiscardSaved()}
            >
              {t("discardSaved")}
            </button>
          )}
        </div>
      </div>
      <div className={styles.body}>
        <div className={styles.canvasArea}>
          <div ref={canvasRef} className={styles.canvas} data-zoomed={zoom > 1}>
            <BeautifiedFrame
              src={image.displayUrl}
              beautify={scene.beautify.state}
              crop={tools.tool === "crop" ? undefined : scene.crop}
              overlay={<AnnotationLayer scene={scene} tools={tools} src={image.displayUrl} />}
              frameOverlay={tools.tool === "crop" ? <CropOverlay scene={scene} /> : undefined}
              imgRef={imgRef}
              zoom={zoom}
              onImageLoad={() => setImageReady(true)}
            />
          </div>

          {/* Floating per-tool options (Excalidraw-style), only when there's something to edit. */}
          <div className={styles.optionsFloat}>
            <AnnotationOptions tools={tools} scene={scene} />
          </div>

          {/* Zoom pinned at the foot of the canvas — a familiar editor convention. */}
          <div className={styles.zoomFloat}>
            <button
              type="button"
              className={styles.zoomBtn}
              title={t("zoomOut")}
              disabled={zoom <= ZOOM_MIN}
              onClick={() => zoomBy(-ZOOM_STEP)}
            >
              <ZoomOut size={16} />
            </button>
            <button
              type="button"
              className={styles.zoomLabel}
              title={t("zoomReset")}
              disabled={zoom === 1}
              onClick={() => setZoom(1)}
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              className={styles.zoomBtn}
              title={t("zoomIn")}
              disabled={zoom >= ZOOM_MAX}
              onClick={() => zoomBy(ZOOM_STEP)}
            >
              <ZoomIn size={16} />
            </button>
          </div>
        </div>
        <BeautifyPanel beautify={scene.beautify} />
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
          title={baseTitle}
          onOverwrite={onOverwrite}
          onSaveCopy={onSaveCopy}
          onCancel={() => setAskSave(false)}
        />
      )}

      {blocker.state === "blocked" && (
        <DiscardChangesDialog
          neverSaved={savedId === null}
          onDiscard={() => blocker.proceed()}
          onCancel={() => blocker.reset()}
        />
      )}
    </div>
  );
}
