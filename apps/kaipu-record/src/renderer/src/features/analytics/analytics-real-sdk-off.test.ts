import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SLOW,
  allowJsdomUserAgent,
  cleanUpRealSdk,
  decode,
  installNetwork,
  isCapture,
  isFlags,
  loadClient,
  prepareRealSdk,
  settle,
} from "./analytics-real-sdk-harness";

// One file per case: posthog-js is a singleton that a second init in the same file would reuse.
describe("real posthog-js, preference off (NIW2-849)", () => {
  beforeEach(prepareRealSdk);
  afterEach(cleanUpRealSdk);

  it(
    "loads flags under the device id and sends no event and no crash report",
    async () => {
      const sent = installNetwork();
      // An earlier run left the first page's URL in PostHog's storage, under a home folder.
      localStorage.setItem(
        "ph_phc_test_posthog",
        JSON.stringify({
          $initial_person_info: {
            r: "$direct",
            u: "file:///C:/Users/Ana%20Perez/AppData/Local/Programs/Kaipu%20Record/index.html",
          },
        }),
      );
      const client = await loadClient();
      client.setAnalyticsEnabled(false, "device-abc");
      await allowJsdomUserAgent();
      client.captureEvent("recording_started", { mode: "screen" });
      client.captureException(new Error("open '/Users/ana/Movies/a.mp4' failed"), { origin: "t" });
      // What the SDK emits on its own, past the app's guard: an uncaught error.
      // The SDK hooks `window.onerror`; calling it is what the browser does for an uncaught error,
      // without jsdom reporting that error to the test runner.
      const message = "open '/Users/ana/Movies/a.mp4' failed";
      window.onerror?.(message, "", 1, 1, new Error(message));
      await settle();

      const flags = sent.filter(isFlags);
      expect(flags.length).toBeGreaterThan(0);
      expect(decode(flags[0])).toContain("device-abc");
      // The flags request carries the stored first-page URL, with the home folder removed.
      expect(decode(flags[0])).toContain("$initial_current_url");
      expect(decode(flags[0])).not.toContain("Ana");
      expect(sent.filter(isCapture)).toEqual([]);
      expect(sent.map(decode).join("")).not.toContain("recording_started");
      expect(sent.map(decode).join("")).not.toContain("$exception");
    },
    SLOW,
  );
});
