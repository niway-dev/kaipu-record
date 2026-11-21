import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FLAG_DEFAULTS, FLAG_NAMES, RELEASE_FLAGS } from "@shared/analytics";

const posthog = vi.hoisted(() => ({
  init: vi.fn(),
  register: vi.fn(),
  identify: vi.fn(),
  capture: vi.fn(),
  captureException: vi.fn(),
  isFeatureEnabled: vi.fn((_name?: string): boolean | undefined => undefined),
  onFeatureFlags: vi.fn((_callback: () => void) => () => {}),
  opt_out_capturing: vi.fn(),
  opt_in_capturing: vi.fn(),
  has_opted_out_capturing: vi.fn(() => false),
}));
vi.mock("posthog-js", () => ({ default: posthog }));

type Api = {
  adminMode: boolean;
  flagOverrides: unknown;
  getSettings: unknown;
  getAdminModeState: unknown;
  setAdminMode: unknown;
  onAdminModeChanged: unknown;
};
const api = window.electronAPI as unknown as Api;
const original = { ...api };

/** A fresh copy of the client (module state), with the window launched in `adminMode`. */
async function launch(options: { adminMode: boolean; overrides?: Record<string, boolean> }) {
  vi.resetModules();
  api.adminMode = options.adminMode;
  api.flagOverrides = options.overrides ?? {};
  return import("./analytics-client");
}

/** PostHog running and answering `answers`; anything else it has no value for. */
async function withPosthog(
  client: typeof import("./analytics-client"),
  answers: Partial<Record<string, boolean>>,
): Promise<void> {
  vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
  posthog.isFeatureEnabled.mockImplementation((name?: string) => answers[name ?? ""]);
  client.setAnalyticsEnabled(true, "device-1");
}

describe("flagState with Admin mode", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    Object.assign(api, original);
    vi.unstubAllEnvs();
  });

  it("turns every release flag on, even before PostHog loads or when it says off", async () => {
    const client = await launch({ adminMode: true });
    for (const name of RELEASE_FLAGS) {
      expect(client.flagState(name, FLAG_DEFAULTS[name])).toEqual({ value: true, source: "admin" });
    }

    await withPosthog(client, Object.fromEntries(RELEASE_FLAGS.map((name) => [name, false])));
    for (const name of RELEASE_FLAGS) {
      expect(client.isFlagEnabled(name, FLAG_DEFAULTS[name])).toBe(true);
    }
  });

  it("leaves a flag that defaults to true to PostHog and the default", async () => {
    const client = await launch({ adminMode: true });
    expect(client.flagState("native-cursor-capture", true)).toEqual({
      value: true,
      source: "default",
    });
    await withPosthog(client, { "native-cursor-capture": false });
    expect(client.flagState("native-cursor-capture", true)).toEqual({
      value: false,
      source: "posthog",
    });
  });

  it("a dev override still wins over Admin mode", async () => {
    const client = await launch({ adminMode: true, overrides: { "image-text": false } });
    expect(client.flagState("image-text", false)).toEqual({ value: false, source: "override" });
    expect(client.flagState("image-canvas", false)).toEqual({ value: true, source: "admin" });
  });

  it("a release flag pinned to false by an override reads as the override, not Admin", async () => {
    const pinned = RELEASE_FLAGS[0]!;
    const client = await launch({ adminMode: true, overrides: { [pinned]: false } });
    expect(client.flagState(pinned, false)).toEqual({ value: false, source: "override" });
    for (const name of RELEASE_FLAGS.slice(1)) {
      expect(client.flagState(name, false)).toEqual({ value: true, source: "admin" });
    }
  });

  it("an override on a flag outside the release set also reads as the override", async () => {
    const client = await launch({ adminMode: true, overrides: { "native-cursor-capture": false } });
    expect(client.flagState("native-cursor-capture", true)).toEqual({
      value: false,
      source: "override",
    });
  });
});

describe("flagState in User mode", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    Object.assign(api, original);
    vi.unstubAllEnvs();
  });

  it("reads the default while PostHog has not loaded", async () => {
    const client = await launch({ adminMode: false });
    for (const name of FLAG_NAMES) {
      expect(client.flagState(name, FLAG_DEFAULTS[name])).toEqual({
        value: FLAG_DEFAULTS[name],
        source: "default",
      });
    }
  });

  it("reads PostHog first, then the default for a flag PostHog does not know", async () => {
    const client = await launch({ adminMode: false });
    await withPosthog(client, { "image-canvas": true });
    expect(client.flagState("image-canvas", false)).toEqual({ value: true, source: "posthog" });
    expect(client.flagState("image-inspect", false)).toEqual({ value: false, source: "default" });
  });

  it("a dev override still wins over PostHog", async () => {
    const client = await launch({ adminMode: false, overrides: { "image-canvas": false } });
    await withPosthog(client, { "image-canvas": true });
    expect(client.flagState("image-canvas", false)).toEqual({ value: false, source: "override" });
  });
});

describe("the mode is the launch value, never the live setting (AC5)", () => {
  type Listener = (state: unknown) => void;
  const listeners: Listener[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    listeners.length = 0;
  });
  afterEach(() => Object.assign(api, original));

  /** Main changes the setting mid-session the ways it can: the push, the call, the reads. */
  async function changeSettingMidSession(live: {
    isAdmin: boolean;
    adminModeSetting: boolean;
    effective: boolean;
  }) {
    const state = { ...live, restartPending: true };
    api.getSettings = vi.fn(async () => ({ adminMode: live.adminModeSetting }));
    api.getAdminModeState = vi.fn(async () => state);
    api.setAdminMode = vi.fn(async () => state);
    for (const listener of listeners) listener(state);
    await (api.setAdminMode as (v: boolean) => Promise<unknown>)(live.adminModeSetting);
  }

  async function launchListening(adminMode: boolean) {
    api.onAdminModeChanged = (listener: Listener) => {
      listeners.push(listener);
      return () => {};
    };
    return launch({ adminMode });
  }

  const readAll = (client: typeof import("./analytics-client")) =>
    FLAG_NAMES.map((name) => client.flagState(name, FLAG_DEFAULTS[name]));

  it("turning the preference off mid-session changes no flag until relaunch", async () => {
    const client = await launchListening(true);
    await withPosthog(client, Object.fromEntries(RELEASE_FLAGS.map((name) => [name, false])));
    const before = readAll(client);
    expect(RELEASE_FLAGS.every((name) => client.flagState(name, false).source === "admin")).toBe(
      true,
    );

    await changeSettingMidSession({ isAdmin: false, adminModeSetting: false, effective: true });

    expect(readAll(client)).toEqual(before);
  });

  it("turning the preference on mid-session changes no flag until relaunch", async () => {
    const client = await launchListening(false);
    const before = readAll(client);
    expect(RELEASE_FLAGS.every((name) => client.flagState(name, false).value === false)).toBe(true);

    await changeSettingMidSession({ isAdmin: true, adminModeSetting: true, effective: false });

    expect(readAll(client)).toEqual(before);
  });
});
