import { useMemo, type HTMLAttributes, type ReactNode } from "react";
import type { LibraryVideo } from "../types";
import { LibraryPickerContext, type LibraryPickerState } from "./picker-context";
import { useControllable } from "./use-controllable";
import styles from "./library-picker.module.css";

/** The default search: a case-insensitive title match after trimming; blank keeps everything. */
export function matchesTitle(item: LibraryVideo, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return needle === "" || item.title.toLowerCase().includes(needle);
}

export interface LibraryPickerProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Every item the picker can offer, in display order. */
  items: readonly LibraryVideo[];
  /** The first read has not landed: `Body` shows its `loading` note instead of an empty one. */
  loading?: boolean;
  /** The selected asset id. Controlled when given; `onSelectedIdChange` then decides. */
  selectedId?: string | null;
  defaultSelectedId?: string | null;
  onSelectedIdChange?(assetId: string | null): void;
  /** The search text. Controlled when given. */
  query?: string;
  defaultQuery?: string;
  onQueryChange?(query: string): void;
  /** Whether an item stays in the list for this query. Defaults to a title match. */
  filter?(item: LibraryVideo, query: string): boolean;
  /**
   * With no pick, or a pick that was filtered out or left the Library, the first visible row
   * stands in for it (default). Off, nothing is selected until one is picked.
   */
  autoSelectFirst?: boolean;
  /** A double click on a row. */
  onActivate?(item: LibraryVideo): void;
  /** Prefix of the parts' test ids. */
  testIdPrefix?: string;
  children: ReactNode;
}

/**
 * The root of the Library picker, a compound component: it owns the items, the search and the
 * selection and shares them with its parts through context. The caller arranges the parts
 * (`Header`, `Search`, `Body`, `List`, `Preview`, `Footer`, …) and may swap any of them for its
 * own, which reads the same state through `useLibraryPicker`. Export's "Pick a video" and the
 * editor's Add from Library both are this component with different parts around the list.
 *
 * The root renders the sheet's `div` (the caller's `className` and any other attribute go on
 * it) and carries no buttons of its own: closing, choosing and adding are the caller's.
 */
export function LibraryPicker({
  items,
  loading = false,
  selectedId,
  defaultSelectedId = null,
  onSelectedIdChange,
  query: queryProp,
  defaultQuery = "",
  onQueryChange,
  filter = matchesTitle,
  autoSelectFirst = true,
  onActivate,
  testIdPrefix = "library-picker",
  className,
  children,
  ...rest
}: LibraryPickerProps): React.JSX.Element {
  const [query, setQuery] = useControllable(queryProp, defaultQuery, onQueryChange);
  const [pickedId, setPickedId] = useControllable<string | null>(
    selectedId,
    defaultSelectedId,
    onSelectedIdChange,
  );

  const visible = useMemo(
    () => items.filter((item) => filter(item, query)),
    [items, filter, query],
  );
  const selected =
    visible.find((item) => item.assetId === pickedId) ?? (autoSelectFirst ? visible[0] : undefined);

  const state: LibraryPickerState = {
    items,
    visible,
    query,
    setQuery,
    selected,
    select: (item) => setPickedId(item.assetId),
    activate: (item) => onActivate?.(item),
    loading,
    testIdPrefix,
  };

  return (
    <LibraryPickerContext.Provider value={state}>
      <div {...rest} className={className ? `${styles.root} ${className}` : styles.root}>
        {children}
      </div>
    </LibraryPickerContext.Provider>
  );
}
