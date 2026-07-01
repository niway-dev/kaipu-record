import React, { useEffect, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Check, Copy, Download, Redo2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { useImageSource, type ImageSource } from "@renderer/features/screenshots/image-source";
import {
  BeautifiedFrame,
  BeautifyPanel,
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

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;
/** How long the Copy/Save buttons stay in their "done" state. */
const FEEDBACK_MS = 2600;

/** The editor's transient success indicator. */
type Feedback = { kind: "copied" } | { kind: "saved"; name: string };

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
  const [askSave, setAskSave] = useState(false);
  const [baseTitle] = useState(() => source.title ?? `Screenshot — ${new Date().toLocaleString()}`);

  // The editor needs more room than the rest of the app — ask main to grow the
  // window (and raise its minimum) while we're here, and restore it on the way out.
  useEffect(() => {
    window.electronAPI.setEditorWindowMode(true);
    return () => window.electronAPI.setEditorWindowMode(false);
  }, []);

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

  // `image` is null on the first render while the reader resolves — render nothing.
  if (!image) return <></>;

  // Composite the beautify frame + annotations to a PNG — what Copy and Save export.
  const exportPng = async (): Promise<ArrayBuffer> =>
    compositeScene(
      { beautify: scene.beautify.state, annotations: scene.annotations },
      await image.getBytes(),
      imgRef.current?.clientWidth ?? 0,
    );

  const onCopy = async (): Promise<void> => {
    if (busy.current || !imageReady) return;
    busy.current = true;
    try {
      await window.electronAPI.copyImageToClipboard(await exportPng());
      showFeedback({ kind: "copied" });
    } finally {
      busy.current = false;
    }
  };

  const persist = async (opts: { overwriteId?: string; title?: string }): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    try {
      const saved = await window.electronAPI.saveScreenshot(await exportPng(), {
        title: opts.title ?? baseTitle,
        overwriteId: opts.overwriteId,
      });
      setSavedId(saved.id);
      showFeedback({ kind: "saved", name: saved.title });
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
    void persist({ title: `${baseTitle} (copy)` });
  };

  const copied = feedback?.kind === "copied";
  const savedName = feedback?.kind === "saved" ? feedback.name : null;

  return (
    <div className={styles.editor}>
      <div className={styles.toolbar}>
        <AnnotationToolbar tools={tools} onPick={() => scene.select(null)} />
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.iconBtn}
            title="Undo"
            disabled={!scene.canUndo}
            onClick={scene.undo}
          >
            <Undo2 size={18} />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            title="Redo"
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
            title={copied ? "Copied to clipboard" : "Copy to clipboard"}
            onClick={onCopy}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            className={styles.save}
            data-done={savedName !== null}
            disabled={!imageReady}
            title={savedName ? `Saved as “${savedName}”` : "Save to your library"}
            onClick={onSave}
          >
            {savedName ? <Check size={16} /> : <Download size={16} />}{" "}
            {savedName ? "Saved" : "Save"}
          </button>
        </div>
      </div>
      <div className={styles.body}>
        <div className={styles.canvasArea}>
          <div ref={canvasRef} className={styles.canvas} data-zoomed={zoom > 1}>
            <BeautifiedFrame
              src={image.displayUrl}
              beautify={scene.beautify.state}
              overlay={<AnnotationLayer scene={scene} tools={tools} src={image.displayUrl} />}
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
              title="Alejar"
              disabled={zoom <= ZOOM_MIN}
              onClick={() => zoomBy(-ZOOM_STEP)}
            >
              <ZoomOut size={16} />
            </button>
            <button
              type="button"
              className={styles.zoomLabel}
              title="Restablecer zoom"
              disabled={zoom === 1}
              onClick={() => setZoom(1)}
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              className={styles.zoomBtn}
              title="Acercar"
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
            <span className={styles.savedToastTitle}>Saved to your library</span>
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
    </div>
  );
}
