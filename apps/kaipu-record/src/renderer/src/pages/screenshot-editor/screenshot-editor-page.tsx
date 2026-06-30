import React, { useEffect, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Check, Copy, Download, Redo2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { useImageSource, type ImageSource } from "@renderer/features/screenshots/image-source";
import { BeautifiedFrame, BeautifyPanel } from "@renderer/features/screenshots/beautify";
import {
  AnnotationLayer,
  AnnotationOptions,
  AnnotationToolbar,
  compositeScene,
  useAnnotationTools,
  useEditorScene,
} from "@renderer/features/screenshots/annotations";
import styles from "./screenshot-editor-page.module.css";

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;
/** How long the Copy/Save buttons stay in their "done" state. */
const FEEDBACK_MS = 2600;

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
  const scene = useEditorScene();
  const tools = useAnnotationTools();
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [copied, setCopied] = useState(false);
  const [savedName, setSavedName] = useState<string | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The editor needs more room than the rest of the app — ask main to grow the
  // window (and raise its minimum) while we're here, and restore it on the way out.
  useEffect(() => {
    window.electronAPI.setEditorWindowMode(true);
    return () => window.electronAPI.setEditorWindowMode(false);
  }, []);

  // ⌘/Ctrl + wheel (and trackpad pinch, which arrives as ctrlKey wheel) zooms the
  // view. Non-passive so we can preventDefault Electron's own page zoom. Re-runs
  // when the canvas mounts (image resolves). Plain scroll still pans.
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
  }, [image]);

  useEffect(
    () => () => {
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    },
    [],
  );

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

  const flashFeedback = (apply: () => void): void => {
    apply();
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => {
      setCopied(false);
      setSavedName(null);
    }, FEEDBACK_MS);
  };

  const onCopy = async (): Promise<void> => {
    await window.electronAPI.copyImageToClipboard(await exportPng());
    flashFeedback(() => {
      setSavedName(null);
      setCopied(true);
    });
  };

  const onSave = async (): Promise<void> => {
    const saved = await window.electronAPI.saveScreenshot(await exportPng(), {
      title: source.title ?? "Captura",
    });
    flashFeedback(() => {
      setCopied(false);
      setSavedName(saved.title);
    });
  };

  return (
    <div className={styles.editor}>
      <div className={styles.toolbar}>
        <AnnotationToolbar tools={tools} />
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.iconBtn}
            title="Atrás"
            disabled={!scene.canUndo}
            onClick={scene.undo}
          >
            <Undo2 size={18} />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            title="Adelante"
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
            title={copied ? "Imagen copiada al portapapeles" : "Copiar al portapapeles"}
            onClick={onCopy}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copiado" : "Copiar"}
          </button>
          <div className={styles.saveWrap}>
            {savedName && (
              <span className={styles.savedToast} role="status">
                Guardado como “{savedName}”
              </span>
            )}
            <button
              type="button"
              className={styles.save}
              data-done={savedName !== null}
              title={savedName ? `Guardado como “${savedName}”` : "Guardar en la librería"}
              onClick={onSave}
            >
              {savedName ? <Check size={16} /> : <Download size={16} />}{" "}
              {savedName ? "Guardado" : "Guardar"}
            </button>
          </div>
        </div>
      </div>
      <div className={styles.body}>
        <div className={styles.canvasArea}>
          <div ref={canvasRef} className={styles.canvas} data-zoomed={zoom > 1}>
            <BeautifiedFrame
              src={image.displayUrl}
              beautify={scene.beautify.state}
              overlay={<AnnotationLayer scene={scene} tools={tools} />}
              imgRef={imgRef}
              zoom={zoom}
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
    </div>
  );
}
