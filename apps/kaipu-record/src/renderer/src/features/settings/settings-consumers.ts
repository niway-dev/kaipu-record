import type { WindowKind } from "@shared/ui-map";
import type { AppSettings } from "@shared/types";

/**
 * Every renderer file that reads the window's settings store (ADR 0063), and what each one reads.
 *
 * This is the one list. The renderer's windows each hold their own copy of the settings, kept
 * current by main's broadcast, so a change in main reaches a consumer only if main broadcasts it
 * and the consumer follows the store. Two tests keep this honest:
 *
 * - `settings-consumers.test.ts` scans the renderer and fails when a file imports the store (or
 *   `useAppSettings`) and is not listed here, or when a listed file stopped importing it.
 * - `settings-consumers.behaviour.test.tsx` fails when a listed consumer has no behaviour case,
 *   and each case broadcasts a change of the consumer's keys and asserts it followed.
 *
 * To add a consumer: import the store, add an entry, add its behaviour case (or point at the
 * existing test that already broadcasts the key).
 *
 * Renderer code, not `src/shared`: nothing here reaches the preload bundle.
 */

/** `main` is the full app window; the rest are the floating windows (`?window=` kinds). */
export type SettingsWindow = "main" | WindowKind;

const ALL_WINDOWS: readonly SettingsWindow[] = [
  "main",
  "capture-panel",
  "control-bar",
  "camera-bubble",
  "capture-overlay",
  "capture-toast",
  "recording-ready",
  "recording-shade",
];

export interface SettingsConsumer {
  /** Path relative to `renderer/src`. */
  readonly file: string;
  /** The windows the file runs in (from who imports it; `ALL_WINDOWS` when `main.tsx` does). */
  readonly windows: readonly SettingsWindow[];
  /** The `AppSettings` keys it reads, or "all" for the generic reader. */
  readonly keys: readonly (keyof AppSettings)[] | "all";
  /**
   * `live`: follows every broadcast while mounted. `once`: reads the value when it starts and
   * keeps it (a short-lived window or a one-shot read).
   */
  readonly follows: "live" | "once";
  /** One line: what the consumer does with the value. */
  readonly why: string;
  /**
   * Where a change of `keys` is shown to reach it: `here` is a case in
   * `settings-consumers.behaviour.test.tsx`; otherwise an existing test that already does, and
   * the names it must mention (the key, or the helper that pushes the change).
   */
  readonly behaviour: "here" | { readonly coveredIn: string; readonly mentions: readonly string[] };
}

export const BEHAVIOUR_TEST = "features/settings/settings-consumers.behaviour.test.tsx";

