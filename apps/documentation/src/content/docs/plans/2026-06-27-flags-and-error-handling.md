---
title: "Feature Flags + Error Handling — Implementation Plan"
description: "Implementation plan for the PostHog analytics foundation: feature flags, broad error reporting, and a defensive two-channel error layer."
---

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a PostHog-backed analytics foundation to the desktop recorder that delivers feature flags (`bypass-login`, `watermark-enabled`), maximum-coverage error reporting (renderer + main), and a defensive layer (ErrorBoundary + `ui/toast`) so the app never hard-crashes and every error has a human-readable face for users plus a full stack trace for us.

**Architecture:** Renderer-primary — `posthog-js` runs in the main window (flags + exception autocapture + identify); a small `posthog-node` client in the main process captures Node crashes and acts as an IPC sink for secondary-window errors. Everything is offline-safe: a missing key or no network makes the SDKs no-op while the app runs normally with flag defaults.

**Tech Stack:** `posthog-js` (renderer), `posthog-node` (main), React 19, electron-vite 5, CSS Modules + design tokens, the existing main-process hub + `settings-store`, the `cx()` + `data-*` house style.

**Spec:** `docs/superpowers/specs/2026-06-27-flags-and-error-handling-design.md`

---

## Conventions for every task

- **Working dir:** `apps/kaipu-record/` unless noted. Run commands from the monorepo root.
- **Tests:** `cd apps/kaipu-record && bun run test -- <path>` (Vitest 4; jsdom project for renderer `*.tsx`, node project for `src/main/**` + `src/shared/**`). Run a single file by passing its path.
- **Typecheck:** `cd apps/kaipu-record && bun run typecheck`. **Lint:** `bun run lint` (oxlint, must stay 0/0).
- **House rules:** double quotes + semicolons; design tokens only (no hardcoded colors); `cx()` + `data-*` className style; **no TypeScript `enum`** — use `as const` + `(typeof X)[number]`; product/UI copy in **neutral Spanish** (no voseo).
- **Commits:** `git commit --no-verify -m "<msg>"` (the `--no-verify` is required per the active oxfmt churn hold). End every commit message body with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Branch:** continue on the current feature branch (`feat/screen-recording-control-bar` lineage). Do not start on `main`.

---

## Task 1: Dependencies + environment variables

**Files:**

- Modify: `apps/kaipu-record/package.json` (deps)
- Modify: `apps/kaipu-record/.env` and `apps/kaipu-record/.env.example` (add main-layer vars)
- Modify: `apps/kaipu-record/src/renderer/src/env.d.ts` (renderer env typing)
- Create: `apps/kaipu-record/src/main/env.d.ts` (main env typing)

- [ ] **Step 1: Install the SDKs**

```bash
cd apps/kaipu-record && bun add posthog-js posthog-node
```

Expected: `posthog-js` (>= 1.160, for `capture_exceptions`) and `posthog-node` (>= 4) added to `dependencies` in `apps/kaipu-record/package.json`.

- [ ] **Step 2: Add the main-process env vars**

The renderer vars (`VITE_POSTHOG_*`) already exist. `posthog-node` runs in the main process, which only sees `MAIN_VITE_*`-prefixed vars. Append to **both** `.env` and `.env.example` (same value in `.env`; placeholder in `.env.example`):

In `apps/kaipu-record/.env` (after the existing identity block):

```bash
# ── PostHog (main process — posthog-node) ────────────────────────────────────
# Same key/host as the renderer; the MAIN_VITE_ prefix routes them to the Node side.
MAIN_VITE_POSTHOG_KEY=phc_3gau0AZwd6DEt3QLSqobCMsn7smoOhnHGr7OkysLt98
MAIN_VITE_POSTHOG_HOST=https://us.i.posthog.com
```

In `apps/kaipu-record/.env.example` (after the identity block):

```bash
# ── PostHog (main process — posthog-node) ────────────────────────────────────
# Same values as the renderer key/host; the MAIN_VITE_ prefix routes to the Node side.
MAIN_VITE_POSTHOG_KEY=phc_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
MAIN_VITE_POSTHOG_HOST=https://us.i.posthog.com
```

- [ ] **Step 3: Type the renderer env vars**

Replace `apps/kaipu-record/src/renderer/src/env.d.ts` with:

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
  readonly VITE_POSTHOG_PRODUCT?: string;
  readonly VITE_POSTHOG_SURFACE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 4: Type the main env vars**

Create `apps/kaipu-record/src/main/env.d.ts`:

```ts
interface ImportMetaEnv {
  readonly MAIN_VITE_POSTHOG_KEY?: string;
  readonly MAIN_VITE_POSTHOG_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 5: Verify typecheck still passes**

Run: `cd apps/kaipu-record && bun run typecheck`
Expected: PASS (no new errors).

- [ ] **Step 6: Commit**

```bash
git add apps/kaipu-record/package.json apps/kaipu-record/.env.example apps/kaipu-record/src/renderer/src/env.d.ts apps/kaipu-record/src/main/env.d.ts
git commit --no-verify -m "build(kaipu-record): add posthog-js + posthog-node and env vars"
```

(`.env` is gitignored and won't be staged — that's expected.)

---

## Task 2: Pure analytics model (`shared/analytics.ts`)

The one place flag names, defaults, identity constants, and the error-serialization helper live. Pure (no `electron`/`node`/DOM imports), so both processes import it and it's tested in the node project.

**Files:**

- Create: `apps/kaipu-record/src/shared/analytics.ts`
- Test: `apps/kaipu-record/src/shared/analytics.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/kaipu-record/src/shared/analytics.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRODUCT,
  DEFAULT_SURFACE,
  FLAG_DEFAULTS,
  FLAG_NAMES,
  serializeError,
} from "./analytics";

describe("flag model", () => {
  it("defaults every known flag to a safe value", () => {
    for (const name of FLAG_NAMES) {
      expect(typeof FLAG_DEFAULTS[name]).toBe("boolean");
    }
    // Watermark must ship even offline; login is bypassed pre-auth.
    expect(FLAG_DEFAULTS["watermark-enabled"]).toBe(true);
    expect(FLAG_DEFAULTS["bypass-login"]).toBe(true);
  });

  it("uses stable identity defaults", () => {
    expect(DEFAULT_PRODUCT).toBe("kaipu-recorder");
    expect(DEFAULT_SURFACE).toBe("desktop");
  });
});

