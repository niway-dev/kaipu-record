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
      const client = await loadClient();
      client.setAnalyticsEnabled(false, "device-abc");
      await allowJsdomUserAgent();
      client.captureEvent("recording_started", { mode: "screen" });
      client.captureException(new Error("open '/Users/ana/Movies/a.mp4' failed"), { origin: "t" });
      await settle();

      const flags = sent.filter(isFlags);
      expect(flags.length).toBeGreaterThan(0);
      expect(decode(flags[0])).toContain("device-abc");
      expect(sent.filter(isCapture)).toEqual([]);
      expect(sent.map(decode).join("")).not.toContain("recording_started");
      expect(sent.map(decode).join("")).not.toContain("$exception");
    },
    SLOW,
  );
});
