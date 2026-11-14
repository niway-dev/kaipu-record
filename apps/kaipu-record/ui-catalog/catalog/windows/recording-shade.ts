import { catalog, type Step } from "../../types";
import { nc } from "../not-capturable";

/**
 * The overlay's own start. Its countdown runs on the widget (ADR 0056), so the shade shows no
 * countdown here, only the border once the take starts.
 */
const fromOverlay = (mode: string): Step[] => [
  { call: "requestRecordSelector", args: [mode], on: "main" },
  { waitFor: { window: "capture-overlay" } },
  { waitMs: 500 },
  { press: "Enter", on: "capture-overlay" },
];

/**
 * The full-display shade (`?window=recording-shade`): the countdown before a take and the
 * border around what is being recorded. Prewarmed hidden; only a real take shows it.
 */
export const recordingShade = catalog(
  "recordingShade",
  {
    "border-display": {
      profile: "recording",
      how: "Start a take of the first display: the shade draws its border.",
      steps: [
        { action: "selectFirstScreen" },
        { action: "startTake" },
        { waitFor: { area: "recordingShade.displayBorder" } },
      ],
      demonstrates: ["recordingShade.displayBorder:fullDisplay"],
      after: [{ action: "stopTake" }],
    },
    "border-area": {
      profile: "recording",
      how: "Open the overlay to record in Frame mode and press Enter: the shade borders that area.",
      steps: [
        ...fromOverlay("frame"),
        { waitFor: { area: "recordingShade.areaBorder" }, timeoutMs: 15_000 },
      ],
      demonstrates: ["recordingShade.areaBorder:area"],
      after: [{ action: "stopTake" }],
    },
  },
  {
    notCapturable: {
      "recordingShade.countdown:area": nc(
        "needsSetup",
        "no product path starts it today: the shade counts down only when main gets a record answer without `countdownDone`, and every overlay start now counts on the widget (ADR 0056) or has no countdown. Follow-up: remove the shade countdown and this area",
      ),
      "recordingShade.countdown:fullDisplay": nc(
        "needsSetup",
        "same reason: Screen mode always opens the overlay, so no start reaches the shade's full-display countdown",
      ),
    },
    oneSided: {
      "recordingShade.countdown": "with `recordingCountdownSeconds` 0 there is no countdown",
    },
  },
);
