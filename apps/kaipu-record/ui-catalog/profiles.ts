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
  /** `dismiss` (default) clicks "Skip setup"; `keep` leaves the first-run takeover up. */
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
