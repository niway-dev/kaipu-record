import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Copy, Download, Redo2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
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

export function ScreenshotEditorPage(): React.JSX.Element {
  const navigate = useNavigate();
  const source = useLocation().state as ImageSource | null;
  const image = useImageSource(source);
  const scene = useEditorScene();
  const tools = useAnnotationTools();
  const imgRef = useRef<HTMLImageElement>(null);
  const [saved, setSaved] = useState(false);
  const [zoom, setZoom] = useState(1);

  // The editor needs more room than the rest of the app — ask main to grow the
  // window (and raise its minimum) while we're here, and restore it on the way out.
  useEffect(() => {
    window.electronAPI.setEditorWindowMode(true);
    return () => window.electronAPI.setEditorWindowMode(false);
  }, []);

  const zoomBy = (delta: number): void =>
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z + delta) * 100) / 100)));

  // Guard: no source means we arrived without data — navigate back.
  if (!source) {
    navigate("/screenshots");
    return <></>;
  }

  // `image` is null on the first render while the reader resolves — render nothing.
  if (!image) return <></>;

  // Composite the beautify frame + annotations to a PNG — what Copy and Save export.
  const exportPng = async (): Promise<ArrayBuffer> =>
    compositeScene(
      { beautify: scene.beautify.state, annotations: scene.annotations },
      await image.getBytes(),
      imgRef.current?.clientWidth ?? 0,
    );

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
            onClick={async () => {
              await window.electronAPI.copyImageToClipboard(await exportPng());
            }}
          >
            <Copy size={16} /> Copiar
          </button>
          <button
            type="button"
            className={styles.save}
            onClick={async () => {
              await window.electronAPI.saveScreenshot(await exportPng(), {
                title: source.title ?? "Captura",
              });
              setSaved(true);
            }}
          >
            <Download size={16} /> {saved ? "Guardado" : "Guardar"}
          </button>
        </div>
      </div>
      <div className={styles.body}>
        <div className={styles.canvasArea}>
          <div className={styles.canvas}>
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
