import { useState } from "react";

export interface CaptureTitle {
  /** The name a Save writes today: the committed title. */
  title: string;
  /** The auto-generated fallback — also the input's placeholder. */
  autoTitle: string;
  /** The live input value (may differ from `title` mid-edit). */
  draft: string;
  setDraft(value: string): void;
  /**
   * Blur / Enter: trims the draft; empty falls back to the auto title. For a
   * saved item (`onRename` given) a changed title is renamed right away.
   */
  commit(): void;
  /** Esc: drop the edit and show the committed title again. */
  revert(): void;
  /** After a save: the vault's title is now the committed one. */
  adopt(title: string): void;
}

/** What a title field resolves to: its trimmed text, or the auto title when empty. */
export function resolveCaptureTitle(draft: string, autoTitle: string): string {
  return draft.trim() || autoTitle;
}

/**
 * Title field state for the screenshot editor. Holds the committed title, the edit
 * draft, and the one rule worth testing: a commit never yields an empty title, and
 * it renames (via the injected `onRename`) only when bound to a saved item AND the
 * title actually changed. A fresh capture persists nothing until Save, which reads
 * `title` — so the IPC plumbing stays out of here.
 */
export function useCaptureTitle(
  autoTitle: string,
  onRename: ((title: string) => void) | null,
): CaptureTitle {
  const [title, setTitle] = useState(autoTitle);
  const [draft, setDraft] = useState(autoTitle);

  return {
    title,
    autoTitle,
    draft,
    setDraft,
    commit: () => {
      const next = resolveCaptureTitle(draft, autoTitle);
      setDraft(next);
      if (next === title) return;
      setTitle(next);
      onRename?.(next);
    },
    revert: () => setDraft(title),
    adopt: (saved: string) => {
      setTitle(saved);
      setDraft(saved);
    },
  };
}
