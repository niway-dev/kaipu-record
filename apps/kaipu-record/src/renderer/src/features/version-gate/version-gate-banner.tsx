import React from "react";
import styles from "./version-gate-banner.module.css";

interface Props {
  message: string;
  downloadUrl: string;
}

/** Slim dismissible nudge for an outdated-but-usable build. */
export function VersionGateBanner({ message, downloadUrl }: Props): React.JSX.Element | null {
  const [dismissed, setDismissed] = React.useState(false);
  if (dismissed) return null;
  return (
    <div className={styles.banner}>
      <span className={styles.message}>{message}</span>
      <button className={styles.action} onClick={() => window.open(downloadUrl, "_blank")}>
        Actualizar
      </button>
      <button className={styles.close} aria-label="Cerrar" onClick={() => setDismissed(true)}>
        ×
      </button>
    </div>
  );
}
