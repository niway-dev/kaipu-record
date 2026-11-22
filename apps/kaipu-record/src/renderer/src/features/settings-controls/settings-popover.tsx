import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { placePopover, type PopoverPlacement } from "./popover-placement";
import styles from "./settings-popover.module.css";
import type { UiAreaProps } from "@renderer/lib/ui-area";

export interface SettingsPopoverProps {
  id: string;
  label: string;
  open: boolean;
  /** The chevron: it gets focus back when the popover closes, and `aria-controls` names `id`. */
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** The catalog area this popover is (`uiArea("…")`), put on its root. */
  ui?: UiAreaProps;
  children: ReactNode;
}

/** The element marked with this attribute (a card) is what the popover is placed against. */
const ANCHOR_ATTRIBUTE = "data-settings-anchor";

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The Mic, System audio and Camera settings, as a popover anchored to its card. Used by the
 * Capture page and by the capture widget, so both open the same panel. It is drawn in the body at
 * fixed coordinates, so it never moves the content under it and no ancestor clips it; below the
 * card when it fits, above when it does not (the widget sits at the bottom of the screen).
 *
 * Closing: Esc (from anywhere, taken before the window's own handlers: the first Esc closes the
 * popover, the next one cancels a capture), a press outside it and its card, and the owner's
 * `onClose` (the chevron, a window blur). Focus moves into it on open and back to the chevron on
 * close, unless the close came from focus moving elsewhere. Keys inside it stop here: the overlay's
 * window-level Enter would start the recording and a bare 1/2/3 would switch the capture mode.
 */
export function SettingsPopover({
  id,
  label,
  open,
  anchorRef,
  onClose,
  ui,
  children,
}: SettingsPopoverProps): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<PopoverPlacement | null>(null);
  const focusedInside = useRef(false);

  const anchorElement = useCallback((): HTMLElement | null => {
    const chevron = anchorRef.current;
    return chevron?.closest<HTMLElement>(`[${ANCHOR_ATTRIBUTE}]`) ?? chevron;
  }, [anchorRef]);

  const measure = useCallback((): void => {
    const popover = ref.current;
    const anchor = anchorElement();
    if (!popover || !anchor) return;
    const natural = Math.max(popover.offsetHeight, popover.scrollHeight);
    const next = placePopover({
      anchor: anchor.getBoundingClientRect(),
      size: { width: popover.offsetWidth, height: natural },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });
    setPlacement((current) =>
      current &&
      current.left === next.left &&
      current.top === next.top &&
      current.maxHeight === next.maxHeight &&
      current.side === next.side
        ? current
        : next,
    );
  }, [anchorElement]);

  // Placed before the first paint, and again when the window resizes, the page scrolls or the
  // content changes height (turning Framing on adds rows).
  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure());
    if (ref.current) observer?.observe(ref.current);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      observer?.disconnect();
    };
  }, [open, measure]);

  // Focus into the content: the checked radio, else the first control, else the popover itself.
  useEffect(() => {
    if (!open) return;
    const popover = ref.current;
    if (!popover) return;
    const target =
      popover.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') ??
      popover.querySelector<HTMLElement>(FOCUSABLE) ??
      popover;
    target.focus();
  }, [open]);

  // The chevron as it is when asked: its element can be replaced while the popover is open (the
  // widget draws a different button for its compact and expanded looks).
  const focusChevron = useCallback((): void => anchorRef.current?.focus(), [anchorRef]);

  // Back to the chevron when it closes while focus was inside (the popover's own elements are
  // gone by then, so focus fell to the body). A press that moved focus elsewhere keeps it there.
  useEffect(() => {
    if (!open) return;
    return () => {
      const active = document.activeElement;
      if (focusedInside.current && (active === null || active === document.body)) {
        focusChevron();
      }
      focusedInside.current = false;
    };
  }, [open, focusChevron]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
      focusChevron();
    };
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      // The card's own presses toggle or open it: closing here too would undo the chevron.
      if (ref.current?.contains(target) || anchorElement()?.contains(target)) return;
      onClose();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open, onClose, focusChevron, anchorElement]);

  if (!open) return null;

  // Every key inside it stays inside: the overlay's bare 1/2/3, M, A, W and Enter are window-level
  // shortcuts that must not fire while the owner works in the popover (Esc closed it above).
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    event.stopPropagation();
  };

  // Tab out of the popover (it is portalled to the body, so it is not on the way) closes it.
  // Focus going to nowhere is either a window blur, which the owner's own rule handles, or Tab
  // past the last control with the window still focused: focus then rests on the body and later
  // keys would bypass this popover's key containment. One tick later the two can be told apart.
  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    const next = event.relatedTarget as Node | null;
    if (!next) {
      const popover = event.currentTarget;
      setTimeout(() => {
        if (ref.current !== popover || !document.hasFocus()) return;
        const active = document.activeElement;
        if (active && (popover.contains(active) || anchorElement()?.contains(active))) return;
        onClose();
      }, 0);
      return;
    }
    if (event.currentTarget.contains(next) || anchorElement()?.contains(next)) return;
    onClose();
  };

  return createPortal(
    <div
      {...ui}
      ref={ref}
      id={id}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className={styles.popover}
      data-side={placement?.side}
      style={{
        left: placement?.left ?? 0,
        top: placement?.top ?? 0,
        maxHeight: placement ? placement.maxHeight : undefined,
      }}
      onFocus={() => {
        focusedInside.current = true;
      }}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>,
    document.body,
  );
}
