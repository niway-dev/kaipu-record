import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ph = vi.hoisted(() => ({ init: vi.fn(), register: vi.fn(), capture: vi.fn() }));
vi.mock("posthog-js", () => ({ default: ph }));

import {
  ANALYTICS_EVENTS,
  analyticsUiHost,
  initAnalytics,
  resetAnalyticsForTests,
  track,
  trackPageview,
} from "./analytics";

beforeEach(() => {
  resetAnalyticsForTests();
  ph.init.mockReset();
  ph.register.mockReset();
  ph.capture.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  window.history.replaceState(null, "", "/");
});

describe("analytics without a key", () => {
  it("never starts and every call is a no-op", () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "");
    initAnalytics();
    trackPageview();
    track(ANALYTICS_EVENTS.downloadClicked, { platform: "windows", placement: "hero" });
    expect(ph.init).not.toHaveBeenCalled();
    expect(ph.capture).not.toHaveBeenCalled();
  });

  it("treats a missing key the same as an empty one", () => {
    vi.stubEnv("VITE_POSTHOG_KEY", undefined as unknown as string);
    initAnalytics();
    track(ANALYTICS_EVENTS.signUpCompleted, { desktop: false });
    expect(ph.init).not.toHaveBeenCalled();
    expect(ph.capture).not.toHaveBeenCalled();
  });
});

describe("analytics with a key", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
  });

  it("starts once, cookieless, through the first-party proxy", () => {
    initAnalytics();
    initAnalytics();
    expect(ph.init).toHaveBeenCalledTimes(1);
    const [key, options] = ph.init.mock.calls[0]!;
    expect(key).toBe("phc_test");
    expect(options).toMatchObject({
      api_host: "/ingest",
      cookieless_mode: "always",
      persistence: "memory",
      capture_pageview: false,
      autocapture: false,
      disable_session_recording: true,
    });
    expect(ph.register).toHaveBeenCalledWith({ product: "kaipu-recorder", surface: "web" });
  });

  it("sends $pageview with the current URL and drops a repeat of the same URL", () => {
    initAnalytics();
    window.history.replaceState(null, "", "/features?x=1");
    trackPageview();
    window.history.replaceState(null, "", "/features?x=1#top");
    trackPageview();
    expect(ph.capture).toHaveBeenCalledTimes(1);
    expect(ph.capture).toHaveBeenCalledWith("$pageview", {
      $current_url: `${window.location.origin}/features?x=1`,
    });
    window.history.replaceState(null, "", "/roadmap");
    trackPageview();
    expect(ph.capture).toHaveBeenCalledTimes(2);
  });

  it("sends custom events with their properties", () => {
    initAnalytics();
    track(ANALYTICS_EVENTS.downloadClicked, { platform: "mac-x64", placement: "closing" });
    expect(ph.capture).toHaveBeenCalledWith("download_clicked", {
      platform: "mac-x64",
      placement: "closing",
    });
  });

  it("never throws if PostHog does", () => {
    initAnalytics();
    ph.capture.mockImplementation(() => {
      throw new Error("boom");
    });
    expect(() => track(ANALYTICS_EVENTS.signUpCompleted, { desktop: true })).not.toThrow();
  });
});

describe("analyticsUiHost", () => {
  it("derives the app host from the ingestion host", () => {
    vi.stubEnv("VITE_POSTHOG_HOST", "https://eu.i.posthog.com");
    expect(analyticsUiHost()).toBe("https://eu.posthog.com");
  });

  it("falls back to the US app host", () => {
    vi.stubEnv("VITE_POSTHOG_HOST", "");
    expect(analyticsUiHost()).toBe("https://us.posthog.com");
  });
});
