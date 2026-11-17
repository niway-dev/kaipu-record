import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const posthog = vi.hoisted(() => {
  let optedOut = false;
  return {
    init: vi.fn(),
    register: vi.fn(),
    identify: vi.fn(),
    capture: vi.fn(),
    captureException: vi.fn(),
    isFeatureEnabled: vi.fn((): boolean | undefined => true),
    onFeatureFlags: vi.fn((_callback: () => void) => () => {}),
    opt_out_capturing: vi.fn(() => {
      optedOut = true;
    }),
    opt_in_capturing: vi.fn(() => {
      optedOut = false;
    }),
    has_opted_out_capturing: vi.fn(() => optedOut),
    /** Test hook: what PostHog's persisted consent says at launch. */
    persistOptOut: (value: boolean) => {
      optedOut = value;
    },
  };
});
vi.mock("posthog-js", () => ({ default: posthog }));

// Module state is per import, so each test loads a fresh copy.
async function loadClient(): Promise<typeof import("./analytics-client")> {
  vi.resetModules();
  return import("./analytics-client");
}

/** The config the SDK was initialized with. */
function initConfig(): Record<string, unknown> {
  return posthog.init.mock.calls[0][1] as Record<string, unknown>;
}

describe("setAnalyticsEnabled", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
    vi.clearAllMocks();
    posthog.persistOptOut(false);
    posthog.isFeatureEnabled.mockReturnValue(true);
  });
  afterEach(() => vi.unstubAllEnvs());

  describe("with the preference off at launch", () => {
    it("initializes PostHog opted out, under the device id, without identifying", async () => {
      const client = await loadClient();
      client.setAnalyticsEnabled(false, "device-1");

      expect(posthog.init).toHaveBeenCalledTimes(1);
      expect(initConfig().opt_out_capturing_by_default).toBe(true);
      expect(initConfig().bootstrap).toEqual({ distinctID: "device-1" });
      expect(posthog.identify).not.toHaveBeenCalled();
      expect(posthog.has_opted_out_capturing()).toBe(true);
    });

    it("sends no event and no exception", async () => {
      const client = await loadClient();
      client.setAnalyticsEnabled(false, "device-1");
      client.captureEvent("anything", { a: 1 });
      client.captureException(new Error("boom"), { origin: "test" });

      expect(posthog.capture).not.toHaveBeenCalled();
      expect(posthog.captureException).not.toHaveBeenCalled();
    });

    it("still reads remote flags", async () => {
      const client = await loadClient();
      client.setAnalyticsEnabled(false, "device-1");
      posthog.isFeatureEnabled.mockReturnValue(false);

      expect(client.isFlagEnabled("image-canvas", true)).toBe(false);
    });

    it("notifies a listener that subscribed before PostHog started", async () => {
      const client = await loadClient();
      const listener = vi.fn();
      const unsubscribe = client.onFlagsChanged(listener);
      client.setAnalyticsEnabled(false, "device-1");

      expect(posthog.onFeatureFlags).toHaveBeenCalledTimes(1);
      const notify = posthog.onFeatureFlags.mock.calls[0] as unknown as [() => void];
      notify[0]();
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
      notify[0]();
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("falls back to the default for a flag PostHog has not resolved", async () => {
      const client = await loadClient();
      client.setAnalyticsEnabled(false, "device-1");
      posthog.isFeatureEnabled.mockReturnValue(undefined);

      expect(client.isFlagEnabled("image-canvas", true)).toBe(true);
      expect(client.isFlagEnabled("image-canvas", false)).toBe(false);
    });

    it("opts capturing back in when the preference turns on after being off", async () => {
      const client = await loadClient();
      client.setAnalyticsEnabled(false, "device-1");
      client.setAnalyticsEnabled(true, "device-1");

      expect(posthog.init).toHaveBeenCalledTimes(1);
      expect(posthog.opt_in_capturing).toHaveBeenCalledTimes(1);
      expect(posthog.identify).toHaveBeenCalledWith("device-1");
      client.captureEvent("while-on");
      expect(posthog.capture).toHaveBeenCalledWith("while-on", undefined);
    });
  });

  describe("with the preference on at launch", () => {
    it("behaves as before: opted in, identified, events and exceptions sent", async () => {
      const client = await loadClient();
      client.setAnalyticsEnabled(true, "device-1");

      expect(posthog.init).toHaveBeenCalledTimes(1);
      expect(initConfig().opt_out_capturing_by_default).toBe(false);
      expect(posthog.register).toHaveBeenCalledTimes(1);
      expect(posthog.identify).toHaveBeenCalledWith("device-1");

      client.captureEvent("editor_opened", { editor: "video" });
      client.captureException(new Error("boom"), { origin: "test" });
      expect(posthog.capture).toHaveBeenCalledWith("editor_opened", { editor: "video" });
      expect(posthog.captureException).toHaveBeenCalledTimes(1);
    });

    it("lifts an opt-out PostHog persisted from an earlier launch", async () => {
      posthog.persistOptOut(true);
      const client = await loadClient();
      client.setAnalyticsEnabled(true, "device-1");

      expect(posthog.opt_in_capturing).toHaveBeenCalledTimes(1);
    });

    it("opts out when turned off, keeps flags, and opts back in when turned on", async () => {
      const client = await loadClient();
      client.setAnalyticsEnabled(true, "device-1");

      client.setAnalyticsEnabled(false, "device-1");
      client.captureEvent("while-off");
      expect(posthog.opt_out_capturing).toHaveBeenCalledTimes(1);
      expect(posthog.capture).not.toHaveBeenCalled();
      expect(client.isFlagEnabled("image-canvas", false)).toBe(true);

      client.setAnalyticsEnabled(true, "device-1");
      client.captureEvent("while-on");
      expect(posthog.init).toHaveBeenCalledTimes(1);
      expect(posthog.identify).toHaveBeenCalledTimes(1);
      expect(posthog.opt_in_capturing).toHaveBeenCalledTimes(1);
      expect(posthog.capture).toHaveBeenCalledWith("while-on", undefined);
    });

    it("ignores a repeated value", async () => {
      const client = await loadClient();
      client.setAnalyticsEnabled(true, "device-1");
      client.setAnalyticsEnabled(true, "device-1");

      expect(posthog.init).toHaveBeenCalledTimes(1);
      expect(posthog.opt_in_capturing).not.toHaveBeenCalled();
    });
  });

  it("does nothing without a key, and flags use the fallback", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "");
    const client = await loadClient();
    client.setAnalyticsEnabled(true, "device-1");
    client.setAnalyticsEnabled(false, "device-1");

    expect(posthog.init).not.toHaveBeenCalled();
    expect(client.isFlagEnabled("image-canvas", false)).toBe(false);
    expect(posthog.isFeatureEnabled).not.toHaveBeenCalled();
  });

  it("scrubs personal paths from everything it sends", async () => {
    const client = await loadClient();
    client.setAnalyticsEnabled(true, "device-1");
    const beforeSend = initConfig().before_send as (event: unknown) => {
      properties: Record<string, unknown>;
    } | null;

    const sent = beforeSend({
      event: "$exception",
      properties: {
        $exception_list: [{ value: "open '/Users/ana/Movies/a.mp4' failed" }],
        keep: "plain",
      },
    });

    expect(JSON.stringify(sent)).not.toContain("ana");
    expect(sent?.properties.keep).toBe("plain");
  });
});
