/**
 * Pure helpers to translate between a browser KeyboardEvent, an Electron
 * accelerator string (e.g. "Command+Control+C"), and a display label (e.g. "⌃⌘C").
 * No Electron imports — safe in the renderer and fully unit-testable.
 */

export interface CapturedShortcut {
  /** Electron accelerator, e.g. "Command+Control+C". */
  accelerator: string;
  /** Display label in macOS order, e.g. "⌃⌘C". */
  label: string;
}

const MODIFIER_KEYS = new Set(["Meta", "Control", "Alt", "Shift", "OS"]);

/** Map a physical key code to its accelerator token (letters + digits only, v1). */
function keyToken(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3); // KeyC → "C"
  if (/^Digit[0-9]$/.test(code)) return code.slice(5); // Digit2 → "2"
  return null;
}

/**
 * Build a shortcut from a keydown event, or null if it isn't bindable: a
 * modifier-only press, an unsupported key, or a combo without Command/Control
 * (required so a global shortcut never swallows plain typing).
 */
export function captureShortcut(event: {
  code: string;
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): CapturedShortcut | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const token = keyToken(event.code);
  if (!token) return null;
  if (!event.metaKey && !event.ctrlKey) return null;

  const accelParts: string[] = [];
  if (event.metaKey) accelParts.push("Command");
  if (event.ctrlKey) accelParts.push("Control");
  if (event.altKey) accelParts.push("Alt");
  if (event.shiftKey) accelParts.push("Shift");
  accelParts.push(token);

  return { accelerator: accelParts.join("+"), label: formatAccelerator(accelParts.join("+")) };
}

/**
 * The action already bound to `accelerator` (other than `action` itself), or
 * null. Lets the Shortcuts UI reject a duplicate *before* it saves — otherwise
 * two actions share a combo, the second `globalShortcut.register` returns false,
 * and that binding silently dies (mislabeled "in use by another app"). All
 * bindings come from the same producer (defaults or `captureShortcut`), so plain
 * string equality is a reliable duplicate check.
 */
export function conflictingAction<A extends string>(
  shortcuts: Record<A, string>,
  action: A,
  accelerator: string,
): A | null {
  for (const key of Object.keys(shortcuts) as A[]) {
    if (key !== action && shortcuts[key] === accelerator) return key;
  }
  return null;
}

// Accelerator token → symbol. Includes the cross-platform aliases for completeness.
const TOKEN_SYMBOLS: Record<string, string> = {
  Command: "⌘",
  Cmd: "⌘",
  CommandOrControl: "⌘",
  CmdOrCtrl: "⌘",
  Control: "⌃",
  Ctrl: "⌃",
  Alt: "⌥",
  Option: "⌥",
  Shift: "⇧",
};

// macOS convention renders modifiers in this order, then the key.
const SYMBOL_ORDER = ["⌃", "⌥", "⇧", "⌘"];

/** Render an Electron accelerator as a macOS-style label ("Command+Control+C" → "⌃⌘C"). */
export function formatAccelerator(accelerator: string): string {
  const symbols: string[] = [];
  let key = "";
  for (const part of accelerator.split("+")) {
    const symbol = TOKEN_SYMBOLS[part];
    if (symbol) symbols.push(symbol);
    else key = part;
  }
  symbols.sort((a, b) => SYMBOL_ORDER.indexOf(a) - SYMBOL_ORDER.indexOf(b));
  return symbols.join("") + key;
}
