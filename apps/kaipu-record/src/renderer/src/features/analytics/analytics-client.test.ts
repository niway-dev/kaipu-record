import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPosthogConfig,
  flagState,
  isFlagEnabled,
  onFlagsChanged,
  scrubEventBeforeSend,
} from "./analytics-client";

const ANY = { deviceId: "device-1", capturing: true };

describe("buildPosthogConfig", () => {
  it("locks privacy down for a screen recorder", () => {
    const config = buildPosthogConfig("https://us.i.posthog.com", {
      deviceId: "device-1",
      capturing: true,
    });
    expect(config.autocapture).toBe(false);
    expect(config.capture_pageview).toBe(false);
    expect(config.disable_session_recording).toBe(true);
    expect(config.capture_exceptions).toBe(true);
    expect(config.api_host).toBe("https://us.i.posthog.com");
  });

  it("falls back to the US host when none is provided", () => {
    expect(buildPosthogConfig(undefined, ANY).api_host).toBe("https://us.i.posthog.com");
  });

  it("treats an empty host (an unset CI variable) as no host", () => {
    expect(buildPosthogConfig("", ANY).api_host).toBe("https://us.i.posthog.com");
  });

  it("starts opted out and under the device id when the preference is off", () => {
    const config = buildPosthogConfig(undefined, { deviceId: "device-1", capturing: false });
    expect(config.opt_out_capturing_by_default).toBe(true);
    expect(config.bootstrap).toEqual({ distinctID: "device-1" });
  });

  it("starts opted in when the preference is on", () => {
    expect(buildPosthogConfig(undefined, ANY).opt_out_capturing_by_default).toBe(false);
  });

  it("has no bootstrap identity without a device id", () => {
    expect(buildPosthogConfig(undefined, { deviceId: "", capturing: true }).bootstrap).toEqual({});
  });

  it("uses a host the renderer CSP lets it connect to", () => {
    const html = readFileSync(resolve(__dirname, "../../../index.html"), "utf8");
    const connectSrc = html.match(/content="[^"]*connect-src ([^;"]+)/)?.[1].split(/\s+/) ?? [];
    expect(connectSrc).toContain(buildPosthogConfig(undefined, ANY).api_host);
  });
});

describe("scrubEventBeforeSend", () => {
  it("drops the item id and removes personal paths before an event leaves", () => {
    const sent = scrubEventBeforeSend({
      uuid: "u",
      event: "$exception",
      properties: {
        id: "Q3 board call",
        phase: "rename",
        message: "open '/Users/ana/a.mp4' failed",
      },
    });
    expect(sent?.properties).toEqual({ phase: "rename", message: "open '<user-path>' failed" });
  });

  it("passes a dropped event through", () => {
    expect(scrubEventBeforeSend(null)).toBeNull();
  });
});

describe("exception autocapture", () => {
  it("ships in the bundle, so the CSP never has to allow PostHog scripts", () => {
    // Importing analytics-client registers the extension; without it posthog-js would
    // try to load it from PostHog's script origin, which script-src 'self' blocks.
    const extensions = (window as { __PosthogExtensions__?: { errorWrappingFunctions?: unknown } })
      .__PosthogExtensions__;
    expect(extensions?.errorWrappingFunctions).toBeDefined();
  });
});

describe("isFlagEnabled overrides", () => {
  const original = window.electronAPI.flagOverrides;
  const setOverrides = (value: unknown): void => {
    (window.electronAPI as { flagOverrides: unknown }).flagOverrides = value;
  };
  afterEach(() => setOverrides(original));

  it("returns the override even though analytics never started", () => {
    setOverrides({ "native-cursor-capture": true, "image-canvas": true });
    expect(isFlagEnabled("native-cursor-capture", false)).toBe(true);
    expect(isFlagEnabled("image-canvas", false)).toBe(true);
  });

  it("falls back to the default for a flag with no override", () => {
    setOverrides({ "native-cursor-capture": true });
    expect(isFlagEnabled("image-canvas", true)).toBe(true);
  });
});

describe("live flag overrides (Developer page)", () => {
  it("a change from main wins over the launch overrides and tells subscribers", () => {
    const api = window.electronAPI as unknown as {
      flagOverrides: unknown;
      onFlagOverridesChanged: unknown;
    };
    const original = { ...api };
    let push: (overrides: Record<string, boolean>) => void = () => {};
    api.flagOverrides = { "image-canvas": true };
    api.onFlagOverridesChanged = (listener: typeof push) => {
      push = listener;
      return () => {};
    };
    try {
      const subscriber = vi.fn();
      const off = onFlagsChanged(subscriber);
      expect(isFlagEnabled("image-canvas", false)).toBe(true);
      expect(flagState("image-canvas", false)).toEqual({ value: true, source: "override" });

      push({ "image-text": true });

      expect(subscriber).toHaveBeenCalledTimes(1);
      // The live set replaces the launch set: image-canvas is no longer pinned.
      expect(isFlagEnabled("image-canvas", false)).toBe(false);
      expect(flagState("image-canvas", false)).toEqual({ value: false, source: "default" });
      expect(flagState("image-text", false)).toEqual({ value: true, source: "override" });

      off();
      push({});
      expect(subscriber).toHaveBeenCalledTimes(1);
    } finally {
      api.flagOverrides = original.flagOverrides;
      api.onFlagOverridesChanged = original.onFlagOverridesChanged;
    }
  });
});
