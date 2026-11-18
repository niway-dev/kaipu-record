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
      // The router keeps the item id in the hash, and a local id spells the recording's name.
      window.location.hash = "#/library/Q3%20board%20call";
      const client = await loadClient();
      client.setAnalyticsEnabled(true, "device-abc");
      await allowJsdomUserAgent();
      client.captureEvent("recording_started", { mode: "screen" });
      client.captureException(new Error("open '/Users/ana/Movies/a.mp4' failed"), { origin: "t" });
      // The same uncaught error the "off" test sends through the SDK's own hook.
      const message = "open '/Users/ana/Movies/b.mp4' failed";
      window.onerror?.(message, "", 1, 1, new Error(message));
      await settle();

      const events = sent
        .filter((s) => !isFlags(s))
        .map(decode)
        .join("");
      expect(events).toContain("recording_started");
      expect(events).toContain("$exception");
      // The uncaught error reaches PostHog on its own, so the "off" test can fail on it.
      expect(events).toContain('"handled":false');
      expect(events).toContain("$current_url");
      expect(events).not.toMatch(/Q3(%20| )board/);
      expect(events).not.toContain("/Users/ana");
      expect(events).toContain("<user-path>");
    },
    SLOW,
  );
});
