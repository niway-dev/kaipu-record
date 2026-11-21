import { createContext, useContext } from "react";
import type { LibraryVideo } from "../types";

/** What every `LibraryPicker` part reads from the root. */
export interface LibraryPickerState {
  /** The items before the search is applied: they decide "empty" against "no match". */
  items: readonly LibraryVideo[];
  /** The items the search keeps, in the order given. */
  visible: readonly LibraryVideo[];
  query: string;
  setQuery(query: string): void;
  /** The selected item: the explicit pick if still listed, else (optionally) the first row. */
  selected: LibraryVideo | undefined;
  select(item: LibraryVideo): void;
  /** Double click on a row: the caller's "use this one". */
  activate(item: LibraryVideo): void;
  loading: boolean;
  /** Prefix of the parts' `data-testid`s ("<prefix>-row", "<prefix>-video", …). */
  testIdPrefix: string;
}

export const LibraryPickerContext = createContext<LibraryPickerState | null>(null);

/**
 * The picker's state, for custom parts the caller writes (a card grid instead of the list, a
 * button that reads the selection). Throws outside `<LibraryPicker>`: a part with no root has no
 * items to show, and a silent empty render would hide the mistake.
 */
export function useLibraryPicker(): LibraryPickerState {
  const state = useContext(LibraryPickerContext);
  if (!state) throw new Error("LibraryPicker parts must be rendered inside <LibraryPicker>.");
  return state;
}
