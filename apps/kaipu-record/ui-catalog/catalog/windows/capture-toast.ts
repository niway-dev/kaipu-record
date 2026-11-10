import { catalog, type Step } from "../../types";
import { nc } from "../not-capturable";

/** With one display, Screen mode captures it at once: no overlay, no system selector. */
const captureScreen: Step = { call: "requestCaptureScreenshot", args: ["screen"], on: "main" };
const dismiss: Step = { press: "Escape" };
const set = (patch: Record<string, string>): Step => ({
  call: "updateSettings",
  args: [patch],
  on: "main",
});

/**
 * The quiet-capture toast (`?window=capture-toast`), shown after a capture with "preview" as
 * the after-capture action. The capture is of the runner's real display, so the toast's
 * thumbnail shows whatever the runner has on screen.
 */
export const captureToast = catalog(
  "captureToast",
  {
    taken: {
      profile: "recording",
      steps: [
        { action: "selectFirstScreen" },
        { action: "startTake" },
        { waitFor: { window: "control-bar" }, on: "main" },
        { waitFor: { area: "controlBar.screenshot" }, on: "control-bar" },
        { click: { area: "controlBar.screenshot" }, on: "control-bar" },
        { waitFor: { window: "capture-toast" } },
      ],
      demonstrates: ["captureToast.card:taken"],
      gates: [{ flag: "capture-while-recording", side: "on" }],
      after: [dismiss, { action: "stopTake" }],
    },
    saved: {
      profile: "recording",
      embedsScreen: true,
      how: "Capture the whole display in Screen mode (one display: no chooser).",
      steps: [captureScreen, { waitFor: { window: "capture-toast" } }],
      demonstrates: ["captureToast.root:saved", "captureToast.card:rest"],
      gates: [
        { setting: "screenshotAfterCapture", side: "preview" },
        { setting: "screenshotCopy", side: "auto" },
      ],
      after: [dismiss],
    },
    hover: {
      profile: "recording",
      embedsScreen: true,
      steps: [
        captureScreen,
        { waitFor: { window: "capture-toast" } },
        { hover: { area: "captureToast.card" } },
      ],
      demonstrates: ["captureToast.card:hover"],
      keepPointer: true,
      after: [dismiss],
    },
    manual: {
      profile: "recording",
      embedsScreen: true,
      steps: [
        set({ screenshotCopy: "manual" }),
        captureScreen,
        { waitFor: { window: "capture-toast" } },
      ],
      demonstrates: ["captureToast.card:rest"],
      gates: [{ setting: "screenshotCopy", side: "manual" }],
      after: [dismiss, set({ screenshotCopy: "auto" })],
    },
    copied: {
      profile: "recording",
      embedsScreen: true,
      how: "Open the overlay to capture a frame and press its Copy button.",
      steps: [
        { call: "requestCaptureScreenshot", args: ["frame"], on: "main" },
        { waitFor: { window: "capture-overlay" } },
        {
          click: {
            area: "captureOverlay.selectionToolbar",
            part: { role: "button", name: "Copy" },
          },
          on: "capture-overlay",
        },
        { waitFor: { window: "capture-toast" } },
      ],
      demonstrates: ["captureToast.card:copied"],
      after: [dismiss],
    },
  },
  {
    notCapturable: {
      "captureToast.root:notSaved": nc("inducedFailure", "needs a capture whose save fails"),
    },
    oneSided: {
      "captureToast.card":
        "with the after-capture action set to the editor, the capture opens there and no toast is drawn",
    },
  },
);
