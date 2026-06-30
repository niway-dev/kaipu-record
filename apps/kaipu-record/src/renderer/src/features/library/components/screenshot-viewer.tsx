import { ImageOff } from "lucide-react";
import { useState } from "react";
import styles from "./screenshot-viewer.module.css";

/** Saved-screenshot viewer for the library detail page — the image-kind counterpart
 *  of RecordingPlayer. Shows the stored PNG (served via kaipu-media://screenshot/id). */
export function ScreenshotViewer({ src }: { src?: string | null }): React.JSX.Element {
  const [failed, setFailed] = useState(false);

  return (
    <div className={styles.viewer}>
      {src && !failed ? (
        <img src={src} alt="" className={styles.image} onError={() => setFailed(true)} />
      ) : (
        <div className={styles.unavailable}>
          <ImageOff size={28} strokeWidth={1.5} />
          Image unavailable
        </div>
      )}
    </div>
  );
}
