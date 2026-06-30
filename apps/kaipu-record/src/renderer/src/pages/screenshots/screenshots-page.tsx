import React from "react";
import { Camera } from "lucide-react";
import { useScreenshotCapture } from "@renderer/features/screenshots/use-screenshot-capture";
import styles from "./screenshots-page.module.css";

export function ScreenshotsPage(): React.JSX.Element {
  const { capture } = useScreenshotCapture();
  return (
    <div className={styles.page}>
      <p className={styles.overline}>CAPTURAS</p>
      <h1 className={styles.title}>Capturá y documentá</h1>
      <p className={styles.subtitle}>
        Tomá una captura, marcá lo importante con cajas, flechas y texto, y compartila. Todo local,
        sin cuentas.
      </p>
      <div className={styles.card}>
        <button className={styles.capture} onClick={() => void capture()} type="button">
          <Camera size={18} /> Capturar pantalla
        </button>
        <p className={styles.hint}>Seleccioná un área de la pantalla para empezar.</p>
        <span className={styles.shortcut}>Atajo global ⌘⌃4</span>
      </div>
    </div>
  );
}
