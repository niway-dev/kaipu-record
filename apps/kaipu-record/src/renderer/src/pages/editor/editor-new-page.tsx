import React, { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardPaste } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { useOpenInEditor } from "@renderer/features/editor/open-in-editor";
import {
  decodeToPng,
  imageFileFromPaste,
  pastedImageSource,
  type PastedImage,
} from "@renderer/features/editor/paste-image";
import { reportError } from "@renderer/features/analytics";
import styles from "./editor-page.module.css";

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);

/**
 * `/editor/new` — an empty editor waiting for an image. ⌘V anywhere on the page
 * (the app menu's Paste) or the Paste button brings in whatever image is on the
 * clipboard, and the image editor opens on it. This page then leaves the history
 * (`replace`), so Back from the editor returns to where New was pressed.
 */
export function EditorNewPage(): React.JSX.Element {
  const t = useTranslations("editor");
  const { openCapture } = useOpenInEditor();
  const [empty, setEmpty] = useState(false);
  const busy = useRef(false);

  const open = useCallback(
    (image: PastedImage) => {
      const title = t("pastedTitle", { date: new Date().toLocaleString() });
      openCapture(pastedImageSource(image, title), { replace: true });
    },
    [openCapture, t],
  );

  /** Run one paste attempt; a second while the first decodes is ignored. */
  const attempt = useCallback(
    async (read: () => Promise<PastedImage | null>) => {
      if (busy.current) return;
      busy.current = true;
      try {
        const image = await read();
        if (image) open(image);
        else setEmpty(true);
      } catch (error) {
        reportError(t("pasteError"), error, { context: { phase: "paste" } });
      } finally {
        busy.current = false;
      }
    },
    [open, t],
  );

  // ⌘V: the paste event carries the image itself, including a JPEG or an image
  // file copied in Finder. When it carries none (some apps put only a native
  // image on the pasteboard), main's clipboard reader gets the last word.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      const file = imageFileFromPaste(e.clipboardData);
      e.preventDefault();
      void attempt(() => (file ? decodeToPng(file) : readFromMain()));
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [attempt]);

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t("newHeading")}</h1>
      <p className={styles.subtitle}>{t("newSubtitle")}</p>

      <div className={styles.pasteZone}>
        <ClipboardPaste size={32} strokeWidth={1.5} aria-hidden className={styles.pasteIcon} />
        <p className={styles.pasteTitle}>{t("pasteTitle")}</p>
        <p className={styles.pasteHint}>{t("pasteHint", { shortcut: isMac ? "⌘V" : "Ctrl+V" })}</p>
        <button
          type="button"
          className={styles.pasteButton}
          onClick={() => void attempt(readFromMain)}
        >
          <ClipboardPaste size={16} />
          {t("pasteButton")}
        </button>
        {empty && (
          <p role="alert" className={styles.pasteEmpty}>
            {t("pasteEmpty")}
          </p>
        )}
      </div>
    </div>
  );
}

/** The clipboard image as main reads it (Electron's native clipboard). */
async function readFromMain(): Promise<PastedImage | null> {
  return window.electronAPI.readClipboardImage();
}
