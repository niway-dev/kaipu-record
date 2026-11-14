import type { FlagOverrides } from "../src/shared/flag-overrides";
import type { Requires } from "./types";

/**
 * Named launch profiles. The runner groups catalog states by profile and launches the app
 * once per profile, in the order below, with a throwaway userData and vault.
 *
 * Most gates do not need a profile of their own: a setting is flipped at runtime with
 * `call updateSettings`, a recording setting with `call updateRecordingSettings`, and the
 * state's `after` puts it back. A profile is for what only exists at launch: the vault's
 * content, a feature-flag override, onboarding left up, screen capture allowed.
 */
export interface Profile {
  readonly description: string;
  /** Merged over `{ locale: "en" }` into `settings.json`. Dark is the app's default theme. */
  readonly settings?: Readonly<Record<string, unknown>>;
  /** The vault's content (`fixtures/seed-vault.ts`). */
  readonly seed: "demo" | "empty" | "missing";
  /** Add the recording that carries a native cursor track (a take made with the flag on). */
  readonly cursorRecording?: boolean;
  /** Add the screenshot that draws real text (`fixtures/text/`), for the Select text states. */
  readonly textScreenshot?: boolean;
  /** Add the screenshots the Colors panel states open (`fixtures/make-fixtures.ts`). */
  readonly colorsScreenshots?: boolean;
  /** Add the screenshot saved with one locked redaction (`seed-vault.ts`), for the Permanent tag. */
  readonly lockedRedaction?: boolean;
  /** Add the screenshots of the step badge and Redact card states (`seed-vault.ts`). */
  readonly mockShots?: boolean;
  /** Add the P3 swatch sheet and a private copy of “Settings page” (`seed-vault.ts`). */
  readonly inspectShots?: boolean;
  /** Leave an unparseable canvas document beside "Settings page" (`seed-vault.ts`). */
  readonly corruptCanvas?: boolean;
  /** Seed something "Check and fix files" reports (`seed-vault.ts`). */
  readonly reconcile?: "fixable" | "attention";
  /** Forced feature flags, passed as `KAIPU_FLAG_OVERRIDES` (ignored by packaged builds). */
  readonly flags?: FlagOverrides;
  readonly env?: Readonly<Record<string, string>>;
  /**
   * `KAIPU_DISABLE_SCREEN_CAPTURE=1` unless false. Only the profile that needs a real take or
   * the capture overlay turns it off; it runs last (spec failure 11).
   */
  readonly disableScreenCapture?: boolean;
  /** `dismiss` (default) closes it with Escape; `keep` leaves the first-run takeover up. */
  readonly onboarding?: "dismiss" | "keep";
  /** Permissions every state of the profile needs; else they are reported not capturable. */
  readonly requires?: Requires;
  /**
   * Cover the runner's display with the countdown fixture, below the app's windows, so what a
   * take records, the source picker's thumbnails and a screen capture show neutral pixels
   * instead of whatever is on the runner's desktop (spec failure 2).
   */
  readonly neutralBackdrop?: boolean;
  /** Per-state budget in this profile, ms (a real take is slower than a click). */
  readonly stateTimeoutMs?: number;
}

