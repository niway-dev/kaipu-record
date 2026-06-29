import React from "react";
import styles from "./version-gate-overlay.module.css";

interface Props {
  message: string;
  downloadUrl: string;
}

/** Full-screen, non-dismissible block for an unsupported build. */
export function VersionGateOverlay({ message, downloadUrl }: Props): React.JSX.Element {
  return (
    <div className={styles.overlay} role="alertdialog" aria-modal="true">
      <div className={styles.card}>
        <h1 className={styles.title}>Actualización requerida</h1>
        <p className={styles.message}>{message}</p>
        <button className={styles.button} onClick={() => window.open(downloadUrl, "_blank")}>
          Actualizar
        </button>
      </div>
    </div>
  );
}
