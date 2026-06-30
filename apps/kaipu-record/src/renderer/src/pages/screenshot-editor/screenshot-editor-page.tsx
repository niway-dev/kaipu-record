import React, { useEffect, useState } from "react";
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
  const [url, setUrl] = useState<string | null>(null);

  // Create an object URL for the PNG and revoke it on cleanup to avoid memory leaks.
  useEffect(() => {
    if (!shot) return;
    const objectUrl = URL.createObjectURL(new Blob([shot.png], { type: "image/png" }));
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [shot]);

  // Guard: no shot state means we arrived without data — navigate back.
  if (!shot) {
    navigate("/screenshots");
    return <></>;
  }

  // url is null on the first render while the effect runs; render nothing until ready.
  if (!url) return <></>;

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
