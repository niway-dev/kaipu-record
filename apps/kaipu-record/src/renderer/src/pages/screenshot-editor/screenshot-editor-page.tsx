import React, { useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Copy, Download, Redo2, Undo2, ZoomIn } from "lucide-react";
import { useImageSource, type ImageSource } from "@renderer/features/screenshots/image-source";
import { BeautifiedFrame, BeautifyPanel } from "@renderer/features/screenshots/beautify";
import {
  AnnotationLayer,
  AnnotationToolbar,
  compositeScene,
  useAnnotationTools,
  useEditorScene,
} from "@renderer/features/screenshots/annotations";
import styles from "./screenshot-editor-page.module.css";

export function ScreenshotEditorPage(): React.JSX.Element {
  const navigate = useNavigate();
  const source = useLocation().state as ImageSource | null;
  const image = useImageSource(source);
  const scene = useEditorScene();
  const tools = useAnnotationTools();
  const imgRef = useRef<HTMLImageElement>(null);
  const [saved, setSaved] = useState(false);

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
      source.width,
      source.height,
      imgRef.current?.clientWidth ?? source.width,
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
          <button type="button" className={styles.iconBtn} title="Zoom (próximamente)" disabled>
            <ZoomIn size={18} />
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
        <div className={styles.canvas}>
          <BeautifiedFrame
            src={image.displayUrl}
            beautify={scene.beautify.state}
            overlay={<AnnotationLayer scene={scene} tools={tools} />}
            imgRef={imgRef}
          />
        </div>
        <BeautifyPanel beautify={scene.beautify} />
      </div>
    </div>
  );
}
