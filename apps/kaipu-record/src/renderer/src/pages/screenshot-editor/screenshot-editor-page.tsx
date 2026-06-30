import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Copy, Download, Redo2, Undo2, ZoomIn } from "lucide-react";
import { useImageSource, type ImageSource } from "@renderer/features/screenshots/image-source";
import {
  BeautifiedFrame,
  BeautifyPanel,
  useBeautify,
} from "@renderer/features/screenshots/beautify";
import { AnnotationToolbar, useAnnotationTools } from "@renderer/features/screenshots/annotations";
import styles from "./screenshot-editor-page.module.css";

export function ScreenshotEditorPage(): React.JSX.Element {
  const navigate = useNavigate();
  const source = useLocation().state as ImageSource | null;
  const image = useImageSource(source);
  const beautify = useBeautify();
  const annotationTools = useAnnotationTools();
  const [saved, setSaved] = useState(false);

  // Guard: no source means we arrived without data — navigate back.
  if (!source) {
    navigate("/screenshots");
    return <></>;
  }

  // `image` is null on the first render while the reader resolves — render nothing.
  if (!image) return <></>;

  return (
    <div className={styles.editor}>
      <div className={styles.toolbar}>
        <AnnotationToolbar tools={annotationTools} />
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.iconBtn}
            title="Atrás"
            disabled={!beautify.canUndo}
            onClick={beautify.undo}
          >
            <Undo2 size={18} />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            title="Adelante"
            disabled={!beautify.canRedo}
            onClick={beautify.redo}
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
              await window.electronAPI.copyImageToClipboard(await image.getBytes());
            }}
          >
            <Copy size={16} /> Copiar
          </button>
          <button
            type="button"
            className={styles.save}
            onClick={async () => {
              await window.electronAPI.saveScreenshot(await image.getBytes(), {
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
          <BeautifiedFrame src={image.displayUrl} beautify={beautify.state} />
        </div>
        <BeautifyPanel beautify={beautify} />
      </div>
    </div>
  );
}
