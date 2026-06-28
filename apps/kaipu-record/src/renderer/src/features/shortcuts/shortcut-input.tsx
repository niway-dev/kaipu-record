import React from "react";
import { captureShortcut, formatAccelerator } from "./keyboard-accelerator";
import styles from "./shortcut-input.module.css";

export interface ShortcutInputProps {
  /** Current Electron accelerator, e.g. "Command+Control+C". */
  value: string;
  /** Called with the new accelerator once a valid combo is captured. */
  onChange: (accelerator: string) => void;
  /** True when this binding failed to register (another app owns it). */
  unavailable?: boolean;
}

/**
 * A click-to-rebind control. Click to listen, then press a combo (Command/Control
 * + a letter or digit). Escape cancels. The capture/validation logic is pure and
 * lives in `keyboard-accelerator.ts`.
 */
export function ShortcutInput({
  value,
  onChange,
  unavailable = false,
}: ShortcutInputProps): React.JSX.Element {
  const [listening, setListening] = React.useState(false);

  React.useEffect(() => {
    if (!listening) return;
    // The shortcuts are still globally registered; suspend them so the combo
    // reaches us here instead of firing the action being rebound.
    window.electronAPI.suspendShortcuts();
    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setListening(false);
        return;
      }
      const captured = captureShortcut(event);
      if (captured) {
        onChange(captured.accelerator);
        setListening(false);
      }
    };
    // Capture phase so we intercept before anything else in the renderer.
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      // Re-register (picks up the new binding if one was just saved).
      window.electronAPI.resumeShortcuts();
    };
  }, [listening, onChange]);

  return (
    <button
      type="button"
      className={styles.input}
      data-listening={listening || undefined}
      data-unavailable={unavailable || undefined}
      aria-label="Change shortcut"
      title={unavailable ? "In use by another app — pick a different combo" : undefined}
      onClick={() => setListening((on) => !on)}
      onBlur={() => setListening(false)}
    >
      {listening ? "Press keys…" : formatAccelerator(value)}
    </button>
  );
}
