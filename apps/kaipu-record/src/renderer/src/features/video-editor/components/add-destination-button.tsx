import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import {
  destinationAllowed,
  LIBRARY_DESTINATIONS,
  schematicPlacement,
  type LibraryDestination,
  type LibraryItemKind,
} from "../add-from-library";
import { PlacementStrip } from "./placement-strip";
import styles from "./add-destination-button.module.css";

export interface AddDestinationButtonProps {
  /** What is selected: a recording cannot go over the video yet, so that option is disabled. */
  kind: LibraryItemKind;
  /** The chosen destination: the big part of the button adds there and says so. */
  value: LibraryDestination;
  onChange(destination: LibraryDestination): void;
  /** The single Add: applies the selection at `value`. */
  onAdd(): void;
  /**
   * The option the menu is pointing at (hover or keyboard) while it is open, null when it is
   * closed: the modal draws that one in its big strip, and goes back to `value` on null.
   */
  onPreview(destination: LibraryDestination | null): void;
}

type CtaKey = "Over" | "Before" | "After" | "Start" | "End";
const KEYS: Record<LibraryDestination, CtaKey> = {
  over: "Over",
  "before-clip": "Before",
  "after-clip": "After",
  start: "Start",
  end: "End",
};

/**
 * The one place an Add from Library item is sent (NIW2-829): a split button. The big part adds
 * at the chosen destination and names it ("Add after this clip"); the arrow opens a menu of the
 * five destinations, each with a thumbnail of the same fixed schematic (three clips and a new
 * item), so the menu reads as a legend of the places, not as the user's own sequence. Choosing
 * one only sets the destination and closes the menu: it never adds. A WAI-ARIA menu of radio
 * items.
 */
export function AddDestinationButton({
  kind,
  value,
  onChange,
  onAdd,
  onPreview,
}: AddDestinationButtonProps): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const id = useId();
  const menuId = `${id}-menu`;
  const titleId = `${id}-title`;
  const [open, setOpen] = useState(false);
  // `focused` is the item with DOM focus (the keyboard's); `hovered` is the pointer's.
  const [focused, setFocused] = useState<LibraryDestination>(value);
  const [hovered, setHovered] = useState<LibraryDestination | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Partial<Record<LibraryDestination, HTMLButtonElement | null>>>({});
  const enabled = LIBRARY_DESTINATIONS.filter((destination) =>
    destinationAllowed(kind, destination),
  );

  const label = (destination: LibraryDestination): string =>
    t(`addFromLibraryDest${KEYS[destination]}`);
  const hint = (destination: LibraryDestination): string =>
    destinationAllowed(kind, destination)
      ? t(`addFromLibraryDest${KEYS[destination]}Hint`)
      : t("addFromLibraryDestOverLater");

  // Opening puts focus on the chosen item.
  useEffect(() => {
    if (!open) return;
    setFocused(value);
    setHovered(null);
    itemRefs.current[value]?.focus();
  }, [open, value]);

  // The modal draws whatever the menu points at, and goes back when it closes (or unmounts: a
  // new selection or tab remounts this button).
  const pointed = open ? (hovered ?? focused) : null;
  useEffect(() => {
    onPreview(pointed);
  }, [pointed, onPreview]);
  useEffect(() => () => onPreview(null), [onPreview]);

  // A press outside the button and its menu closes it, and leaves focus where the press put it.
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const closeToArrow = (): void => {
    setOpen(false);
    arrowRef.current?.focus();
  };
  const choose = (destination: LibraryDestination): void => {
    if (!destinationAllowed(kind, destination)) return;
    onChange(destination);
    closeToArrow();
  };
  const moveFocus = (to: LibraryDestination): void => {
    // The last input wins: a key press moves the preview even while the pointer rests on an item.
    setHovered(null);
    setFocused(to);
    itemRefs.current[to]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (!open) return;
    const at = enabled.indexOf(focused);
    switch (event.key) {
      case "Escape":
        // Closes the menu only: the modal's own Escape must not see it.
        event.preventDefault();
        event.stopPropagation();
        closeToArrow();
        return;
      case "Tab":
        // Focus goes to the arrow first, so Tab continues from there as the menu goes away.
        setOpen(false);
        arrowRef.current?.focus();
        return;
      case "ArrowDown":
        event.preventDefault();
        moveFocus(enabled[(at + 1) % enabled.length]);
        return;
      case "ArrowUp":
        event.preventDefault();
        moveFocus(enabled[(at - 1 + enabled.length) % enabled.length]);
        return;
      case "Home":
        event.preventDefault();
        moveFocus(enabled[0]);
        return;
      case "End":
        event.preventDefault();
        moveFocus(enabled[enabled.length - 1]);
        return;
      default:
    }
  };

  return (
    <div
      ref={rootRef}
      className={styles.root}
      data-testid="add-destination-button"
      onKeyDown={onKeyDown}
    >
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-labelledby={titleId}
          className={styles.menu}
          data-testid="add-destination-menu"
        >
          <p className={styles.menuTitle} id={titleId}>
            {t("addFromLibraryDestMenuTitle")}
          </p>
          {LIBRARY_DESTINATIONS.map((destination, index) => {
            const allowed = destinationAllowed(kind, destination);
            const checked = value === destination;
            return (
              <button
                key={destination}
                ref={(el) => {
                  itemRefs.current[destination] = el;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                aria-disabled={allowed ? undefined : true}
                tabIndex={focused === destination ? 0 : -1}
                className={`${styles.item} ${index === 1 ? styles.itemAfterSeparator : ""}`}
                data-checked={checked ? "true" : undefined}
                data-active={pointed === destination ? "true" : undefined}
                onClick={() => choose(destination)}
                onMouseEnter={() => allowed && setHovered(destination)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => allowed && setFocused(destination)}
              >
                <span className={styles.thumb} aria-hidden>
                  <PlacementStrip size="small" preview={schematicPlacement(destination)} />
                </span>
                <span className={styles.itemText}>
                  <span className={styles.itemLabel}>{label(destination)}</span>
                  <span className={styles.itemHint}>{hint(destination)}</span>
                </span>
                {checked && (
                  <Check className={styles.check} size={15} strokeWidth={2.4} aria-hidden />
                )}
              </button>
            );
          })}
        </div>
      )}
      <button type="button" className={styles.cta} onClick={onAdd}>
        {t(`addFromLibraryAdd${KEYS[value]}`)}
      </button>
      <button
        ref={arrowRef}
        type="button"
        className={styles.arrow}
        data-open={open ? "true" : undefined}
        aria-label={t("addFromLibraryDestChoose")}
        title={t("addFromLibraryDestChoose")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((prev) => !prev)}
      >
        {open ? (
          <ChevronDown size={17} strokeWidth={2.4} aria-hidden />
        ) : (
          <ChevronUp size={17} strokeWidth={2.4} aria-hidden />
        )}
      </button>
    </div>
  );
}
