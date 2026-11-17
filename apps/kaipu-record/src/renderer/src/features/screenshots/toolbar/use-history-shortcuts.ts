import { useEffect, useRef } from "react";
import { detectKeyPlatform, type KeyPlatform } from "../overlay/overlay-keys";
import { OVERLAY } from "./use-tool-shortcuts";

export type HistoryShortcut = "undo" | "redo";

/** Input types where Cmd/Ctrl+Z has no text to undo: the canvas history is what the user means. */
const NON_TEXT_INPUTS = new Set([
  "range",
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "color",
]);

/** True where the user types text, so the field keeps its own undo. A slider or a checkbox is not. */
function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type);
  if (target.tagName === "TEXTAREA") return true;
  if (target.isContentEditable) return true;
  const attr = target.getAttribute("contenteditable");
  return attr !== null && attr !== "false";
}

/** The Undo key as the toolbar prints it. */
export function undoKeyLabel(platform: KeyPlatform): string {
  return platform === "mac" ? "⌘Z" : "Ctrl+Z";
}

/** The Redo key as the toolbar prints it (Ctrl+Y also works on Windows/Linux, unprinted). */
export function redoKeyLabel(platform: KeyPlatform): string {
  return platform === "mac" ? "⇧⌘Z" : "Ctrl+Shift+Z";
}

/**
 * Which history step a key press asks for. Pure, so the guards are testable alone.
 *
 * macOS: ⌘Z undoes, ⇧⌘Z redoes. Windows/Linux: Ctrl+Z undoes, Ctrl+Shift+Z and Ctrl+Y redo. Only
 * the platform's primary modifier counts, with no Alt and (for Z) no other modifier; a held key
 * (`repeat`) does nothing, so one long press cannot unwind the history. Nothing from a text field
 * (title, annotation text): that field's own undo wins. A slider or checkbox is not a text field.
 */
export function historyShortcut(
  e: {
    key: string;
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    repeat: boolean;
    target: EventTarget | null;
  },
  platform: KeyPlatform,
): HistoryShortcut | null {
  if (e.repeat || e.altKey) return null;
  const primary = platform === "mac" ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!primary) return null;
  if (isTextEntryTarget(e.target)) return null;
  const key = e.key.toLowerCase();
  if (key === "z") return e.shiftKey ? "redo" : "undo";
  if (key === "y" && platform === "other" && !e.shiftKey) return "redo";
  return null;
}

/**
 * The editor's Undo/Redo key listener: a window `keydown`, so it works wherever focus sits on the
 * page. Reads the latest callbacks through a ref, so it subscribes once. Quiet while a menu or a
 * dialog is open, and it prevents the default (and so Electron's Edit menu) only when it acts.
 */
export function useHistoryShortcuts(opts: {
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}): void {
  const latest = useRef(opts);
  latest.current = opts;
  useEffect(() => {
    const platform = detectKeyPlatform();
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return;
      const hit = historyShortcut(e, platform);
      if (!hit || document.querySelector(OVERLAY)) return;
      const { onUndo, onRedo, canUndo, canRedo } = latest.current;
      if (hit === "undo" ? !canUndo : !canRedo) return;
      e.preventDefault();
      (hit === "undo" ? onUndo : onRedo)();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
