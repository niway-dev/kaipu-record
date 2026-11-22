import { catalog, type Step } from "../types";
import { nc } from "./not-capturable";

const page: Step = { navigate: "/settings/app" };
const dock = (on: boolean): Step => ({ call: "updateSettings", args: [{ showInDock: on }] });

/** Settings → App (`#/settings/app`): the Dock, the first-run replay, diagnostics and updates. */
export const settingsApp = catalog(
  "settingsApp",
  {
    default: {
      profile: "default",
      how: "Open the page: Kaipu shows in the Dock, and no update is waiting.",
      steps: [page],
      demonstrates: [
        "settingsApp.page:default",
        "settingsApp.app:default",
        "settingsApp.privacy:default",
        "settingsApp.updates:idle",
      ],
      gates: [{ setting: "showInDock", side: "on" }],
    },
    "dock-off": {
      profile: "default",
      steps: [dock(false), page],
      demonstrates: ["settingsApp.app:default"],
      gates: [{ setting: "showInDock", side: "off" }],
      after: [dock(true)],
    },
  },
  {
    notCapturable: {
      "settingsApp.adminMode:on": nc(
        "needsApi",
        "needs an account with the admin permission; the catalog runs signed out against no API",
      ),
      "settingsApp.adminMode:restartPending": nc(
        "needsApi",
        "needs an account with the admin permission, and a preference that differs from the launch mode",
      ),
      "settingsApp.updates:available": nc(
        "needsApi",
        "needs an update feed; an unpackaged build has none (the Developer page that forces it is not in a production build)",
      ),
      "settingsApp.updates:ready": nc(
        "needsApi",
        "needs a downloaded update; an unpackaged build has no update feed",
      ),
    },
  },
);
