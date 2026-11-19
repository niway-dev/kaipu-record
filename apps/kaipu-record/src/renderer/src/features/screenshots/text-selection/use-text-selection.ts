import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { textOfWords, wordsInReadingOrder, type RecognizedWord } from "@kaipu/domain/schemas";
import type { BasePlacement } from "../annotations/scene";
import { wordRange, type PixelSize } from "./geometry";

/** What the annotation layer needs to draw and drive the "Select text" tool. */
export interface TextLayerModel {
  /** The selectable words (redacted ones already removed), in reading order. */
  words: RecognizedWord[];
  /** The base image's pixel size, the space the words' rects are in. */
  natural: PixelSize;
  /**
   * Where the whole base asset sits (a resized or moved base); absent = unmoved, natural size.
   * The words' pixels map to the world through it.
   */
  basePlacement?: BasePlacement;
  /** The words currently selected. */
  selected: ReadonlySet<RecognizedWord>;
  /** Select the range from `anchor` to `focus` in reading order, both included. */
  select(anchor: RecognizedWord, focus: RecognizedWord): void;
  clear(): void;
}

/** What the options bar shows and does for the "Select text" tool. */
export interface TextToolStatus {
  status: "pending" | "ready" | "unavailable";
  /** Selectable words (redacted ones excluded). */
  wordCount: number;
  selectedCount: number;
  onCopy(): void;
  onSelectAll(): void;
}

export interface TextSelection {
  ordered: RecognizedWord[];
  selected: RecognizedWord[];
  selectedSet: ReadonlySet<RecognizedWord>;
  /** The selected words as plain text; "" when nothing is selected. */
  text: string;
  select(anchor: RecognizedWord, focus: RecognizedWord): void;
  selectAll(): void;
  clear(): void;
}

/**
 * The text selection over `words`: an anchor and a focus word, and the range between them in
 * reading order. A word that disappears (a redaction now covers it) hides the range instead
 * of leaving one that points at nothing; the range comes back if the word returns.
 */
export function useTextSelection(words: RecognizedWord[]): TextSelection {
  const ordered = useMemo(() => wordsInReadingOrder(words), [words]);
  const [range, setRange] = useState<{ anchor: RecognizedWord; focus: RecognizedWord } | null>(
    null,
  );
  const selected = useMemo(
    () => (range ? wordRange(ordered, range.anchor, range.focus) : []),
    [ordered, range],
  );
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const text = useMemo(() => textOfWords(selected), [selected]);

  const select = useCallback((anchor: RecognizedWord, focus: RecognizedWord): void => {
    setRange((prev) =>
      prev?.anchor === anchor && prev.focus === focus ? prev : { anchor, focus },
    );
  }, []);
  const clear = useCallback((): void => setRange(null), []);
  const orderedRef = useRef(ordered);
  orderedRef.current = ordered;
  const selectAll = useCallback((): void => {
    const all = orderedRef.current;
    if (all.length > 0) setRange({ anchor: all[0], focus: all[all.length - 1] });
  }, []);

  return { ordered, selected, selectedSet, text, select, selectAll, clear };
}

/** True when the keyboard event came from a text field, which owns Cmd/Ctrl+C and +A. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

/**
 * Cmd/Ctrl+C copies the selected words as text and Cmd/Ctrl+A selects every word, while the
 * "Select text" tool is active. A press with nothing selected, in a text field, or under a
 * modal is left alone.
 */
export function useTextSelectionKeys(opts: {
  active: boolean;
  hasSelection: boolean;
  onCopy: () => void;
  onSelectAll: () => void;
}): void {
  const latest = useRef(opts);
  latest.current = opts;
  const { active } = opts;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (isTypingTarget(e.target) || document.querySelector('[aria-modal="true"]')) return;
      const key = e.key.toLowerCase();
      if (key === "c" && latest.current.hasSelection) {
        e.preventDefault();
        latest.current.onCopy();
      } else if (key === "a") {
        e.preventDefault();
        latest.current.onSelectAll();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);
}
