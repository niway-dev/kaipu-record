/**
 * The global keyboard shortcuts, and the one place their default bindings live.
 *
 * Why here: the desktop app registers them and the marketing site prints them,
 * and those are two different apps. The web cannot import from
 * `apps/kaipu-record`, so before this existed the landing carried the glyphs as
 * typed characters — and all three of them were wrong (it advertised ⌘⇧P for a
 * shortcut that is ⌘⌃C). Nothing failed, because nothing was comparing them.
 * Domain is pure and both apps can depend on it, so one definition removes the
 * class of bug rather than the instance.
 *
 * Only the pair *(action, default accelerator)* lives here. Labels,
 * descriptions and groups stay in the desktop app's `SHORTCUT_DEFINITIONS`:
 * they are UI copy with no reader on the web, and moving them would drag the
 * app's i18n into a pure package.
 */

export const SHORTCUT_ACTIONS = [
  "startRecording",
  "stopRecording",
  "bringToFront",
  "captureScreenshot",
] as const;

export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];

/**
 * Kaipu ships on macOS and the landing already says "Windows coming soon", so
 * the defaults are keyed by platform from the start rather than migrated later.
 */
export type ShortcutPlatform = "mac" | "windows";

/**
 * Electron accelerator strings. The desktop app registers these; the landing
 * renders them.
 *
 * The macOS family uses `Command+Control` because it avoids the combinations
 * macOS reserves (screenshots, VoiceOver's Control+Option) and the crowded
 * Command+Shift space browsers and editors lean on — which matters more than
 * usual here, since a global shortcut overrides whatever app is being recorded.
 *
 * Windows uses `Control+Alt` for the same intent. `CommandOrControl` was
 * rejected: it collapses to plain `Ctrl` on Windows, which would put Ctrl+C —
 * copy — on "start recording", globally.
 *
 * The Windows column is **unvalidated**. Nobody has tested these against
 * Windows' own reserved shortcuts, because there is no Windows build yet. It is
 * written so the shape is right and the gap is visible, not because the values
 * are confirmed.
 */
export const DEFAULT_ACCELERATORS: Record<ShortcutPlatform, Record<ShortcutAction, string>> = {
  mac: {
    startRecording: "Command+Control+C",
    stopRecording: "Command+Control+S",
    bringToFront: "Command+Control+O",
    captureScreenshot: "Command+Control+X",
  },
  windows: {
    startRecording: "Control+Alt+C",
    stopRecording: "Control+Alt+S",
    bringToFront: "Control+Alt+O",
    captureScreenshot: "Control+Alt+X",
  },
};

/** Electron modifier name → the symbol a person reads on that platform. */
const GLYPHS: Record<ShortcutPlatform, Record<string, string>> = {
  mac: {
    Command: "⌘",
    Cmd: "⌘",
    Control: "⌃",
    Ctrl: "⌃",
    Alt: "⌥",
    Option: "⌥",
    Shift: "⇧",
  },
  // Windows spells its modifiers out; there is no established glyph set, and
  // inventing one would read as mojibake rather than as a shortcut.
  windows: {},
};

/**
 * Render an accelerator the way the platform writes it: `Command+Control+C`
 * becomes `⌘⌃C` on macOS and stays `Ctrl+Alt+C` on Windows.
 *
 * Unknown parts pass through unchanged rather than being dropped, so a binding
 * this function does not recognise still shows something true.
 */
export function formatAccelerator(accelerator: string, platform: ShortcutPlatform = "mac"): string {
  const glyphs = GLYPHS[platform];
  const parts = accelerator.split("+").map((part) => glyphs[part] ?? part);
  // macOS writes modifiers with no separator; Windows keeps the plus signs.
  return platform === "mac" ? parts.join("") : parts.join("+");
}
