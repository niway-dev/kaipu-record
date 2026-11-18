import React, { useState } from "react";
import styles from "./toolbar-parts.module.css";

/** A key in a small mono chip (the mock's `kbd()`). */
export function Kbd({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <kbd className={styles.kbd}>{children}</kbd>;
}

function focusIsVisible(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true; // an engine without the selector: show it on any focus
  }
}

/**
 * A tooltip for a toolbar control: the label and, when there is one, its key in a kbd chip.
 * It shows on hover and on keyboard focus (not on a mouse click's focus), and hides on press so
 * it never sits over a menu the control opens. The control keeps its own `aria-label`, so the
 * tooltip adds to the accessible name nothing a screen reader needs.
 *
 * Spread `bind` on the control and render `node` beside it, inside a `position: relative` wrapper.
 */
export function useTip(
  label: string,
  keyHint?: string,
): {
  bind: Pick<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    "onMouseEnter" | "onMouseLeave" | "onMouseDown" | "onFocus" | "onBlur"
  >;
  node: React.JSX.Element | null;
} {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const node =
    hover || focus ? (
      <span role="tooltip" className={styles.tip}>
        {label}
        {keyHint ? <Kbd>{keyHint}</Kbd> : null}
      </span>
    ) : null;
  return {
    bind: {
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => setHover(false),
      onMouseDown: () => setHover(false),
      onFocus: (e) => setFocus(focusIsVisible(e.currentTarget)),
      onBlur: () => setFocus(false),
    },
    node,
  };
}

/**
 * Display labels whose `aria-keyshortcuts` name differs: ARIA wants UI Events `key` values
 * ("Escape"), while the kbd chip shows the short label ("Esc"). Every other hint is already a key name.
 */
const ARIA_KEY_NAMES: Record<string, string> = {
  Esc: "Escape",
  "⌘Z": "Meta+Z",
  "⇧⌘Z": "Meta+Shift+Z",
  "Ctrl+Z": "Control+Z",
  "Ctrl+Shift+Z": "Control+Shift+Z",
};

/** The `aria-keyshortcuts` value for a display key hint. */
export function ariaKeyShortcut(keyHint: string): string {
  return ARIA_KEY_NAMES[keyHint] ?? keyHint;
}

/** An icon button with a tooltip and `aria-keyshortcuts`; `aria-label` is the plain label. */
export function ToolButton({
  label,
  ariaLabel,
  keyHint,
  className,
  wrapClassName,
  children,
  ...rest
}: {
  label: string;
  /** The accessible name when it must differ from the tooltip's label (the mode switch's "Inspect (I)"). */
  ariaLabel?: string;
  /** The key that does the same thing; omit for a control without one. */
  keyHint?: string;
  className?: string;
  wrapClassName?: string;
  children: React.ReactNode;
} & Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label" | "title"
>): React.JSX.Element {
  const { bind, node } = useTip(label, keyHint);
  return (
    <span className={`${styles.tipWrap} ${wrapClassName ?? ""}`}>
      <button
        type="button"
        aria-label={ariaLabel ?? label}
        {...(keyHint ? { "aria-keyshortcuts": ariaKeyShortcut(keyHint) } : {})}
        className={className}
        {...bind}
        {...rest}
      >
        {children}
      </button>
      {node}
    </span>
  );
}
