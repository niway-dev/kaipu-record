import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { uiArea } from "@renderer/lib/ui-area";
import type { TranscriptExportFormat } from "./subtitles";
import styles from "./transcript-export-menu.module.css";

const FORMATS: readonly { format: TranscriptExportFormat; label: string }[] = [
  { format: "srt", label: "transcriptExportSrt" },
  { format: "vtt", label: "transcriptExportVtt" },
  { format: "txt", label: "transcriptExportTxt" },
];

export interface TranscriptExportMenuProps {
  /** `false`: the edited video has no spoken words; the button is disabled and says why. */
  hasWords: boolean;
  onExport(format: TranscriptExportFormat): void;
}

/**
 * The Transcript panel's Export control (NIW2-818 M3): a button that opens a three-item menu,
 * one per file format. Keyboard: Enter, Space or ArrowDown on the button open it with the first
 * item focused; arrows, Home and End move; Enter or Space picks; Escape closes and returns focus
 * to the button; Tab closes; a pointer-down anywhere else closes. The menu is portalled to the
 * body with fixed coordinates, like the Tracks popover, so the panel's overflow cannot clip it.
 */
export function TranscriptExportMenu({
  hasWords,
  onExport,
}: TranscriptExportMenuProps): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  // The menu goes away with the last spoken word; it must not reopen by itself when words return.
  useEffect(() => {
    if (!hasWords) setOpen(false);
  }, [hasWords]);
  const reason = hasWords ? undefined : t("transcriptExportEmpty");
  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("transcriptExportMenuLabel")}
        title={reason ?? t("transcriptExportMenuLabel")}
        disabled={!hasWords}
        data-testid="transcript-export"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          // The editor's window handler turns Space into play/pause and prevents the default,
          // which would also stop the button's own Space activation: keep Space on the button.
          if (event.key === " ") event.stopPropagation();
          else if (event.key === "ArrowDown") {
            event.preventDefault();
            event.stopPropagation();
            setOpen(true);
          }
        }}
      >
        <Download size={13} aria-hidden />
        <span>{t("transcriptExport")}</span>
      </button>
      {open && anchor && hasWords && (
        <ExportItems
          anchor={anchor}
          onPick={(format) => {
            setOpen(false);
            // The focused item unmounts with the menu: keep the keyboard user on the button.
            anchor.focus();
            onExport(format);
          }}
          onClose={close}
        />
      )}
    </>
  );
}

function ExportItems({
  anchor,
  onPick,
  onClose,
}: {
  anchor: HTMLElement;
  onPick(format: TranscriptExportFormat): void;
  onClose(): void;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  // Below the trigger, right edges aligned, clamped to the window.
  useLayoutEffect(() => {
    const rect = anchor.getBoundingClientRect();
    const width = menuRef.current?.offsetWidth ?? 0;
    const height = menuRef.current?.offsetHeight ?? 0;
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    const top = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - height - 8));
    setPos({ left, top });
  }, [anchor]);

  useEffect(() => {
    window.addEventListener("resize", onClose);
    return () => window.removeEventListener("resize", onClose);
  }, [onClose]);

  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      // The trigger's own click toggles; closing here too would reopen it.
      if (menuRef.current?.contains(target) || anchor.contains(target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [anchor, onClose]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    // The editor's window handler would also toggle playback on Space: handled keys stop here.
    const handled = (): void => {
      event.preventDefault();
      event.stopPropagation();
    };
    const move = (to: number): void => {
      handled();
      items[(to + items.length) % items.length]?.focus();
    };
    if (event.key === "Escape") {
      handled();
      onClose();
      anchor.focus();
    } else if (event.key === "Tab") {
      event.stopPropagation();
      onClose();
    } else if (event.key === "ArrowDown") move(at + 1);
    else if (event.key === "ArrowUp") move(at - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(items.length - 1);
    else if (event.key === "Enter" || event.key === " ") {
      handled();
      items[at]?.click();
    } else if (event.key === "Delete" || event.key === "Backspace") handled();
    else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) handled();
  };

  return createPortal(
    <div
      {...uiArea("editorVideo.transcriptExportMenu")}
      ref={menuRef}
      role="menu"
      aria-label={t("transcriptExportMenuLabel")}
      aria-orientation="vertical"
      className={styles.menu}
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={onKeyDown}
    >
      {FORMATS.map(({ format, label }) => (
        <button
          key={format}
          type="button"
          role="menuitem"
          tabIndex={-1}
          className={styles.item}
          data-format={format}
          onClick={() => onPick(format)}
        >
          {t(label as "transcriptExportSrt")}
        </button>
      ))}
      <p className={styles.hint}>{t("transcriptExportHint")}</p>
    </div>,
    document.body,
  );
}