export const SETTINGS_CONSUMERS: readonly SettingsConsumer[] = [
  {
    file: "app/i18n-root.tsx",
    windows: ALL_WINDOWS,
    keys: ["locale", "theme"],
    follows: "live",
    why: "Sets the document language and theme, and tells the i18n provider when the locale changes.",
    behaviour: { coveredIn: "app/i18n-root.test.tsx", mentions: ["theme", "broadcast"] },
  },
  {
    file: "features/analytics/use-init-analytics.ts",
    windows: ["main"],
    keys: ["diagnosticsEnabled", "deviceId"],
    follows: "live",
    why: "Turns analytics on or off, and gives the SDK the device id, without a restart.",
    behaviour: {
      coveredIn: "features/analytics/use-init-analytics.test.tsx",
      mentions: ["diagnosticsEnabled", "broadcast"],
    },
  },
  {
    file: "features/recording/recorder-store.ts",
    // `app/i18n-root.tsx` imports it, so every window loads the module and primes the store.
    windows: ALL_WINDOWS,
    keys: ["audio"],
    follows: "live",
    why: "Primes the store at import and keeps the newest audio settings for a take, live and for changes made before the engine existed.",
    behaviour: {
      coveredIn: "features/recording/recorder-store.test.ts",
      mentions: ["audio", "broadcast"],
    },
  },
  {
    file: "features/recording/hooks/use-recording-setup.ts",
    windows: ["main", "capture-panel"],
    keys: ["recordingQuality", "audio", "cameraBubble", "microphone"],
    follows: "live",
    why: "Holds the quality, audio, camera bubble and preferred microphone the next take starts with.",
    behaviour: {
      coveredIn: "features/recording/hooks/use-recording-setup.test.tsx",
      mentions: ["recordingQuality", "broadcast"],
    },
  },
  {
    file: "features/recording/hooks/use-recording-mode.ts",
    windows: ["main", "capture-panel"],
    keys: ["recordingMode", "recordingArea"],
    follows: "live",
    why: "The last used recording mode and remembered area, shared by the Record page and the tray panel.",
    behaviour: "here",
  },
  {
    file: "features/screenshots/use-screenshot-mode.ts",
    windows: ["main", "capture-panel"],
    keys: ["screenshotMode"],
    follows: "live",
    why: "The screenshot capture mode chip.",
    behaviour: "here",
  },
  {
    file: "features/watermark/use-watermark.ts",
    windows: ["main", "capture-panel"],
    keys: ["showBrandBadge"],
    follows: "live",
    why: "Whether the Made with Kaipu badge is burned into a take.",
    behaviour: {
      coveredIn: "features/watermark/use-watermark-store.test.tsx",
      mentions: ["showBrandBadge", "broadcast"],
    },
  },
  {
    file: "features/audio-settings/use-audio-settings.ts",
    windows: ["main"],
    keys: ["audio"],
    follows: "live",
    why: "The mic level, noise suppression and system audio controls on the Record page.",
    behaviour: "here",
  },
  {
    file: "features/camera-settings/use-camera-settings.ts",
    windows: ["main"],
    keys: ["cameraBubble"],
    follows: "live",
    why: "The camera bubble's shape, size, mirroring and framing controls.",
    behaviour: "here",
  },
  {
    file: "features/camera-bubble/camera-bubble.tsx",
    windows: ["camera-bubble"],
    keys: ["cameraBubble"],
    follows: "live",
    why: "The floating bubble's camera, shape, corner, mirroring and zoom.",
    behaviour: {
      coveredIn: "features/camera-bubble/camera-bubble.test.tsx",
      mentions: ["cameraBubble", "live change"],
    },
  },
  {
    file: "features/shortcuts/use-shortcut-labels.ts",
    windows: ["main", "capture-panel", "control-bar"],
    keys: ["shortcuts"],
    follows: "live",
    why: "The shortcut labels shown around the UI, including the always-alive control bar.",
    behaviour: {
      coveredIn: "features/shortcuts/use-shortcut-labels.test.tsx",
      mentions: ["shortcuts", "broadcast"],
    },
  },
  {
    file: "features/onboarding/steps/shortcuts-step.tsx",
    windows: ["main"],
    keys: ["shortcuts"],
    follows: "live",
    why: "The key caps on the onboarding shortcuts step.",
    behaviour: "here",
  },
  {
    file: "features/onboarding/use-share-usage-preference.ts",
    windows: ["main"],
    keys: ["diagnosticsEnabled"],
    follows: "live",
    why: "The onboarding Share usage switch, which must show what main confirmed.",
    behaviour: "here",
  },
  {
    file: "features/screenshots/overlay/use-widget-devices.ts",
    windows: ["capture-overlay"],
    keys: ["cameraBubble"],
    follows: "live",
    why: "The camera the overlay's widget shows; one overlay per display follows a pick made in another.",
    behaviour: {
      coveredIn: "features/screenshots/overlay/use-widget-devices.test.tsx",
      mentions: ["cameraBubble", "broadcast"],
    },
  },
  {
    file: "features/screenshots/overlay/use-widget-expanded.ts",
    windows: ["capture-overlay"],
    keys: ["captureWidget"],
    follows: "live",
    why: "Whether the capture toolbar is compact or expanded, per capture type; one overlay per display follows a toggle made in another.",
    behaviour: {
      coveredIn: "features/screenshots/overlay/use-widget-expanded.test.tsx",
      mentions: ["captureWidget", "broadcast"],
    },
  },
  {
    file: "features/screenshots/overlay/capture-overlay.tsx",
    windows: ["capture-overlay"],
    keys: ["recordingCountdownSeconds", "recordingArea", "screenshotFrame"],
    follows: "once",
    why: "The countdown length and the remembered area, read once when the overlay opens; a save merges into the window's copy.",
    behaviour: {
      coveredIn: "features/screenshots/overlay/capture-overlay.test.tsx",
      mentions: ["recordingCountdownSeconds", "recordingArea"],
    },
  },
  {
    file: "features/screenshots/overlay/use-overlay-toggles.ts",
    windows: ["capture-overlay"],
    keys: ["cameraBubble"],
    follows: "once",
    why: "The bubble's size, shape and corner for the overlay's camera placeholder, read once.",
    behaviour: "here",
  },
  {
    file: "pages/settings/use-app-settings.ts",
    windows: ["main"],
    keys: "all",
    follows: "live",
    why: "The generic reader and writer behind every Settings page and several hooks.",
    behaviour: {
      coveredIn: "pages/settings/use-app-settings.test.tsx",
      mentions: ["broadcast"],
    },
  },
  {
    file: "pages/settings/countdown-settings.tsx",
    windows: ["main"],
    keys: ["recordingCountdownSeconds"],
    follows: "live",
    why: "The countdown length radio group.",
    behaviour: "here",
  },
  {
    file: "pages/settings/diagnostics-settings.tsx",
    windows: ["main"],
    keys: ["diagnosticsEnabled"],
    follows: "live",
    why: "The Share usage and crash reports switch in Settings.",
    behaviour: "here",
  },
  {
    file: "pages/settings/screenshot-after-capture-settings.tsx",
    windows: ["main"],
    keys: ["screenshotAfterCapture"],
    follows: "live",
    why: "The After capturing select.",
    behaviour: "here",
  },
  {
    file: "pages/settings/settings-pages.tsx",
    windows: ["main"],
    keys: ["theme", "showRecordingSavedCard", "showBarInRecording", "showInDock"],
    follows: "live",
    why: "The General, Recording and Files pages' theme, ready card, recording bar and Dock rows.",
    behaviour: {
      coveredIn: "pages/settings/use-app-settings.test.tsx",
      mentions: ["broadcast"],
    },
  },
  {
    file: "pages/settings/scope/settings-scope.tsx",
    windows: ["main"],
    keys: "all",
    follows: "live",
    why: "Reads the scoped settings again on a change from any window (an override, an answer, a switch).",
    behaviour: {
      coveredIn: "pages/settings/scope/settings-scope.test.tsx",
      mentions: ["pushSettings", "screenshotCopy"],
    },
  },
  {
    file: "pages/settings/scope/scope-controls.tsx",
    windows: ["main"],
    keys: "all",
    follows: "live",
    why: "The pending workspace-file prompt reads the scoped settings again on every broadcast.",
    behaviour: {
      coveredIn: "pages/settings/scope/settings-scope.test.tsx",
      mentions: ["pushSettings", "PendingSettingsHost"],
    },
  },
  {
    file: "pages/cloud/cloud-page.tsx",
    windows: ["main"],
    keys: ["uploadMode"],
    follows: "live",
    why: "The save mode shown on the Cloud page.",
    behaviour: {
      coveredIn: "pages/settings/use-app-settings.test.tsx",
      mentions: ["broadcast"],
    },
  },
  {
    file: "pages/shortcuts/shortcuts-page.tsx",
    windows: ["main"],
    keys: ["shortcuts"],
    follows: "live",
    why: "The bindings the Shortcuts page shows and edits.",
    behaviour: {
      coveredIn: "pages/settings/use-app-settings.test.tsx",
      mentions: ["broadcast"],
    },
  },
  {
    file: "pages/library-detail/library-detail-page.tsx",
    windows: ["main"],
    keys: ["showRecordingSavedCard"],
    follows: "live",
    why: "Whether a fresh recording shows the Your video is ready card.",
    behaviour: {
      coveredIn: "pages/settings/use-app-settings.test.tsx",
      mentions: ["broadcast"],
    },
  },
  {
    file: "pages/video-editor/video-editor-page.tsx",
    windows: ["main"],
    keys: ["exportQuality", "editor"],
    follows: "live",
    why: "The default export preset and the hidden timeline tracks.",
    behaviour: {
      coveredIn: "pages/settings/use-app-settings.test.tsx",
      mentions: ["broadcast"],
    },
  },
];
