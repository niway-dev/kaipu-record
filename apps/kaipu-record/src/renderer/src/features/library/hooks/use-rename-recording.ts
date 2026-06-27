import { useState } from "react";

export interface RenameRecording {
  editing: boolean;
  draft: string;
  setDraft(value: string): void;
  startEdit(): void;
  /** Commit the draft — renames only when it is non-empty and actually changed. */
  commitEdit(): void;
  cancelEdit(): void;
}

/**
 * Inline-rename state machine for a recording title. Holds the edit draft and
 * enforces the one rule worth testing: a rename fires only when the trimmed draft
 * is non-empty and differs from the current title. The `onRename` side effect is
 * injected so the logic stays free of the library/IPC plumbing.
 */
export function useRenameRecording(
  currentTitle: string,
  onRename: (title: string) => void,
): RenameRecording {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  return {
    editing,
    draft,
    setDraft,
    startEdit: () => {
      setDraft(currentTitle);
      setEditing(true);
    },
    commitEdit: () => {
      const next = draft.trim();
      if (next && next !== currentTitle) onRename(next);
      setEditing(false);
    },
    cancelEdit: () => setEditing(false),
  };
}
