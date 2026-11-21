import { Film, Search, X } from "lucide-react";
import type { ReactNode } from "react";
import { ModalTitle } from "@kaipu/ui";
import { formatDuration } from "../format";
import type { LibraryVideo } from "../types";
import { useLibraryPicker } from "./picker-context";
import styles from "./library-picker.module.css";

const cx = (...names: (string | undefined | false)[]): string => names.filter(Boolean).join(" ");

/** The top bar: the sheet's title on the left, then whatever the caller puts in (tabs, search, close). */
export function Header({
  title,
  titleId,
  children,
}: {
  title: ReactNode;
  /** The id `ModalOverlay`'s `labelledBy` points at. */
  titleId: string;
  children?: ReactNode;
}): React.JSX.Element {
  useLibraryPicker();
  return (
    <header className={styles.header}>
      <div className={styles.title}>
        <ModalTitle id={titleId}>{title}</ModalTitle>
      </div>
      {children}
    </header>
  );
}

/** The search box. It sits at the right end of the header, before the close button. */
export function SearchBox({
  placeholder,
  label,
}: {
  placeholder: string;
  /** The accessible name; the placeholder when omitted. */
  label?: string;
}): React.JSX.Element {
  const { query, setQuery } = useLibraryPicker();
  return (
    <label className={styles.search}>
      <Search size={14} aria-hidden className={styles.searchIcon} />
      <input
        type="search"
        className={styles.searchInput}
        value={query}
        aria-label={label ?? placeholder}
        placeholder={placeholder}
        onChange={(event) => setQuery(event.target.value)}
      />
    </label>
  );
}

/** The ✕ at the end of the header. What closing means is the caller's. */
export function CloseButton({
  label,
  onClick,
}: {
  label: string;
  onClick(): void;
}): React.JSX.Element {
  useLibraryPicker();
  return (
    <button
      type="button"
      className={styles.close}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <X size={14} aria-hidden />
    </button>
  );
}

/** A centered message that fills the body: loading, empty, no match, a failed read. */
export function Note({
  title,
  hint,
  children,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
}): React.JSX.Element {
  useLibraryPicker();
  return (
    <div className={styles.note} role="status">
      {children !== undefined && <p>{children}</p>}
      {title !== undefined && <p className={styles.noteTitle}>{title}</p>}
      {hint !== undefined && <p className={styles.noteHint}>{hint}</p>}
    </div>
  );
}

/**
 * Everything under the header. With items it is the split the list and the preview share; with
 * none it shows the note for why, so the preview never stands over an empty list: `loading`
 * first, then `empty` (the Library has nothing to offer), then `noMatch` (the search kept
 * nothing, handed the trimmed query). A note left out falls back to the split.
 */
export function Body({
  loading,
  empty,
  noMatch,
  children,
}: {
  loading?: ReactNode;
  empty?: ReactNode;
  noMatch?: ReactNode | ((query: string) => ReactNode);
  children?: ReactNode;
}): React.JSX.Element {
  const state = useLibraryPicker();
  let note: ReactNode = null;
  if (state.loading) note = loading;
  else if (state.items.length === 0) note = empty;
  else if (state.visible.length === 0)
    note = typeof noMatch === "function" ? noMatch(state.query.trim()) : noMatch;
  return <>{note ?? <div className={styles.split}>{children}</div>}</>;
}

/** The rows. `renderRow` swaps the default `Row` for the caller's own. */
export function List({
  label,
  renderRow,
}: {
  label: string;
  renderRow?(item: LibraryVideo, state: { selected: boolean }): ReactNode;
}): React.JSX.Element {
  const { visible, selected } = useLibraryPicker();
  return (
    <ul className={styles.list} aria-label={label}>
      {visible.map((item) => (
        <li key={item.assetId}>
          {renderRow ? (
            renderRow(item, { selected: item.assetId === selected?.assetId })
          ) : (
            <Row item={item} />
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * One row: a thumbnail, the title, an optional badge and meta lines. A click selects it and a
 * double click activates it (the root's `onActivate`).
 */
export function Row({
  item,
  meta,
  badge,
  durationOnThumb = false,
}: {
  item: LibraryVideo;
  /** Small mono lines under the title; each string is its own line. */
  meta?: string | readonly string[];
  /** A short tag under the title ("Exporting now"); it joins the row's accessible name. */
  badge?: string;
  /** Draw the duration over the thumbnail's corner. */
  durationOnThumb?: boolean;
}): React.JSX.Element {
  const { selected, select, activate, testIdPrefix } = useLibraryPicker();
  const isSelected = item.assetId === selected?.assetId;
  const lines = meta === undefined ? [] : typeof meta === "string" ? [meta] : meta;
  return (
    <button
      type="button"
      className={styles.row}
      data-testid={`${testIdPrefix}-row`}
      data-selected={isSelected ? "true" : undefined}
      aria-pressed={isSelected}
      aria-label={badge ? `${item.title}, ${badge}` : item.title}
      onClick={() => select(item)}
      onDoubleClick={() => activate(item)}
    >
      <span className={styles.thumb}>
        {item.thumbnailUrl ? (
          <img className={styles.thumbImage} src={item.thumbnailUrl} alt="" />
        ) : (
          <span className={styles.placeholder} data-testid={`${testIdPrefix}-placeholder`}>
            <Film size={16} aria-hidden />
          </span>
        )}
        {durationOnThumb && (
          <span className={styles.duration}>{formatDuration(item.durationSeconds)}</span>
        )}
      </span>
      <span className={styles.text}>
        <span className={styles.name}>{item.title}</span>
        {badge && <span className={styles.badge}>{badge}</span>}
        {lines.map((line) => (
          <span key={line} className={styles.meta}>
            {line}
          </span>
        ))}
      </span>
    </button>
  );
}

/** The column beside the list: a preview, or whatever the caller lays out for the selection. */
export function Detail({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}): React.JSX.Element {
  useLibraryPicker();
  return <section className={cx(styles.detail, className)}>{children}</section>;
}

/** A framed picture area that takes the height the column has left, with `below` under it. */
export function Frame({
  below,
  children,
}: {
  below?: ReactNode;
  children?: ReactNode;
}): React.JSX.Element {
  useLibraryPicker();
  return (
    <div className={styles.preview}>
      <div className={styles.previewFrame}>{children}</div>
      {below}
    </div>
  );
}

/** The bar under the body: the caller's buttons, right-aligned. */
export function Footer({ children }: { children?: ReactNode }): React.JSX.Element {
  useLibraryPicker();
  return <footer className={styles.footer}>{children}</footer>;
}
