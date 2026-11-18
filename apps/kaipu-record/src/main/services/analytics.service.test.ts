import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildExceptionProperties,
  initMainAnalytics,
  resolvePosthogHost,
  scrubMainEvent,
} from "./analytics.service";

const constructed = vi.hoisted(() => ({ count: 0 }));
vi.mock("posthog-node", () => ({
  PostHog: class {
    constructor() {
      constructed.count += 1;
    }
  },
}));

describe("buildExceptionProperties", () => {
  it("tags every exception with product + surface and the origin", () => {
    const props = buildExceptionProperties("main-process", { foo: "bar" });
    expect(props.product).toBe("kaipu-recorder");
    expect(props.surface).toBe("desktop");
    expect(props.origin).toBe("main-process");
    expect(props.foo).toBe("bar");
  });
});

describe("scrubMainEvent", () => {
  it("removes personal paths from an exception's message, frames and context", () => {
    const event = {
      distinctId: "device-1",
      event: "$exception",
      properties: {
        $exception_list: [
          {
            value: "ENOENT: open '/Users/ana/Movies/Kaipu Record/Q3 call.mp4'",
            stacktrace: { frames: [{ filename: "/Users/ana/dev/kaipu/src/a.ts", lineno: 7 }] },
          },
        ],
        origin: "main-process",
        path: "C:\\Users\\Ana\\Videos\\a.mp4",
      },
    };
    const sent = scrubMainEvent(event);

    expect(JSON.stringify(sent)).not.toMatch(/ana|Ana/);
    expect(sent?.properties?.origin).toBe("main-process");
    expect(sent?.distinctId).toBe("device-1");
  });

  it("drops the item id from the context: a local id is a file-name stem", () => {
    const sent = scrubMainEvent({
      distinctId: "device-1",
      event: "$exception",
      properties: { id: "Q3 board call", phase: "rename" },
    });
    expect(sent?.properties).toEqual({ phase: "rename" });
  });

  it("passes a dropped event through", () => {
    expect(scrubMainEvent(null)).toBeNull();
  });
});

describe("initMainAnalytics", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("says so when the build has no PostHog key", () => {
    vi.stubEnv("MAIN_VITE_POSTHOG_KEY", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    initMainAnalytics("device-1", true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no PostHog key"));
    // And stays inert: no client, so nothing can leave the device.
    expect(constructed.count).toBe(0);
  });
});

describe("resolvePosthogHost", () => {
  it("keeps a configured host", () => {
    expect(resolvePosthogHost("https://eu.i.posthog.com")).toBe("https://eu.i.posthog.com");
  });

  it("defaults when the host is unset or empty (an unset CI variable)", () => {
    expect(resolvePosthogHost(undefined)).toBe("https://us.i.posthog.com");
    expect(resolvePosthogHost("")).toBe("https://us.i.posthog.com");
  });
});