describe("serializeError", () => {
  it("extracts name/message/stack from an Error", () => {
    const payload = serializeError(new TypeError("boom"));
    expect(payload.name).toBe("TypeError");
    expect(payload.message).toBe("boom");
    expect(payload.stack).toContain("boom");
  });

  it("survives non-Error throws", () => {
    expect(serializeError("nope")).toEqual({ name: "Error", message: "nope", stack: null });
    expect(serializeError(undefined).message).toBe("Unknown error");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/kaipu-record && bun run test -- src/shared/analytics.test.ts`
Expected: FAIL — cannot find module `./analytics`.

- [ ] **Step 3: Implement the module**

Create `apps/kaipu-record/src/shared/analytics.ts`:

```ts
/**
 * Pure analytics model shared by both processes. No `electron`/`node`/DOM
 * imports — flag names, their offline defaults, identity constants, and the
 * error-serialization helper used to ship exceptions over IPC and to PostHog.
 *
 * No TS enums (house rule): `as const` arrays + derived types, one source for
 * the value and its type — same idiom as IPC_CHANNELS.
 */

/** Feature flags the app reads. Names must match the PostHog dashboard exactly. */
export const FLAG_NAMES = ["bypass-login", "watermark-enabled"] as const;
export type FlagName = (typeof FLAG_NAMES)[number];

/**
 * Value used when a flag is unresolved (offline, still loading, or the SDK is
 * disabled because the key is absent). Chosen so behavior is deterministic
 * offline: the watermark still ships (free behavior) and login is bypassed
 * (there is no login UI yet).
 */
export const FLAG_DEFAULTS: Record<FlagName, boolean> = {
  "bypass-login": true,
  "watermark-enabled": true,
};

/** Identity super-properties attached to every event/error for multi-surface filtering. */
export const DEFAULT_PRODUCT = "kaipu-recorder";
export const DEFAULT_SURFACE = "desktop";

/** Serialized exception — Error objects don't survive structured-clone over IPC. */
export interface SerializedError {
  name: string;
  message: string;
  stack: string | null;
}

/** Normalize anything thrown into a plain, IPC-safe shape with name/message/stack. */
export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return { name: error.name || "Error", message: error.message, stack: error.stack ?? null };
  }
  if (typeof error === "string") {
    return { name: "Error", message: error, stack: null };
  }
  return { name: "Error", message: "Unknown error", stack: null };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/kaipu-record && bun run test -- src/shared/analytics.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/kaipu-record/src/shared/analytics.ts apps/kaipu-record/src/shared/analytics.test.ts
git commit --no-verify -m "feat(kaipu-record): add pure analytics model (flags + error serialize)"
```

---

## Task 3: Stable device id in settings

`posthog.identify(deviceId)` needs a stable per-install id. It rides in `AppSettings` (so the renderer reads it via the existing `getSettings()` — no new IPC) and is generated once by the settings-store infrastructure.

**Files:**

- Modify: `apps/kaipu-record/src/shared/types/ipc.ts` (add `deviceId` to `AppSettings` + `DEFAULT_SETTINGS`)
- Modify: `apps/kaipu-record/src/main/services/settings.service.ts` (preserve `deviceId` in `mergeSettings`)
- Modify: `apps/kaipu-record/src/main/infrastructure/settings-store.ts` (generate if empty + `getDeviceId()`)
- Test: `apps/kaipu-record/src/main/services/settings.service.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `apps/kaipu-record/src/main/services/settings.service.test.ts` (inside the existing top-level `describe`, or add a new one):

```ts
import { mergeSettings } from "./settings.service";

describe("deviceId", () => {
  it("defaults to an empty string (the store fills it in)", () => {
    expect(mergeSettings(null).deviceId).toBe("");
  });

  it("preserves a stored device id", () => {
    expect(mergeSettings({ deviceId: "abc-123" }).deviceId).toBe("abc-123");
  });

  it("ignores a non-string device id", () => {
    expect(mergeSettings({ deviceId: 42 as unknown as string }).deviceId).toBe("");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/kaipu-record && bun run test -- src/main/services/settings.service.test.ts`
Expected: FAIL — `deviceId` is `undefined`, not `""`.

- [ ] **Step 3: Add `deviceId` to the contract**

In `apps/kaipu-record/src/shared/types/ipc.ts`, add the field to `AppSettings` (after `recordingQuality`):

```ts
  /** Resolution/fps/bitrate the encoder targets (a preset or a custom combo). */
  recordingQuality: RecordingQuality;
  /**
   * Stable per-install id for analytics identity. Empty until the settings-store
   * mints one on first load; never shown in the UI.
   */
  deviceId: string;
```

And to `DEFAULT_SETTINGS`:

```ts
export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  launchAtLogin: false,
  showInDock: true,
  recordingQuality: DEFAULT_QUALITY,
  deviceId: "",
};
```

- [ ] **Step 4: Preserve `deviceId` in the merge**

In `apps/kaipu-record/src/main/services/settings.service.ts`, locate `mergeSettings` and add a `deviceId` line alongside the other validated fields (mirror the existing `safe.*` guarding style):

```ts
    deviceId: typeof safe.deviceId === "string" ? safe.deviceId : "",
```

(Place it in the returned object next to `recordingQuality: sanitizeQuality(safe.recordingQuality)`.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/kaipu-record && bun run test -- src/main/services/settings.service.test.ts`
Expected: PASS (including the 3 new deviceId tests).

- [ ] **Step 6: Generate the id in the store + expose a getter**

In `apps/kaipu-record/src/main/infrastructure/settings-store.ts`:

Add the import at the top:

```ts
import { randomUUID } from "node:crypto";
```

In `load()`, after `settings` is assigned, ensure a device id exists (mint + persist once):

```ts
function load(): void {
  try {
    settings = mergeSettings(
      JSON.parse(readFileSync(settingsPath(), "utf-8")) as Partial<AppSettings>,
    );
  } catch {
    settings = mergeSettings(null);
  }
  if (!settings.deviceId) {
    settings = { ...settings, deviceId: randomUUID() };
    persist();
  }
}
```

Add an exported getter (used by the main analytics service in Task 5):

```ts
/** Stable per-install analytics id, minted on first load. */
export function getDeviceId(): string {
  return settings.deviceId;
}
```

- [ ] **Step 7: Verify typecheck + tests**

Run: `cd apps/kaipu-record && bun run typecheck && bun run test -- src/main`
Expected: PASS. (If `test/setup.ts`'s `STUB_SETTINGS` is typed as `AppSettings`, add `deviceId: ""` there too — typecheck will tell you.)

- [ ] **Step 8: Commit**

```bash
git add apps/kaipu-record/src/shared/types/ipc.ts apps/kaipu-record/src/main/services/settings.service.ts apps/kaipu-record/src/main/services/settings.service.test.ts apps/kaipu-record/src/main/infrastructure/settings-store.ts
git commit --no-verify -m "feat(kaipu-record): mint a stable device id in settings for analytics identity"
```

---

## Task 4: Renderer analytics client

`posthog-js` wrapper for the main window: privacy-locked init, identify, super-properties, exception capture, and flag reads. The init **config** is a pure function so it's unit-tested; the thin SDK calls are smoke-tested in the GUI.

**Files:**

- Create: `apps/kaipu-record/src/renderer/src/features/analytics/analytics-client.ts`
- Test: `apps/kaipu-record/src/renderer/src/features/analytics/analytics-client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/kaipu-record/src/renderer/src/features/analytics/analytics-client.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildPosthogConfig } from "./analytics-client";

describe("buildPosthogConfig", () => {
  it("locks privacy down for a screen recorder", () => {
    const config = buildPosthogConfig("https://us.i.posthog.com");
    expect(config.autocapture).toBe(false);
    expect(config.capture_pageview).toBe(false);
    expect(config.disable_session_recording).toBe(true);
    expect(config.capture_exceptions).toBe(true);
    expect(config.api_host).toBe("https://us.i.posthog.com");
  });

  it("falls back to the US host when none is provided", () => {
    expect(buildPosthogConfig(undefined).api_host).toBe("https://us.i.posthog.com");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/kaipu-record && bun run test -- src/renderer/src/features/analytics/analytics-client.test.ts`
Expected: FAIL — cannot find module `./analytics-client`.

- [ ] **Step 3: Implement the client**

Create `apps/kaipu-record/src/renderer/src/features/analytics/analytics-client.ts`:

```ts
import posthog, { type PostHogConfig } from "posthog-js";
import { DEFAULT_PRODUCT, DEFAULT_SURFACE, type FlagName } from "@shared/analytics";

let started = false;

/** Privacy-locked config. Pure + exported so the privacy guarantees are tested. */
export function buildPosthogConfig(host: string | undefined): Partial<PostHogConfig> {
  return {
    api_host: host ?? "https://us.i.posthog.com",
    autocapture: false, // never capture DOM/clicks — could leak recorded UI
    capture_pageview: false,
    disable_session_recording: true, // never record the screen-recorder's own screen
    capture_exceptions: true, // PostHog Error Tracking autocapture
    person_profiles: "always",
  };
}

/**
 * Initialize PostHog once, in the main window. No-op if the key is absent (the app
 * runs offline-normal) or if already started. Registers identity super-properties
 * so events/errors can be filtered by product/surface across future backends.
 */
export function initAnalytics(deviceId: string): void {
  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (!key || started) return;
  started = true;
  posthog.init(key, buildPosthogConfig(import.meta.env.VITE_POSTHOG_HOST));
  posthog.register({
    product: import.meta.env.VITE_POSTHOG_PRODUCT ?? DEFAULT_PRODUCT,
    surface: import.meta.env.VITE_POSTHOG_SURFACE ?? DEFAULT_SURFACE,
  });
  if (deviceId) posthog.identify(deviceId);
}

export function isAnalyticsStarted(): boolean {
  return started;
}

/** Send an exception with the full technical payload (developer channel). No-op if disabled. */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!started) return;
  posthog.captureException(error, context);
}

/** Read a flag, returning `fallback` while unresolved/disabled. */
export function isFlagEnabled(name: FlagName, fallback: boolean): boolean {
  if (!started) return fallback;
  const value = posthog.isFeatureEnabled(name);
  return value === undefined ? fallback : value;
}

/** Subscribe to flag (re)loads. Returns an unsubscribe fn (no-op if disabled). */
export function onFlagsChanged(callback: () => void): () => void {
  if (!started) return () => {};
  return posthog.onFeatureFlags(() => callback());
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/kaipu-record && bun run test -- src/renderer/src/features/analytics/analytics-client.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/kaipu-record/src/renderer/src/features/analytics/analytics-client.ts apps/kaipu-record/src/renderer/src/features/analytics/analytics-client.test.ts
git commit --no-verify -m "feat(kaipu-record): add renderer posthog client (privacy-locked, flags, exceptions)"
```

---

## Task 5: Main analytics service

`posthog-node` in the main process: captures `uncaughtException`/`unhandledRejection`, and is the sink for serialized exceptions forwarded from secondary windows (Task 10). The super-property builder is pure + tested.

**Files:**

- Create: `apps/kaipu-record/src/main/services/analytics.service.ts`
- Test: `apps/kaipu-record/src/main/services/analytics.service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/kaipu-record/src/main/services/analytics.service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildExceptionProperties } from "./analytics.service";

describe("buildExceptionProperties", () => {
  it("tags every exception with product + surface and the origin", () => {
    const props = buildExceptionProperties("main-process", { foo: "bar" });
    expect(props.product).toBe("kaipu-recorder");
    expect(props.surface).toBe("desktop");
    expect(props.origin).toBe("main-process");
    expect(props.foo).toBe("bar");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/kaipu-record && bun run test -- src/main/services/analytics.service.test.ts`
Expected: FAIL — cannot find module `./analytics.service`.

- [ ] **Step 3: Implement the service**

Create `apps/kaipu-record/src/main/services/analytics.service.ts`:

```ts
import { PostHog } from "posthog-node";
import {
  DEFAULT_PRODUCT,
  DEFAULT_SURFACE,
  type SerializedError,
} from "@shared/analytics";

let client: PostHog | null = null;
let distinctId = "anonymous";

/** Pure: identity super-properties merged into every exception. Tested. */
export function buildExceptionProperties(
  origin: string,
  context?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    product: import.meta.env.MAIN_VITE_POSTHOG_KEY ? DEFAULT_PRODUCT : DEFAULT_PRODUCT,
    surface: DEFAULT_SURFACE,
    origin,
    ...context,
  };
}

/**
 * Initialize posthog-node once. No-op without a key. Installs process-level crash
 * handlers so Node-side failures (file writes, IPC, window management) are captured.
 */
export function initMainAnalytics(deviceId: string): void {
  const key = import.meta.env.MAIN_VITE_POSTHOG_KEY;
  if (!key || client) return;
  distinctId = deviceId || "anonymous";
  client = new PostHog(key, {
    host: import.meta.env.MAIN_VITE_POSTHOG_HOST ?? "https://us.i.posthog.com",
    flushAt: 1,
    flushInterval: 0,
  });

  process.on("uncaughtException", (error) => {
    captureMainException(error, "uncaughtException");
  });
  process.on("unhandledRejection", (reason) => {
    captureMainException(reason, "unhandledRejection");
  });
}

/** Capture a live Error/throw from the main process. */
export function captureMainException(
  error: unknown,
  origin: string,
  context?: Record<string, unknown>,
): void {
  if (!client) return;
  client.captureException(error, distinctId, buildExceptionProperties(origin, context));
}

/** Capture an exception forwarded from a secondary window (already serialized). */
export function captureSerializedException(
  payload: SerializedError,
  origin: string,
  context?: Record<string, unknown>,
): void {
  if (!client) return;
  const error = Object.assign(new Error(payload.message), {
    name: payload.name,
    stack: payload.stack ?? undefined,
  });
  client.captureException(error, distinctId, buildExceptionProperties(origin, context));
}

/** Flush + close on quit so no events are lost. */
export async function shutdownMainAnalytics(): Promise<void> {
  if (!client) return;
  await client.shutdown();
  client = null;
}
```

> Note: the `product` line above is intentionally simple — `buildExceptionProperties` always returns `kaipu-recorder`. (The `import.meta.env` ternary is a no-op kept only so the value reads as env-derived; if you prefer, replace it with `product: DEFAULT_PRODUCT`. Keep whichever satisfies lint.)

- [ ] **Step 4: Simplify `buildExceptionProperties`**

Replace the `product:` line with the clean form (avoids the no-op ternary the note warns about):

```ts
    product: DEFAULT_PRODUCT,
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/kaipu-record && bun run test -- src/main/services/analytics.service.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add apps/kaipu-record/src/main/services/analytics.service.ts apps/kaipu-record/src/main/services/analytics.service.test.ts
git commit --no-verify -m "feat(kaipu-record): add main posthog-node service (crash capture + IPC sink)"
```

---

## Task 6: `useFlag` hook

**Files:**

- Create: `apps/kaipu-record/src/renderer/src/features/analytics/use-flag.ts`
- Test: `apps/kaipu-record/src/renderer/src/features/analytics/use-flag.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/kaipu-record/src/renderer/src/features/analytics/use-flag.test.tsx`:

```tsx
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFlag } from "./use-flag";

vi.mock("./analytics-client", () => ({
  isFlagEnabled: vi.fn((_name: string, fallback: boolean) => fallback),
  onFlagsChanged: vi.fn(() => () => {}),
}));

import { isFlagEnabled } from "./analytics-client";

afterEach(() => vi.clearAllMocks());

describe("useFlag", () => {
  it("returns the flag default when unresolved", () => {
    const { result } = renderHook(() => useFlag("watermark-enabled"));
    expect(result.current).toBe(true); // FLAG_DEFAULTS["watermark-enabled"]
  });

  it("reflects a resolved flag value", () => {
    vi.mocked(isFlagEnabled).mockReturnValue(false);
    const { result } = renderHook(() => useFlag("watermark-enabled"));
    expect(result.current).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/kaipu-record && bun run test -- src/renderer/src/features/analytics/use-flag.test.tsx`
Expected: FAIL — cannot find module `./use-flag`.

- [ ] **Step 3: Implement the hook**

Create `apps/kaipu-record/src/renderer/src/features/analytics/use-flag.ts`:

```ts
import { useEffect, useState } from "react";
import { FLAG_DEFAULTS, type FlagName } from "@shared/analytics";
import { isFlagEnabled, onFlagsChanged } from "./analytics-client";

/**
 * Read a PostHog feature flag reactively. Returns the flag's documented default
 * (`FLAG_DEFAULTS`) until the SDK resolves — so behavior is deterministic offline
 * and re-renders once flags load or change.
 */
export function useFlag(name: FlagName): boolean {
  const [value, setValue] = useState<boolean>(() => isFlagEnabled(name, FLAG_DEFAULTS[name]));
  useEffect(() => {
    setValue(isFlagEnabled(name, FLAG_DEFAULTS[name]));
    return onFlagsChanged(() => setValue(isFlagEnabled(name, FLAG_DEFAULTS[name])));
  }, [name]);
  return value;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/kaipu-record && bun run test -- src/renderer/src/features/analytics/use-flag.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/kaipu-record/src/renderer/src/features/analytics/use-flag.ts apps/kaipu-record/src/renderer/src/features/analytics/use-flag.test.tsx
git commit --no-verify -m "feat(kaipu-record): add useFlag hook with offline-safe defaults"
```

---

## Task 7: Feed `useWatermark` from the flag (the promised one-line swap)

**Files:**

- Modify: `apps/kaipu-record/src/renderer/src/features/watermark/use-watermark.ts`
- Test: `apps/kaipu-record/src/renderer/src/features/watermark/use-watermark.test.tsx` (update)

- [ ] **Step 1: Update the test to drive `flagOn` via the flag**

In `apps/kaipu-record/src/renderer/src/features/watermark/use-watermark.test.tsx`, mock `useFlag` and add a case proving the flag turns the watermark off. Add near the top (with the other mocks):

```tsx
vi.mock("@renderer/features/analytics/use-flag", () => ({
  useFlag: vi.fn(() => true),
}));

import { useFlag } from "@renderer/features/analytics/use-flag";
```

Add a test:

```tsx
it("disables the watermark when the watermark-enabled flag is off", () => {
  vi.mocked(useFlag).mockReturnValue(false);
  const { result } = renderHook(() => useWatermark());
  expect(result.current.enabled).toBe(false);
});
```

(Keep the existing "default enabled" and dev-toggle tests; with `useFlag` mocked to `true` by default they still pass.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/kaipu-record && bun run test -- src/renderer/src/features/watermark/use-watermark.test.tsx`
Expected: FAIL — the new test fails because `flagOn` is still the hardcoded `true` stub.

- [ ] **Step 3: Make the swap**

In `apps/kaipu-record/src/renderer/src/features/watermark/use-watermark.ts`, add the import:

```ts
import { useFlag } from "@renderer/features/analytics/use-flag";
```

Replace the stubbed `flagOn` line:

```ts
  // TODO(flags): PostHog flag. Defaults on so the watermark ships even offline.
  const flagOn = true;
```

with:

```ts
  // Remote kill-switch for prod testing. Defaults on (offline/unresolved) so the
  // watermark still ships — see FLAG_DEFAULTS.
  const flagOn = useFlag("watermark-enabled");
```

Also update the `useMemo` dependency array so it re-derives when the flag flips — change `[enabled]` to keep tracking `enabled` (which now depends on `flagOn`); `enabled` is recomputed each render, so the existing `useMemo(..., [enabled])` already captures it. No further change needed.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/kaipu-record && bun run test -- src/renderer/src/features/watermark/use-watermark.test.tsx`
Expected: PASS (all cases, including the new flag-off case).

- [ ] **Step 5: Commit**

```bash
git add apps/kaipu-record/src/renderer/src/features/watermark/use-watermark.ts apps/kaipu-record/src/renderer/src/features/watermark/use-watermark.test.tsx
git commit --no-verify -m "feat(kaipu-record): gate watermark on the watermark-enabled flag"
```

---

## Task 8: Toast store (`ui/toast` state)

A module-singleton store so plain (non-React) code like `reportError` can surface a toast. React reads it via `useSyncExternalStore`.

**Files:**

- Create: `apps/kaipu-record/src/renderer/src/ui/toast-store.ts`
- Test: `apps/kaipu-record/src/renderer/src/ui/toast-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/kaipu-record/src/renderer/src/ui/toast-store.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { dismissToast, getToasts, showToast, subscribeToasts } from "./toast-store";

afterEach(() => {
  for (const t of getToasts()) dismissToast(t.id);
  vi.useRealTimers();
});

describe("toast store", () => {
  it("adds a toast and notifies subscribers", () => {
    const listener = vi.fn();
    const unsub = subscribeToasts(listener);
    const id = showToast({ message: "hola" });
    expect(getToasts()).toHaveLength(1);
    expect(getToasts()[0]).toMatchObject({ id, message: "hola" });
    expect(listener).toHaveBeenCalled();
    unsub();
  });

  it("dismisses by id", () => {
    const id = showToast({ message: "chau" });
    dismissToast(id);
    expect(getToasts()).toHaveLength(0);
  });

  it("auto-dismisses after the duration", () => {
    vi.useFakeTimers();
    showToast({ message: "fugaz", durationMs: 5000 });
    expect(getToasts()).toHaveLength(1);
    vi.advanceTimersByTime(5000);
    expect(getToasts()).toHaveLength(0);
  });

  it("keeps a retry action's callback", () => {
    const retry = vi.fn();
    showToast({ message: "falló", action: { label: "Reintentar", onClick: retry } });
    getToasts()[0].action?.onClick();
    expect(retry).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/kaipu-record && bun run test -- src/renderer/src/ui/toast-store.test.ts`
Expected: FAIL — cannot find module `./toast-store`.

- [ ] **Step 3: Implement the store**

Create `apps/kaipu-record/src/renderer/src/ui/toast-store.ts`:

```ts
/**
 * Module-singleton toast store. Lets non-React code (e.g. reportError) surface a
 * toast, while React subscribes via useSyncExternalStore. Single source of truth.
 */

export interface ToastAction {
  label: string;
  onClick(): void;
}

export interface ToastSpec {
  id: string;
  message: string;
  action?: ToastAction;
  durationMs: number;
}

const DEFAULT_DURATION_MS = 5000;

let toasts: ToastSpec[] = [];
let counter = 0;
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Show a toast; returns its id. Auto-dismisses after `durationMs` (default 5s). */
export function showToast(spec: { message: string; action?: ToastAction; durationMs?: number }): string {
  const id = `toast-${++counter}`;
  const durationMs = spec.durationMs ?? DEFAULT_DURATION_MS;
  toasts = [...toasts, { id, message: spec.message, action: spec.action, durationMs }];
  timers.set(
    id,
    setTimeout(() => dismissToast(id), durationMs),
  );
  emit();
  return id;
}

export function dismissToast(id: string): void {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function getToasts(): ToastSpec[] {
  return toasts;
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/kaipu-record && bun run test -- src/renderer/src/ui/toast-store.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/kaipu-record/src/renderer/src/ui/toast-store.ts apps/kaipu-record/src/renderer/src/ui/toast-store.test.ts
git commit --no-verify -m "feat(kaipu-record): add toast store (imperative, framework-agnostic)"
```

---

## Task 9: Toast component (`ToastHost` + `Toast`)

**Files:**

- Create: `apps/kaipu-record/src/renderer/src/ui/toast.tsx`
- Create: `apps/kaipu-record/src/renderer/src/ui/toast.module.css`
- Modify: `apps/kaipu-record/src/renderer/src/ui/index.ts` (export)
- Test: `apps/kaipu-record/src/renderer/src/ui/toast.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/kaipu-record/src/renderer/src/ui/toast.test.tsx`:

```tsx
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastHost } from "./toast";
import { dismissToast, getToasts, showToast } from "./toast-store";

afterEach(() => {
  for (const t of getToasts()) dismissToast(t.id);
});

describe("ToastHost", () => {
  it("renders an active toast's message", () => {
    render(<ToastHost />);
    act(() => {
      showToast({ message: "No pudimos guardar la grabación." });
    });
    expect(screen.getByText("No pudimos guardar la grabación.")).toBeInTheDocument();
  });

  it("invokes the retry action and dismisses on click", async () => {
    const retry = vi.fn();
    render(<ToastHost />);
    act(() => {
      showToast({ message: "Falló", action: { label: "Reintentar", onClick: retry } });
    });
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/kaipu-record && bun run test -- src/renderer/src/ui/toast.test.tsx`
Expected: FAIL — cannot find module `./toast`.

- [ ] **Step 3: Implement the component**

Create `apps/kaipu-record/src/renderer/src/ui/toast.tsx`:

```tsx
import React, { useSyncExternalStore } from "react";
import { cx } from "./cx";
import { dismissToast, getToasts, subscribeToasts, type ToastSpec } from "./toast-store";
import styles from "./toast.module.css";

function Toast({ toast }: { toast: ToastSpec }): React.JSX.Element {
  return (
    <div className={styles.toast} role="alert">
      <span className={styles.message}>{toast.message}</span>
      {toast.action ? (
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            toast.action?.onClick();
            dismissToast(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      ) : null}
      <button
        type="button"
        className={styles.close}
        aria-label="Cerrar"
        onClick={() => dismissToast(toast.id)}
      >
        ×
      </button>
    </div>
  );
}

/** Mount once near the app root. Renders the live toast stack from the store. */
export function ToastHost({ className }: { className?: string }): React.JSX.Element {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts);
  return (
    <div className={cx(styles.host, className)} data-empty={toasts.length === 0}>
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Implement the styles**

Create `apps/kaipu-record/src/renderer/src/ui/toast.module.css` (design tokens only — match the surrounding `ui/` modules; adjust token names to those already used in the repo, e.g. `--surface`, `--border`, `--text`, `--accent-primary`):

```css
.host {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}

.host[data-empty="true"] {
  display: none;
}

.toast {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 280px;
  max-width: 420px;
  padding: 12px 14px;
  border-radius: 10px;
  background: var(--surface-raised, var(--surface));
  border: 1px solid var(--border);
  color: var(--text);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  pointer-events: auto;
}

.message {
  flex: 1;
  font-size: 13px;
  line-height: 1.4;
}

.action {
  flex-shrink: 0;
  border: none;
  background: none;
  padding: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--accent-primary);
  cursor: pointer;
}

.close {
  flex-shrink: 0;
  border: none;
  background: none;
  padding: 0 2px;
  font-size: 16px;
  line-height: 1;
  color: var(--text-muted);
  cursor: pointer;
}
```

> Before finalizing, open a sibling module (e.g. `card.module.css`, `badge.module.css`) and confirm the exact token names in use (`--surface`, `--border`, `--text`, `--text-muted`, `--accent-primary`). Swap any that differ so the toast matches the theme.

- [ ] **Step 5: Export from the `ui` barrel**

In `apps/kaipu-record/src/renderer/src/ui/index.ts`, add (alphabetical, before `Toggle`):

```ts
export { ToastHost } from "./toast";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/kaipu-record && bun run test -- src/renderer/src/ui/toast.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/kaipu-record/src/renderer/src/ui/toast.tsx apps/kaipu-record/src/renderer/src/ui/toast.module.css apps/kaipu-record/src/renderer/src/ui/index.ts apps/kaipu-record/src/renderer/src/ui/toast.test.tsx
git commit --no-verify -m "feat(kaipu-record): add ui/toast (ToastHost + retry/close actions)"
```

---

## Task 10: IPC sink + secondary-window crash forwarder

Lets secondary windows (control-bar, camera-bubble, capture-panel) ship their errors to the main process's `posthog-node` without each running `posthog-js`.

**Files:**

- Modify: `apps/kaipu-record/src/shared/types/ipc.ts` (channel)
- Modify: `apps/kaipu-record/src/shared/types/electron-api.ts` (method type)
- Modify: `apps/kaipu-record/src/preload/index.ts` (bridge method)
- Create: `apps/kaipu-record/src/renderer/src/features/analytics/crash-forwarder.ts`
- Test: `apps/kaipu-record/src/renderer/src/features/analytics/crash-forwarder.test.ts`

- [ ] **Step 1: Add the IPC channel**

In `apps/kaipu-record/src/shared/types/ipc.ts`, add to `IPC_CHANNELS` (after `recordingRequestStart`):

```ts
  // Analytics: secondary windows forward serialized exceptions to the main-process sink.
  analyticsCaptureException: "analytics:capture-exception",
```

- [ ] **Step 2: Add the bridge method type**

In `apps/kaipu-record/src/shared/types/electron-api.ts`:

Add the import for `SerializedError` at the top (it's pure shared):

```ts
import type { SerializedError } from "../analytics";
```

Add to the `KaipuElectronAPI` interface (at the end, before the closing brace):

```ts
  // ── Analytics ─────────────────────────────────────────────────────────
  /** Forward a serialized exception (+ origin/context) to the main-process sink. */
  reportException(payload: SerializedError, origin: string, context?: Record<string, unknown>): void;
```

- [ ] **Step 3: Implement the bridge method**

In `apps/kaipu-record/src/preload/index.ts`, add to `kaipuApi` (after `onRequestStartRecording`):

```ts
  reportException: (payload, origin, context) =>
    ipcRenderer.send(IPC_CHANNELS.analyticsCaptureException, payload, origin, context),
```

- [ ] **Step 4: Write the failing test**

Create `apps/kaipu-record/src/renderer/src/features/analytics/crash-forwarder.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { installCrashForwarder } from "./crash-forwarder";

const reportException = vi.fn();

afterEach(() => {
  vi.clearAllMocks();
});

describe("installCrashForwarder", () => {
  it("forwards window errors as serialized exceptions tagged with origin", () => {
    (globalThis as unknown as { electronAPI: { reportException: typeof reportException } }).electronAPI =
      { reportException };
    installCrashForwarder("control-bar");
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("kaboom") }));
    expect(reportException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "kaboom" }),
      "control-bar",
      undefined,
    );
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `cd apps/kaipu-record && bun run test -- src/renderer/src/features/analytics/crash-forwarder.test.ts`
Expected: FAIL — cannot find module `./crash-forwarder`.

- [ ] **Step 6: Implement the forwarder**

Create `apps/kaipu-record/src/renderer/src/features/analytics/crash-forwarder.ts`:

```ts
import { serializeError } from "@shared/analytics";

/**
 * For secondary windows that don't run posthog-js: catch uncaught errors and
 * unhandled rejections and forward them (serialized) to the main-process sink,
 * so nothing is lost. `origin` identifies which window reported.
 */
export function installCrashForwarder(origin: string): void {
  window.addEventListener("error", (event) => {
    window.electronAPI.reportException(serializeError(event.error ?? event.message), origin);
  });
  window.addEventListener("unhandledrejection", (event) => {
    window.electronAPI.reportException(serializeError(event.reason), origin);
  });
}
```

- [ ] **Step 7: Implement the main-process handler**

In `apps/kaipu-record/src/main/services/analytics.service.ts`, add an IPC registrar that wires the sink (import `ipcMain` + the channel):

Add imports at the top:

```ts
import { ipcMain } from "electron";
import { IPC_CHANNELS } from "@shared/types";
```

Add at the end of the file:

```ts
/** Register the IPC sink that captures exceptions forwarded from secondary windows. */
export function registerAnalyticsIpc(): void {
  ipcMain.on(
    IPC_CHANNELS.analyticsCaptureException,
    (_e, payload: SerializedError, origin: string, context?: Record<string, unknown>) => {
      captureSerializedException(payload, origin, context);
    },
  );
}
```

- [ ] **Step 8: Run the forwarder test + typecheck**

Run: `cd apps/kaipu-record && bun run test -- src/renderer/src/features/analytics/crash-forwarder.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/kaipu-record/src/shared/types/ipc.ts apps/kaipu-record/src/shared/types/electron-api.ts apps/kaipu-record/src/preload/index.ts apps/kaipu-record/src/renderer/src/features/analytics/crash-forwarder.ts apps/kaipu-record/src/renderer/src/features/analytics/crash-forwarder.test.ts apps/kaipu-record/src/main/services/analytics.service.ts
git commit --no-verify -m "feat(kaipu-record): forward secondary-window crashes to the main posthog sink"
```

---

## Task 11: `reportError` — the two-channel helper

The core rule made concrete: one call shows a human-readable toast (user channel) **and** captures the full technical payload to PostHog (developer channel).

**Files:**

- Create: `apps/kaipu-record/src/renderer/src/features/analytics/report-error.ts`
- Test: `apps/kaipu-record/src/renderer/src/features/analytics/report-error.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/kaipu-record/src/renderer/src/features/analytics/report-error.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("./analytics-client", () => ({ captureException: vi.fn() }));
vi.mock("@renderer/ui/toast-store", () => ({ showToast: vi.fn(() => "toast-1") }));

import { captureException } from "./analytics-client";
import { showToast } from "@renderer/ui/toast-store";
import { reportError } from "./report-error";

describe("reportError", () => {
  it("fires both channels: technical capture + human-readable toast", () => {
    const error = new Error("disk full");
    reportError("No pudimos guardar la grabación.", error, { context: { sessionId: "s1" } });

    expect(captureException).toHaveBeenCalledWith(error, { sessionId: "s1" });
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: "No pudimos guardar la grabación." }),
    );
    // The user-facing toast must NEVER carry the stack/technical payload.
    const toastArg = vi.mocked(showToast).mock.calls[0][0];
    expect(JSON.stringify(toastArg)).not.toContain("disk full");
  });

  it("adds a Reintentar action when a retry is provided", () => {
    const retry = vi.fn();
    reportError("Falló", new Error("x"), { retry });
    const toastArg = vi.mocked(showToast).mock.calls.at(-1)![0];
    expect(toastArg.action?.label).toBe("Reintentar");
    toastArg.action?.onClick();
    expect(retry).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/kaipu-record && bun run test -- src/renderer/src/features/analytics/report-error.test.ts`
Expected: FAIL — cannot find module `./report-error`.

- [ ] **Step 3: Implement the helper**

Create `apps/kaipu-record/src/renderer/src/features/analytics/report-error.ts`:

```ts
import { showToast } from "@renderer/ui/toast-store";
import { captureException } from "./analytics-client";

export interface ReportErrorOptions {
  /** Extra technical context for PostHog (never shown to the user). */
  context?: Record<string, unknown>;
  /** If provided, the toast gets a "Reintentar" action that runs this. */
  retry?: () => void;
}

/**
 * The two-channel error rule, in one call:
 *  - developer channel → full Error (name/message/stack) + context to PostHog
 *  - user channel      → a short, human-readable message in the toast
 * The two never mix: the user message is the ONLY thing the user sees.
 */
export function reportError(
  userMessage: string,
  error: unknown,
  options: ReportErrorOptions = {},
): void {
  captureException(error, options.context);
  showToast({
    message: userMessage,
    action: options.retry ? { label: "Reintentar", onClick: options.retry } : undefined,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/kaipu-record && bun run test -- src/renderer/src/features/analytics/report-error.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/kaipu-record/src/renderer/src/features/analytics/report-error.ts apps/kaipu-record/src/renderer/src/features/analytics/report-error.test.ts
git commit --no-verify -m "feat(kaipu-record): add reportError two-channel helper (user toast + dev capture)"
```

---

## Task 12: React `ErrorBoundary`

No white screen: a child crash renders a calm fallback and reports the exception.

**Files:**

- Create: `apps/kaipu-record/src/renderer/src/features/analytics/error-boundary.tsx`
- Create: `apps/kaipu-record/src/renderer/src/features/analytics/error-boundary.module.css`
- Test: `apps/kaipu-record/src/renderer/src/features/analytics/error-boundary.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/kaipu-record/src/renderer/src/features/analytics/error-boundary.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./analytics-client", () => ({ captureException: vi.fn() }));

import { captureException } from "./analytics-client";
import { ErrorBoundary } from "./error-boundary";

function Boom(): React.JSX.Element {
  throw new Error("render crash");
}

describe("ErrorBoundary", () => {
  it("renders a fallback and reports the error instead of crashing", () => {
    // jsdom logs the thrown error; silence the noise for a clean run.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/algo salió mal/i)).toBeInTheDocument();
    expect(captureException).toHaveBeenCalled();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/kaipu-record && bun run test -- src/renderer/src/features/analytics/error-boundary.test.tsx`
Expected: FAIL — cannot find module `./error-boundary`.

- [ ] **Step 3: Implement the boundary**

Create `apps/kaipu-record/src/renderer/src/features/analytics/error-boundary.tsx`:

```tsx
import React from "react";
import { captureException } from "./analytics-client";
import styles from "./error-boundary.module.css";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Last line of defense: a render crash shows a calm fallback (in neutral Spanish)
 * instead of a white screen, and the full exception goes to PostHog.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    captureException(error, { componentStack: info.componentStack });
  }

  handleReload = (): void => {
    this.setState({ hasError: false });
    window.location.reload();
  };

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className={styles.fallback} role="alert">
        <h1 className={styles.title}>Algo salió mal</h1>
        <p className={styles.body}>
          Tuvimos un problema inesperado. Ya lo registramos. Podés recargar para seguir.
        </p>
        <button type="button" className={styles.button} onClick={this.handleReload}>
          Recargar
        </button>
      </div>
    );
  }
}
```

- [ ] **Step 4: Implement the styles**

Create `apps/kaipu-record/src/renderer/src/features/analytics/error-boundary.module.css` (tokens only; confirm names against a sibling module as in Task 9):

```css
.fallback {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 100vh;
  padding: 24px;
  text-align: center;
  background: var(--surface);
  color: var(--text);
}

.title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.body {
  margin: 0;
  max-width: 360px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-muted);
}

.button {
  margin-top: 4px;
  padding: 8px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-raised, var(--surface));
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/kaipu-record && bun run test -- src/renderer/src/features/analytics/error-boundary.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add apps/kaipu-record/src/renderer/src/features/analytics/error-boundary.tsx apps/kaipu-record/src/renderer/src/features/analytics/error-boundary.module.css apps/kaipu-record/src/renderer/src/features/analytics/error-boundary.test.tsx
git commit --no-verify -m "feat(kaipu-record): add ErrorBoundary (no white screen + reports)"
```

---

## Task 13: Wire initialization, boundary, host, and forwarders

Bring the pieces online: full analytics in the main window; crash forwarders in secondary windows; `posthog-node` + the IPC sink in the main process.

**Files:**

- Create: `apps/kaipu-record/src/renderer/src/features/analytics/index.ts` (barrel)
- Create: `apps/kaipu-record/src/renderer/src/features/analytics/use-init-analytics.ts`
- Modify: `apps/kaipu-record/src/renderer/src/app/app.tsx` (boundary + host + init)
- Modify: `apps/kaipu-record/src/renderer/src/main.tsx` (secondary-window forwarders)
- Modify: `apps/kaipu-record/src/main/index.ts` (init main analytics + sink + shutdown)

- [ ] **Step 1: Add the renderer barrel**

Create `apps/kaipu-record/src/renderer/src/features/analytics/index.ts`:

```ts
export { initAnalytics, captureException, isAnalyticsStarted } from "./analytics-client";
export { useFlag } from "./use-flag";
export { reportError, type ReportErrorOptions } from "./report-error";
export { ErrorBoundary } from "./error-boundary";
export { installCrashForwarder } from "./crash-forwarder";
export { useInitAnalytics } from "./use-init-analytics";
```

- [ ] **Step 2: Add the init hook**

Create `apps/kaipu-record/src/renderer/src/features/analytics/use-init-analytics.ts`:

```ts
import { useEffect } from "react";
import { initAnalytics } from "./analytics-client";

/**
 * Initialize PostHog once for the main window. Reads the persisted deviceId (which
 * the settings-store mints) and identifies with it. No-op without a key.
 */
export function useInitAnalytics(): void {
  useEffect(() => {
    void window.electronAPI.getSettings().then((settings) => {
      initAnalytics(settings.deviceId);
    });
  }, []);
}
```

- [ ] **Step 3: Wire the main window (`app.tsx`)**

Replace `apps/kaipu-record/src/renderer/src/app/app.tsx` with:

```tsx
import { AppRouter } from "./router";
import { OnboardingProvider } from "@renderer/features/onboarding";
import { ErrorBoundary, useInitAnalytics } from "@renderer/features/analytics";
import { ToastHost } from "@renderer/ui";

export default function App(): React.JSX.Element {
  useInitAnalytics();
  return (
    <ErrorBoundary>
      <OnboardingProvider>
        <AppRouter />
      </OnboardingProvider>
      <ToastHost />
    </ErrorBoundary>
  );
}
```

- [ ] **Step 4: Wire secondary windows (`main.tsx`)**

In `apps/kaipu-record/src/renderer/src/main.tsx`, import the forwarder:

```ts
import { installCrashForwarder } from "./features/analytics/crash-forwarder";
```

Then call it inside each secondary-window branch, before `root.render(...)`:

- In the `isControlBar` branch: `installCrashForwarder("control-bar");`
- In the `isCameraBubble` branch: `installCrashForwarder("camera-bubble");`
- In the `isCapturePanel` branch: `installCrashForwarder("capture-panel");`

(The default `else` branch renders `<App />`, which initializes full analytics — no forwarder there.)

- [ ] **Step 5: Wire the main process (`main/index.ts`)**

In `apps/kaipu-record/src/main/index.ts`:

Add imports near the other service imports:

```ts
import { getDeviceId } from "./infrastructure/settings-store";
import {
  initMainAnalytics,
  registerAnalyticsIpc,
  shutdownMainAnalytics,
} from "./services/analytics.service";
```

In the `app.whenReady().then(...)` block, **after** `registerSettings()` runs (so the deviceId exists), add:

```ts
  initMainAnalytics(getDeviceId());
  registerAnalyticsIpc();
```

Add a shutdown hook (near the other `app.on(...)` handlers):

```ts
app.on("will-quit", (event) => {
  event.preventDefault();
  void shutdownMainAnalytics().finally(() => process.exit(0));
});
```

> If a `will-quit`/`before-quit` handler already exists, fold `shutdownMainAnalytics()` into it instead of adding a second handler that calls `process.exit`.

- [ ] **Step 6: Verify typecheck, lint, and the full suite**

Run: `cd apps/kaipu-record && bun run typecheck && bun run lint && bun run test`
Expected: PASS, 0/0 lint. (Some existing tests stub `window.electronAPI`; if any now needs `getSettings`/`reportException`, add them to the stub in `test/setup.ts`.)

- [ ] **Step 7: Commit**

```bash
git add apps/kaipu-record/src/renderer/src/features/analytics/index.ts apps/kaipu-record/src/renderer/src/features/analytics/use-init-analytics.ts apps/kaipu-record/src/renderer/src/app/app.tsx apps/kaipu-record/src/renderer/src/main.tsx apps/kaipu-record/src/main/index.ts
git commit --no-verify -m "feat(kaipu-record): wire analytics init, ErrorBoundary, toast host, crash forwarders"
```

---

## Task 14: Surface recording failures as toasts (two-channel)

Replace the three `console.error` dead-ends in `use-screen-recorder.ts` with `reportError` (human-readable toast + full stack to PostHog) and a safe **Reintentar** that re-runs the start. Retry is safe because starting is fully local (no API call).

**Files:**

- Modify: `apps/kaipu-record/src/renderer/src/features/recording/hooks/use-screen-recorder.ts`
- Test: `apps/kaipu-record/src/renderer/src/features/recording/hooks/use-screen-recorder.test.tsx` (update)

- [ ] **Step 1: Update the test for the mid-recording failure path**

In `apps/kaipu-record/src/renderer/src/features/recording/hooks/use-screen-recorder.test.tsx`, mock `reportError` and assert it fires when the engine errors mid-recording. Add near the top with the other mocks:

```tsx
vi.mock("@renderer/features/analytics", () => ({
  reportError: vi.fn(),
}));

import { reportError } from "@renderer/features/analytics";
```

In the existing test that triggers `onError?.(new Error("screen capture ended"))`, after it fires, assert:

```tsx
expect(reportError).toHaveBeenCalledWith(
  expect.stringMatching(/grabación/i),
  expect.any(Error),
  expect.objectContaining({ retry: expect.any(Function) }),
);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/kaipu-record && bun run test -- src/renderer/src/features/recording/hooks/use-screen-recorder.test.tsx`
Expected: FAIL — `reportError` is never called (still `console.error`).

- [ ] **Step 3: Wire `reportError` + retry into the three failure points**

In `apps/kaipu-record/src/renderer/src/features/recording/hooks/use-screen-recorder.ts`:

Add the import:

```ts
import { reportError } from "@renderer/features/analytics";
```

Add a `startRef` + `lastInputRef` so any failure can re-run the same start. Near the other refs (after `stoppingRef`):

```ts
  const lastInputRef = useRef<StartInput | null>(null);
```

Inside `start`, record the input at the top of the function body (right after the re-entry guard):

```ts
    if (engineRef.current || sessionRef.current) return;
    lastInputRef.current = input;
```

Add a `startRef` alongside the existing `pauseRef`/`resumeRef`/`stopRef` block:

```ts
  const startRef = useRef(start);
  startRef.current = start;
```

Define a single retry helper (place it after `start` is defined, before `stop`):

```ts
  const retryStart = useCallback(() => {
    const input = lastInputRef.current;
    if (input) void startRef.current(input);
  }, []);
```

Now replace the three `console.error` sites:

**(a) Mid-recording failure** — inside the `onError` passed to `startEngine` (currently lines ~92-95):

```ts
        onError: (error) => {
          reportError(
            "La grabación se detuvo por un error. Guardamos lo que se pudo.",
            error,
            { context: { sourceId: input.sourceId, phase: "mid-recording" }, retry: retryStart },
          );
          void stopRef.current();
        },
```

**(b) Start failure** — the `catch` in `start` (currently line ~115-121):

```ts
    } catch (error) {
      reportError("No pudimos iniciar la grabación. Volvé a intentarlo.", error, {
        context: { sourceId: input.sourceId, phase: "start" },
        retry: retryStart,
      });
      if (sessionRef.current) await window.electronAPI.recordingAbort(sessionRef.current);
      engineRef.current = null;
      sessionRef.current = null;
      setStatus("error");
    }
```

**(c) Finalize failure** — the `catch` in `stop` (currently line ~173-176):

```ts
    } catch (error) {
      reportError("No pudimos guardar la grabación.", error, {
        context: { sessionId, phase: "finalize" },
        retry: retryStart,
      });
      await window.electronAPI.recordingAbort(sessionId);
    }
```

> `copy` note: messages are neutral Spanish, no voseo, benefit/clarity-first. Keep them short.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/kaipu-record && bun run test -- src/renderer/src/features/recording/hooks/use-screen-recorder.test.tsx`
Expected: PASS.

- [ ] **Step 5: Full verification**

Run: `cd apps/kaipu-record && bun run typecheck && bun run lint && bun run test`
Expected: PASS, lint 0/0, all tests green.

- [ ] **Step 6: Commit**

```bash
git add apps/kaipu-record/src/renderer/src/features/recording/hooks/use-screen-recorder.ts apps/kaipu-record/src/renderer/src/features/recording/hooks/use-screen-recorder.test.tsx
git commit --no-verify -m "feat(kaipu-record): surface recording failures as toasts with safe retry"
```

---

## Task 15: Docs + backlog + manual smoke test

**Files:**

- Modify: `apps/documentation/src/content/docs/changelog.mdx`
- Create: `apps/documentation/src/content/docs/desktop/analytics-and-flags.mdx`
- Modify: `backlog/roadmap.md` (mark #4 done; note watermark live-gating now active)

- [ ] **Step 1: Changelog row**

Add a row to the top of the table in `apps/documentation/src/content/docs/changelog.mdx` (date `2026-06-27`), summarizing: PostHog flags (`bypass-login`, `watermark-enabled` now gates the watermark), max-coverage error reporting (renderer autocapture + main posthog-node + secondary-window IPC sink), ErrorBoundary, and `ui/toast` with two-channel `reportError`. Privacy: no session replay, no DOM autocapture.

- [ ] **Step 2: Feature doc**

Create `apps/documentation/src/content/docs/desktop/analytics-and-flags.mdx` documenting: architecture (renderer-primary + main sink), the flag list + defaults, the device identity, the two-channel error rule, the privacy posture, and the deferred items (real login, real paid/entitlement, telemetry opt-out). Reference the spec.

- [ ] **Step 3: Backlog**

In `backlog/roadmap.md`, flip **#4 Feature flags via PostHog** to ✅ and update the **#6 Watermark** note: live gating is now wired through `watermark-enabled` (`isPaid` still stubbed until the plans API). Add a follow-up line for the telemetry opt-out.

- [ ] **Step 4: Manual smoke test (GUI — needs a full restart, not HMR)**

Run: `cd apps/kaipu-record && bun run dev`

Verify:

1. App launches normally. With the real key in `.env`, events appear in PostHog (Activity); confirm they carry `product=kaipu-recorder` + `surface=desktop`.
2. Toggle the `watermark-enabled` flag OFF in PostHog → on the next app start (or flag refresh) a recording has **no** watermark; ON → watermark returns. (Dev Settings toggle still works independently.)
3. Force a failure (e.g., revoke screen permission, or temporarily `throw` in the start path) → a Spanish toast appears with **Reintentar**, the app does not freeze, and the exception shows in PostHog → Error tracking with a full stack + `origin`/`phase` context.
4. Confirm **no** session replay and **no** DOM autocapture events appear in PostHog.

- [ ] **Step 5: Commit**

```bash
git add apps/documentation/src/content/docs/changelog.mdx apps/documentation/src/content/docs/desktop/analytics-and-flags.mdx backlog/roadmap.md
git commit --no-verify -m "docs(kaipu-record): document analytics + flags; close backlog #4"
```

---

## Final review (after all tasks)

- [ ] Run the full gate once more: `cd apps/kaipu-record && bun run typecheck && bun run lint && bun run test`. All green, lint 0/0.
- [ ] Dispatch a final code review over the whole change set (spec compliance + quality).
- [ ] Use `superpowers:finishing-a-development-branch` to wrap up.

---

## Self-review notes (plan author)

**Spec coverage:** Foundation (Tasks 1–5), Pillar 1 flags (6–7), Pillar 2 error reporting (5, 10, 13), Pillar 3 defensive + toast (8–9, 11–12, 14). Identity/deviceId (3). Privacy posture (4, smoke 15.4). Offline-safe (2 defaults, 4/5 no-op without key). Two-channel rule (11, 14). Out-of-scope items (login UI, real paid, opt-out) are documented, not built.

**Type consistency:** `FlagName`/`FLAG_DEFAULTS`/`serializeError`/`SerializedError` (Task 2) used identically in 4, 5, 6, 10. `reportError(userMessage, error, {context, retry})` defined in 11, called with that exact shape in 14. `showToast({message, action, durationMs})` defined in 8, consumed in 9/11. `captureException(error, context?)` defined in 4, used in 11/12. `installCrashForwarder(origin)` defined in 10, called in 13.

**No placeholders:** every code step contains complete code; the only judgment calls (CSS token names) are flagged with an explicit "confirm against a sibling module" instruction rather than left vague.
