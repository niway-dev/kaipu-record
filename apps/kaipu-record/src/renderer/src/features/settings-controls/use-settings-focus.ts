import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";

/**
 * The focus contract every settings container (popover and drawer) shares: opening moves
 * focus into the content (its first radiogroup, or a blocked card's button), Esc closes
 * and gives focus back to the chevron.
 */
export function useSettingsFocus(
  open: boolean,
  chevronRef: RefObject<HTMLButtonElement | null>,
  onClose: () => void,
): {
  firstRef: RefObject<HTMLElement | null>;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
} {
  const firstRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const target = firstRef.current;
    if (!target) return;
    // Into the group: its checked radio is its tab stop.
    const radio = target.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]');
    (radio ?? target).focus();
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
    chevronRef.current?.focus();
  };

  return { firstRef, onKeyDown };
}
