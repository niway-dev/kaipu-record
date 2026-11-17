import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SLOW,
  allowJsdomUserAgent,
  cleanUpRealSdk,
  decode,
  installNetwork,
  isFlags,
  loadClient,
  prepareRealSdk,
  settle,
} from "./analytics-real-sdk-harness";

// One file per case: posthog-js is a singleton that a second init in the same file would reuse.
describe("real posthog-js, preference on (NIW2-849)", () => {
  beforeEach(prepareRealSdk);
  afterEach(cleanUpRealSdk);

  it(
    "sends the event and the crash report, with personal paths removed",
    async () => {
      const sent = installNetwork();
      const client = await loadClient();
      client.setAnalyticsEnabled(true, "device-abc");
      await allowJsdomUserAgent();
      client.captureEvent("recording_started", { mode: "screen" });
      client.captureException(new Error("open '/Users/ana/Movies/a.mp4' failed"), { origin: "t" });
      await settle();

      const events = sent
        .filter((s) => !isFlags(s))
        .map(decode)
        .join("");
      expect(events).toContain("recording_started");
      expect(events).toContain("$exception");
      expect(events).not.toContain("/Users/ana");
      expect(events).toContain("<user-path>");
    },
    SLOW,
  );
});
