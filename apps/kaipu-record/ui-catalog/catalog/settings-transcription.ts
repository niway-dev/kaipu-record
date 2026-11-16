import { catalog, type Step } from "../types";
import { nc } from "./not-capturable";

const page: Step = { navigate: "/settings/transcription" };

/**
 * Settings → Transcription (`#/settings/transcription`), behind the `transcription` flag, which
 * the `transcription` profile forces on. The page's own look is the one state below. The model
 * offer inside it follows what main reports about the speech model and the engine, and the
 * catalog has no hook that pins either, so its five looks are declared, not shot. Each one is
 * pinned by `model-offer.test.tsx` in the meantime.
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
  },
  {
    notCapturable: {
      "settingsTranscription.model:missing": nc(
        "needsSetup",
        "shown only on a Mac the engine runs on with no model installed; the catalog cannot pin the engine's availability or the model's state, so the runner would show whichever it happens to be",
      ),
      "settingsTranscription.model:downloading": nc(
        "transient",
        "a real download of about 640 MB in flight; a test-only hold that pins progress is not built",
      ),
      "settingsTranscription.model:ready": nc(
        "needsSetup",
        "needs the 640 MB model installed in the profile's user data; the catalog seeds no model",
      ),
      "settingsTranscription.model:failed": nc(
        "inducedFailure",
        "needs a download that fails on purpose (offline, a corrupt file or a full disk)",
      ),
      "settingsTranscription.model:unavailable": nc(
        "platform",
        "the engine cannot run only on an unsupported platform or with the engine binary missing or broken; the mini runs it",
      ),
    },
    oneSided: {
      "settingsTranscription.page":
        "with the flag off the nav entry is not drawn and the route redirects to General, so the page has no look of its own",
    },
  },
);
