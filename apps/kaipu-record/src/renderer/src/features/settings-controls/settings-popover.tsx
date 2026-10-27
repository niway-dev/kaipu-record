import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import styles from "./settings-popover.module.css";

export interface SettingsPopoverProps {
  id: string;
  label: string;
  open: boolean;
  onClose: () => void;
  /** The chevron: the popover hangs under its tile, and Esc sends focus back to it. */
  chevronRef: RefObject<HTMLButtonElement | null>;
  /** `end`: right edge on the chevron's (Camera). `start`: left edge on the tile's. */
  align: "start" | "end";
  width: number;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  children: ReactNode;
}

/** Space kept between a start-aligned popover and the window's edge. */
const EDGE = 8;

/**
 * The Record page's settings popover: a non-modal dialog anchored right under the
 * Mic · Audio · Camera row. `fixed` from the chevron's measured position, like the shared
 * Popover, so no ancestor's overflow clips it and the row's layout is untouched. Closes on
 * Esc (via `onKeyDown`), the chevron, or a press outside.
 */
export function SettingsPopover({
  id,
  label,
  open,
  onClose,
  chevronRef,
  align,
  width,
  onKeyDown,
  children,
}: SettingsPopoverProps): React.JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ top: number; left?: number; right?: number } | null>(
    null,
  );

  useLayoutEffect(() => {
    if (!open) return;
    const measure = (): void => {
      const chevron = chevronRef.current;
      if (!chevron) return;
      const rect = chevron.getBoundingClientRect();
      const top = rect.bottom + 8;
      if (align === "end") {
        setAnchor({ top, right: window.innerWidth - rect.right });
        return;
      }
      // The tile (the chevron's parent) is what the popover lines up with, kept inside the window.
      const tile = (chevron.parentElement ?? chevron).getBoundingClientRect();
      const left = Math.max(EDGE, Math.min(tile.left, window.innerWidth - width - EDGE));
      setAnchor({ top, left });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, chevronRef, align, width]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (dialogRef.current?.contains(target) || chevronRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [open, onClose, chevronRef]);

  if (!open) return null;
  return (
    <div
      ref={dialogRef}
      id={id}
      role="dialog"
      aria-label={label}
      className={styles.popover}
      style={{ width, ...anchor }}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}
