import React, { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import styles from "./screenshot-editor-page.module.css";

interface ShotState {
  png: ArrayBuffer;
  width: number;
  height: number;
}

export function ScreenshotEditorPage(): React.JSX.Element {
  const navigate = useNavigate();
  const shot = useLocation().state as ShotState | null;
  const [saved, setSaved] = useState(false);

  const url = useMemo(
    () => (shot ? URL.createObjectURL(new Blob([shot.png], { type: "image/png" })) : null),
    [shot],
  );

  if (!shot || !url) {
    navigate("/screenshots");
    return <></>;
  }

  return (
    <div className={styles.editor}>
      <div className={styles.toolbar}>
        <span className={styles.title}>EDITANDO CAPTURA</span>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => void window.electronAPI.copyImageToClipboard(shot.png)}
          >
            Copiar
          </button>
          <button
            type="button"
            className={styles.save}
            onClick={async () => {
              await window.electronAPI.saveScreenshot(shot.png, { title: "Captura" });
              setSaved(true);
            }}
          >
            {saved ? "Guardado" : "Guardar"}
          </button>
        </div>
      </div>
      <div className={styles.canvas}>
        <img src={url} alt="Captura" className={styles.shot} />
      </div>
    </div>
  );
}