export const PROFILES = {
  onboarding: {
    description: "First launch: the onboarding takeover is left up.",
    seed: "demo",
    onboarding: "keep",
  },
  default: {
    description: "The demo workspace, onboarding skipped, screen capture off.",
    seed: "demo",
  },
  empty: {
    description: "A workspace with nothing in it.",
    seed: "empty",
  },
  "reconcile-fixable": {
    description: "The demo workspace plus one file whose name does not match its title.",
    seed: "demo",
    reconcile: "fixable",
  },
  "reconcile-attention": {
    description: "The demo workspace plus one recording whose record cannot be read.",
    seed: "demo",
    reconcile: "attention",
  },
  disconnected: {
    description: "The workspace folder is missing at launch (an unplugged drive).",
    seed: "missing",
  },
  "cursor-flag": {
    description:
      "Flag native-cursor-capture forced on; the vault adds a recording made with it (a native cursor track).",
    seed: "demo",
    cursorRecording: true,
    flags: { "native-cursor-capture": true },
  },
  "image-canvas": {
    description:
      "Flag image-canvas forced on: the image editor's content-box canvas, pan, zoom and export frame.",
    seed: "demo",
    flags: { "image-canvas": true },
  },
  "image-canvas-saved": {
    description:
      "Flag image-canvas forced on, and the vault adds “Saved redaction”, a screenshot saved with one redaction: its Permanent tag. A profile of its own, so the Library picker of the other canvas states still lists the same screenshots.",
    seed: "demo",
    flags: { "image-canvas": true },
    lockedRedaction: true,
  },
  "image-canvas-unreadable": {
    description:
      "Flag image-canvas forced on, and the canvas document beside “Settings page” is corrupt: reopening it opens the flat image.",
    seed: "demo",
    flags: { "image-canvas": true },
    corruptCanvas: true,
  },
  "timeline-levels": {
    description:
      "Flag timeline-levels forced on: the video editor's Captures panel shows Add to timeline on each capture.",
    seed: "demo",
    flags: { "timeline-levels": true },
  },
  "image-inspect": {
    description:
      "Flag image-inspect forced on: the image editor's Inspect mode (loupe, live colour, format bar).",
    seed: "demo",
    flags: { "image-inspect": true },
    colorsScreenshots: true,
    inspectShots: true,
  },
  "image-text": {
    description:
      "Flag image-text forced on: the image editor's Select text tool and text recognition.",
    seed: "demo",
    flags: { "image-text": true },
    textScreenshot: true,
  },
  "image-text-canvas": {
    description:
      "Flags image-text and image-canvas forced on: the redact tool's one-click hide of recognized text.",
    seed: "demo",
    flags: { "image-text": true, "image-canvas": true },
    textScreenshot: true,
  },
  "image-text-slow": {
    description:
      "Like image-text, with text recognition held for 60 s (KAIPU_TEXT_RECOGNITION=delay:60000, unpackaged builds only): the pending states.",
    seed: "demo",
    flags: { "image-text": true },
    textScreenshot: true,
    env: { KAIPU_TEXT_RECOGNITION: "delay:60000" },
  },
  "image-text-unavailable": {
    description:
      "Like image-text, with text recognition answering unavailable (KAIPU_TEXT_RECOGNITION=unavailable, unpackaged builds only): a computer that cannot read text.",
    seed: "demo",
    flags: { "image-text": true },
    textScreenshot: true,
    env: { KAIPU_TEXT_RECOGNITION: "unavailable" },
  },
  "image-toolbar": {
    description:
      "Flags image-canvas, image-inspect and image-text forced on together: the image editor's whole toolbar (mode switch, Export frame, Add image, Select text).",
    seed: "demo",
    flags: { "image-canvas": true, "image-inspect": true, "image-text": true },
  },
  "image-mocks": {
    description:
      "Flags image-canvas, image-inspect and image-text forced on, and the vault adds five screenshots of its own (Steps demo, Step selected, Step sizes, Redaction demo, Notice demo): the step badge, Redact card and redaction notice states, each editing its own item. A profile of its own, so the Library picker of the other toolbar states lists the same screenshots.",
    seed: "demo",
    flags: { "image-canvas": true, "image-inspect": true, "image-text": true },
    mockShots: true,
  },
  exporting: {
    description:
      "The demo workspace; states here start real exports of its short recording, so the vault ends up holding the copies.",
    seed: "demo",
  },
  recording: {
    description:
      "Screen capture allowed (no KAIPU_DISABLE_SCREEN_CAPTURE): real takes and the capture overlay. Runs last.",
    seed: "demo",
    disableScreenCapture: false,
    requires: { screen: true },
    neutralBackdrop: true,
    stateTimeoutMs: 30_000,
    // A take's countdown is shorter with the minimum the setting allows.
    settings: { recordingCountdownSeconds: 3 },
    flags: { "capture-while-recording": true },
  },
} as const satisfies Record<string, Profile>;

export type ProfileName = keyof typeof PROFILES;

/** Launch order: object order, which keeps `recording` last. */
export const PROFILE_ORDER = Object.keys(PROFILES) as ProfileName[];

export function profileOf(name: ProfileName): Profile {
  return PROFILES[name];
}
