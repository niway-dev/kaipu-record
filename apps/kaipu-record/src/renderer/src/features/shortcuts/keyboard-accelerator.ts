/**
 * Pure helpers to translate between a browser KeyboardEvent, an Electron
 * accelerator string (e.g. "Command+Control+C"), and a display label: macOS glyphs
 * ("⌃⌘C") on macOS, text ("Ctrl+Alt+C") elsewhere. No Electron imports — safe in
 * the renderer and fully unit-testable. The functions that depend on the host OS
 * take it as a parameter, defaulting to the preload bridge's `platform`.
 */

export interface CapturedShortcut {
  /** Electron accelerator, e.g. "Command+Control+C". */
  accelerator: string;
  /** Display label for the platform, e.g. "⌃⌘C" (macOS) or "Ctrl+Alt+C" (Windows). */
  label: string;
}

/** The host OS from the preload bridge; macOS when there is no bridge (a bare test). */
function bridgePlatform(): string {
  return typeof window !== "undefined" ? (window.electronAPI?.platform ?? "darwin") : "darwin";
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
 * (required so a global shortcut never swallows plain typing). On Windows the
 * meta key is the Windows key, whose combinations the OS reserves, so a combo
 * that uses it is rejected there.
 */
export function captureShortcut(
  event: {
    code: string;
    key: string;
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
  },
  platform: string = bridgePlatform(),
): CapturedShortcut | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const token = keyToken(event.code);
  if (!token) return null;
  if (!event.metaKey && !event.ctrlKey) return null;
  if (platform === "win32" && event.metaKey) return null;

  const accelParts: string[] = [];
  if (event.metaKey) accelParts.push("Command");
  if (event.ctrlKey) accelParts.push("Control");
  if (event.altKey) accelParts.push("Alt");
  if (event.shiftKey) accelParts.push("Shift");
  accelParts.push(token);

  const accelerator = accelParts.join("+");
  return { accelerator, label: formatAccelerator(accelerator, platform) };
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

// Accelerator token → macOS glyph. Includes the cross-platform aliases for completeness.
const MAC_SYMBOLS: Record<string, string> = {
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

// macOS convention renders modifiers in this order, then the key, with no separator.
const MAC_ORDER = ["⌃", "⌥", "⇧", "⌘"];

// Accelerator token → Windows key name. `CommandOrControl` is Ctrl off macOS, and
// `Command` (the meta key) is the Windows key.
const TEXT_NAMES: Record<string, string> = {
  Command: "Win",
  Cmd: "Win",
  Super: "Win",
  Meta: "Win",
  CommandOrControl: "Ctrl",
  CmdOrCtrl: "Ctrl",
  Control: "Ctrl",
  Ctrl: "Ctrl",
  Alt: "Alt",
  Option: "Alt",
  Shift: "Shift",
};

// Windows convention: Ctrl, Alt, Shift, Win, then the key, joined with "+".
const TEXT_ORDER = ["Ctrl", "Alt", "Shift", "Win"];

/**
 * Render an Electron accelerator as a label for `platform`: macOS glyphs on macOS
 * ("Command+Control+C" → "⌃⌘C"), Windows-style text elsewhere
 * ("Control+Alt+C" → "Ctrl+Alt+C").
 */
export function formatAccelerator(
  accelerator: string,
  platform: string = bridgePlatform(),
): string {
  const mac = platform === "darwin";
  const names = mac ? MAC_SYMBOLS : TEXT_NAMES;
  const order = mac ? MAC_ORDER : TEXT_ORDER;
  const modifiers: string[] = [];
  let key = "";
  for (const part of accelerator.split("+")) {
    const name = names[part];
    if (!name) key = part;
    else if (!modifiers.includes(name)) modifiers.push(name);
  }
  modifiers.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (mac) return modifiers.join("") + key;
  return [...modifiers, key].filter(Boolean).join("+");
}
