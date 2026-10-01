/**
 * One selection for the whole editor: a clip/slide, an annotation, a zoom or a privacy
 * region — never two at once. Selecting any kind clears the others, which is what makes
 * the inspector panel, Delete and Esc unambiguous (spec § 7: the panel "changes with the
 * selection").
 */
import { useCallback, useState } from "react";

export type SelectionKind = "item" | "overlay" | "zoom" | "redaction" | "mute";
export type EditorSelection = { kind: SelectionKind; id: string } | null;

export function selectedIdOf(selection: EditorSelection, kind: SelectionKind): string | null {
  return selection?.kind === kind ? selection.id : null;
}

export interface EditorSelectionController {
  selection: EditorSelection;
  itemId: string | null;
  overlayId: string | null;
  zoomId: string | null;
  redactionId: string | null;
  muteId: string | null;
  /** `id = null` clears the selection only if it currently is of that kind. */
  select(kind: SelectionKind, id: string | null): void;
  clear(): void;
}

export function useEditorSelection(): EditorSelectionController {
  const [selection, setSelection] = useState<EditorSelection>(null);
  const select = useCallback((kind: SelectionKind, id: string | null) => {
    setSelection((current) =>
      id === null ? (current?.kind === kind ? null : current) : { kind, id },
    );
  }, []);
  const clear = useCallback(() => setSelection(null), []);
  return {
    selection,
    itemId: selectedIdOf(selection, "item"),
    overlayId: selectedIdOf(selection, "overlay"),
    zoomId: selectedIdOf(selection, "zoom"),
    redactionId: selectedIdOf(selection, "redaction"),
    muteId: selectedIdOf(selection, "mute"),
    select,
    clear,
  };
}
