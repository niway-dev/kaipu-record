import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useImageSource, type ImageSource } from "@renderer/features/screenshots/image-source";
import styles from "./screenshot-editor-page.module.css";

export function ScreenshotEditorPage(): React.JSX.Element {
  const navigate = useNavigate();
  const source = useLocation().state as ImageSource | null;
  const image = useImageSource(source);
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
        <span className={styles.title}>EDITANDO CAPTURA</span>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondary}
            onClick={async () => {
              await window.electronAPI.copyImageToClipboard(await image.getBytes());
            }}
          >
            Copiar
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
            {saved ? "Guardado" : "Guardar"}
          </button>
        </div>
      </div>
      <div className={styles.canvas}>
        <img src={image.displayUrl} alt="Captura" className={styles.shot} />
      </div>
    </div>
  );
}
