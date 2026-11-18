import { useEffect, useRef } from "react";
import { isEditingTarget } from "../inspect/inspect-keys";
import type { AnnotationTool } from "../annotations/tools";
import { ADD_IMAGE_KEY, TOOL_KEYS } from "./tool-meta";

/** What a key press means for the toolbar, if anything. */
export type ToolShortcut = { tool: AnnotationTool } | { addImage: true };

/**
 * Which toolbar action a key press asks for (mock B2): V P R A T N B X pick a tool, M opens the
 * Add image menu. Pure, so the guards are testable alone.
 *
 * Nothing happens with Cmd/Ctrl/Alt held (those chords keep their meaning), nor when the press
 * comes from somewhere the user types (the title, an annotation's text, a slider). A key for a
 * control that is not shown (`addImage` false: the flag is off) does nothing. The "a menu or a
 * dialog is open" guard needs the document, so the hook adds it.
 *
 * C, I, 1 and 2 are Inspect's and Esc is Inspect's too: they are not here, so that key has one owner.
 */
export function toolShortcut(
  e: {
    key: string;
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    target: EventTarget | null;
  },
  opts: { addImage: boolean },
): ToolShortcut | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  if (isEditingTarget(e.target)) return null;
  const key = e.key.toUpperCase();
  if (key === ADD_IMAGE_KEY) return opts.addImage ? { addImage: true } : null;
  for (const [tool, toolKey] of Object.entries(TOOL_KEYS)) {
    if (toolKey === key) return { tool: tool as AnnotationTool };
  }
  return null;
}

/** An open menu (the Draw, More or Add image list) or a dialog: the keys stay quiet. */
export const OVERLAY = '[role="menu"], [aria-modal="true"]';

/**
 * The toolbar's key listener: a window `keydown`, so the keys work wherever focus sits on the
 * page. Reads the latest callbacks through a ref, so it subscribes once.
 *
 * `onTool` is the same function a click on the tool runs (it also leaves Inspect), and
 * `onAddImage` is omitted when Add image is not shown.
 */
export function useToolShortcuts(opts: {
  onTool: (tool: AnnotationTool) => void;
  onAddImage?: () => void;
}): void {
  const latest = useRef(opts);
  latest.current = opts;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return;
      const hit = toolShortcut(e, { addImage: latest.current.onAddImage !== undefined });
      if (!hit || document.querySelector(OVERLAY)) return;
      e.preventDefault();
      if ("tool" in hit) latest.current.onTool(hit.tool);
      else latest.current.onAddImage?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
