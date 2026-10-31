import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import { reportError } from "@renderer/features/analytics";
import { defaultCaptureName } from "@shared/default-capture-name";
import { formatAccelerator } from "@renderer/features/shortcuts/keyboard-accelerator";
import { useOpenInEditor } from "./open-in-editor";
import {
  decodeToPng,
  imageFileFromPaste,
  pastedImageSource,
  type PastedImage,
} from "./paste-image";

/** The paste chord for the host, from the preload bridge: "⌘V" on macOS, "Ctrl+V" on Windows. */
export function pasteShortcutLabel(): string {
  return formatAccelerator("CommandOrControl+V");
}

export interface PasteToEditor {
  /** Read the clipboard through main and open the image editor on its image. */
  pasteFromClipboard(): Promise<void>;
  /** The last attempt found no image on the clipboard. */
  empty: boolean;
}

/**
 * ⌘V (and a Paste button) into the image editor, for the pages that start an
 * image from the clipboard: the Editor home and New image.
 *
 * ⌘V reads the paste event first: it carries the image itself, including a JPEG
 * or an image file copied in Finder. When it carries none (some apps put only a
 * native image on the pasteboard), main's clipboard reader gets the last word.
 * A paste inside a text field is left alone.
 */
export function usePasteToEditor(options: { replace?: boolean } = {}): PasteToEditor {
  const t = useTranslations("editor");
  const { openCapture } = useOpenInEditor();
  const [empty, setEmpty] = useState(false);
  const busy = useRef(false);
  const replace = options.replace ?? false;

  /** Run one paste attempt; a second while the first decodes is ignored. */
  const attempt = useCallback(
    async (read: () => Promise<PastedImage | null>) => {
      if (busy.current) return;
      busy.current = true;
      try {
        const image = await read();
        if (!image) {
          setEmpty(true);
          return;
        }
        // A pasted image is a screenshot to the library: same default name (ADR 0035).
        openCapture(pastedImageSource(image, defaultCaptureName("screenshot")), { replace });
      } catch (error) {
        reportError(t("pasteError"), error, { context: { phase: "paste" } });
      } finally {
        busy.current = false;
      }
    },
    [openCapture, replace, t],
  );

  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      if (isTextField(e.target)) return;
      const file = imageFileFromPaste(e.clipboardData);
      e.preventDefault();
      void attempt(() => (file ? decodeToPng(file) : readFromMain()));
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [attempt]);

  const pasteFromClipboard = useCallback(() => attempt(readFromMain), [attempt]);
  return { pasteFromClipboard, empty };
}

function isTextField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA")
  );
}

/** The clipboard image as main reads it (Electron's native clipboard). */
async function readFromMain(): Promise<PastedImage | null> {
  return window.electronAPI.readClipboardImage();
}
