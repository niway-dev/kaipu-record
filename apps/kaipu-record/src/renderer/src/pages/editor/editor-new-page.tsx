import React from "react";
import { ClipboardPaste } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { PASTE_SHORTCUT, usePasteToEditor } from "@renderer/features/editor/use-paste-to-editor";
import styles from "./editor-page.module.css";

/**
 * `/editor/new` — an empty editor waiting for an image. ⌘V anywhere on the page
 * (the app menu's Paste) or the Paste button brings in whatever image is on the
 * clipboard, and the image editor opens on it. This page then leaves the history
 * (`replace`), so Back from the editor returns to where New was pressed.
 */
export function EditorNewPage(): React.JSX.Element {
  const t = useTranslations("editor");
  const { pasteFromClipboard, empty } = usePasteToEditor({ replace: true });

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t("newHeading")}</h1>
      <p className={styles.subtitle}>{t("newSubtitle")}</p>

      <div className={styles.pasteZone}>
        <ClipboardPaste size={32} strokeWidth={1.5} aria-hidden className={styles.pasteIcon} />
        <p className={styles.pasteTitle}>{t("pasteTitle")}</p>
        <p className={styles.pasteHint}>{t("pasteHint", { shortcut: PASTE_SHORTCUT })}</p>
        <button
          type="button"
          className={styles.pasteButton}
          onClick={() => void pasteFromClipboard()}
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
