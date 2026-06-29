import React from "react";
import styles from "./update-banner.module.css";

interface Props {
  version: string;
}

/** Slim dismissible banner shown when an update is downloaded and ready to apply. */
export function UpdateBanner({ version }: Props): React.JSX.Element | null {
  const [dismissed, setDismissed] = React.useState(false);
  if (dismissed) return null;
  return (
    <div className={styles.banner}>
      <span className={styles.message}>Hay una versión nueva lista 🎉 (v{version}). Reiniciá para aplicarla.</span>
      <button className={styles.action} onClick={() => window.electronAPI.installUpdate()}>
        Reiniciar
      </button>
      <button className={styles.close} aria-label="Cerrar" onClick={() => setDismissed(true)}>
        ×
      </button>
    </div>
  );
}
