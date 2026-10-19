import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const posthog = vi.hoisted(() => {
  let optedOut = false;
  return {
    init: vi.fn(),
    register: vi.fn(),
    identify: vi.fn(),
    capture: vi.fn(),
    opt_out_capturing: vi.fn(() => {
      optedOut = true;
    }),
    opt_in_capturing: vi.fn(() => {
      optedOut = false;
    }),
    has_opted_out_capturing: vi.fn(() => optedOut),
  };
});
vi.mock("posthog-js", () => ({ default: posthog }));

// Module state (initialized/started) is per import, so each test loads a fresh copy.
async function loadClient(): Promise<typeof import("./analytics-client")> {
  vi.resetModules();
  return import("./analytics-client");
}

describe("setAnalyticsEnabled", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("never initializes PostHog when diagnostics are off at launch", async () => {
    const client = await loadClient();
    client.setAnalyticsEnabled(false, "device-1");
    client.captureEvent("anything");

    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it("initializes once, opts out when turned off and back in when turned on", async () => {
    const client = await loadClient();
    client.setAnalyticsEnabled(true, "device-1");
    expect(posthog.init).toHaveBeenCalledTimes(1);
    expect(posthog.identify).toHaveBeenCalledWith("device-1");

    client.setAnalyticsEnabled(false, "device-1");
    client.captureEvent("while-off");
    expect(posthog.opt_out_capturing).toHaveBeenCalledTimes(1);
    expect(posthog.capture).not.toHaveBeenCalled();

    client.setAnalyticsEnabled(true, "device-1");
    client.captureEvent("while-on");
    expect(posthog.init).toHaveBeenCalledTimes(1);
    expect(posthog.opt_in_capturing).toHaveBeenCalledTimes(1);
    expect(posthog.capture).toHaveBeenCalledWith("while-on", undefined);
  });

  it("does nothing without a key", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "");
    const client = await loadClient();
    client.setAnalyticsEnabled(true, "device-1");

    expect(posthog.init).not.toHaveBeenCalled();
  });
});
