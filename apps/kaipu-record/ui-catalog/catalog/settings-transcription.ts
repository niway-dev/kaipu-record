import { catalog, type Step } from "../types";

const page: Step = { navigate: "/settings/transcription" };

/**
 * Settings → Transcription (`#/settings/transcription`), behind the `transcription` flag, which
 * the `transcription` profile forces on. The page's own look is the `page` state. The model
 * offer inside it follows what main reports about the speech model and the engine, so each of
 * its five looks has a profile that pins it with `KAIPU_TRANSCRIPTION` (unpackaged builds only;
 * see `src/main/transcription/dev-override.ts`). While pinned, nothing downloads or is removed.
 */
export const settingsTranscription = catalog(
  "settingsTranscription",
  {
    page: {
      profile: "transcription",
      how: "With the flag forced on, open the page: the heading, its subtitle and the Speech model section.",
      steps: [page],
      demonstrates: ["settingsTranscription.page:default"],
      gates: [{ flag: "transcription", side: "on" }],
    },
    "model-missing": {
      profile: "transcription-missing",
      how: "With the flag forced on and the model pinned as not installed, open the page: the Speech model section carries the “Not installed” badge, the download size and folder, and a Download button.",
      steps: [page],
      demonstrates: ["settingsTranscription.model:missing"],
      gates: [{ flag: "transcription", side: "on" }],
    },
    "model-downloading": {
      profile: "transcription-downloading",
      how: "With the flag forced on and the download pinned at 42%, open the page: the Speech model section carries the “Downloading” badge, a progress bar and a Cancel button.",
      steps: [page],
      demonstrates: ["settingsTranscription.model:downloading"],
      gates: [{ flag: "transcription", side: "on" }],
    },
    "model-ready": {
      profile: "transcription-ready",
      how: "With the flag forced on and the model pinned as installed, open the page: the Speech model section carries the “Installed” badge, “Installed. Transcribing runs on this Mac, offline.” and a Remove button.",
      steps: [page],
      demonstrates: ["settingsTranscription.model:ready"],
      gates: [{ flag: "transcription", side: "on" }],
    },
    "model-failed": {
      profile: "transcription-failed",
      how: "With the flag forced on and the download pinned as failed, open the page: the Speech model section carries the “Download failed” badge, the error text and a Try again button.",
      steps: [page],
      demonstrates: ["settingsTranscription.model:failed"],
      gates: [{ flag: "transcription", side: "on" }],
    },
    "model-unavailable": {
      profile: "transcription-unavailable",
      how: "With the flag forced on and the engine pinned as unable to run here, open the page: the Speech model section carries the “Not available” badge and says local transcription is not available on this Mac or platform yet.",
      steps: [page],
      demonstrates: ["settingsTranscription.model:unavailable"],
      gates: [{ flag: "transcription", side: "on" }],
    },
  },
  {
    oneSided: {
      "settingsTranscription.page":
        "with the flag off the nav entry is not drawn and the route redirects to General, so the page has no look of its own",
    },
  },
);
