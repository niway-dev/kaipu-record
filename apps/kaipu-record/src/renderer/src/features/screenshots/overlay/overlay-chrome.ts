import type { CaptureIntent, CaptureMode } from "@shared/types/screenshot-capture";
import type { InputToggleKey, KeyPlatform } from "./overlay-keys";
import type { OverlayToggles } from "./use-overlay-toggles";
import type { WidgetDevices } from "./use-widget-devices";

/** What a key toggle shows for 1.5 s above the widget: "✓ Microphone on [M]". */
export interface InputToast {
  /** Changes on every toggle, so a repeated toggle restarts the toast and the halo. */
  id: number;
  input: InputToggleKey;
  on: boolean;
}

/** What every mode's UI needs to draw the widget and to switch mode. */
export interface OverlayChrome {
  mode: CaptureMode;
  /** The modes the widget offers, in order (keys 1..n). */
  modes: readonly CaptureMode[];
  platform: KeyPlatform;
  /**
   * Why the overlay opened, then switched in place with P / V. `capture`: Capture is primary,
   * Copy to clipboard beside it. `record`: Record is primary and the inputs show.
   */
  intent: CaptureIntent;
  /** Switch every overlay to `mode` (the widget's Area segment, keys 1..n). */
  onMode(mode: CaptureMode): void;
  /** The widget's Cancel button: the same as Esc. */
  onCancel(): void;
  /** Switch between taking a screenshot and recording (the Capture as segment, keys P, V). */
  onIntent?(intent: CaptureIntent): void;
  /** Mic, System audio and Camera as main holds them. Absent outside the record intent. */
  toggles?: OverlayToggles;
  /** The devices the Microphone and Camera chevrons offer. Absent outside the record intent. */
  devices?: WidgetDevices;
  /** The last key toggle's toast, until it expires; `null` when none shows. */
  toast: InputToast | null;
  /** Seconds left of the countdown the overlay is running; `null` when it is not counting. */
  countdown: number | null;
  /** The configured countdown length, printed on the Record button; 0 means no countdown. */
  countdownSeconds: number;
  /** Cancel the overlay and open the Record settings in the main window ("More settings"). */
  onMoreSettings(): void;
}
