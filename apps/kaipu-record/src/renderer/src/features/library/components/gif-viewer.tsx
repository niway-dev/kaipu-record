import { ImageOff } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import { isWindowsHost } from "@renderer/features/shortcuts/host-platform";
import styles from "./screenshot-viewer.module.css";
import { mediaUrl } from "@renderer/lib/media-url";
import { uiArea } from "@renderer/lib/ui-area";

/**
 * GIF viewer for the library detail page (NIW2-217). An `<img>` plays and loops the file
 * natively. Dragging it starts a NATIVE file drag (main resolves the vault path), so the
 * GIF can be dropped into Slack, a GitHub comment or Finder as a real file.
 */
export function GifViewer({
  id,
  canDrag = true,
}: {
  id: string;
  /** False while the provider has offloaded the GIF itself: main refuses that drag, so none starts. */
  canDrag?: boolean;
}): React.JSX.Element {
  const t = useTranslations("library");
  const [failed, setFailed] = useState(false);

  return (
    <div {...uiArea("libraryDetail.preview")} className={styles.viewer}>
      {!failed ? (
        <img
          src={mediaUrl("recording", id)}
          alt=""
          className={styles.image}
          draggable={canDrag}
          title={canDrag ? t(isWindowsHost() ? "gifDragHintWindows" : "gifDragHint") : undefined}
          onDragStart={(event) => {
            event.preventDefault();
            if (canDrag) window.electronAPI.startFileDrag(id);
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
