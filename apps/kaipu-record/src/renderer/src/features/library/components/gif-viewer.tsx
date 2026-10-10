import { ImageOff } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import styles from "./screenshot-viewer.module.css";

/**
 * GIF viewer for the library detail page (NIW2-217). An `<img>` plays and loops the file
 * natively. Dragging it starts a NATIVE file drag (main resolves the vault path), so the
 * GIF can be dropped into Slack, a GitHub comment or Finder as a real file.
 */
export function GifViewer({ id }: { id: string }): React.JSX.Element {
  const t = useTranslations("library");
  const [failed, setFailed] = useState(false);

  return (
    <div className={styles.viewer}>
      {!failed ? (
        <img
          src={`kaipu-media://recording/${encodeURIComponent(id)}`}
          alt=""
          className={styles.image}
          draggable
          title={t("gifDragHint")}
          onDragStart={(event) => {
            event.preventDefault();
            window.electronAPI.startFileDrag(id);
          }}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className={styles.unavailable}>
          <ImageOff size={28} strokeWidth={1.5} />
          {t("gifUnavailable")}
        </div>
      )}
    </div>
  );
}
