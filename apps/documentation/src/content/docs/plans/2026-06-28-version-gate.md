---
title: Version gate — implementation plan
description: Task-by-task TDD plan to build the fail-open remote-config version gate (hard kill-switch + soft nudge) in the kaipu-record desktop app.
---

# Version Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Block builds below a remote `minVersion` with a non-dismissible overlay and nudge builds below `latestVersion` with a dismissible banner, evaluated in the renderer against a JSON config on Cloudflare, fail-open everywhere.

**Architecture:** A pure shared model (`compareSemver` / `evaluateGate` / `parseVersionGateConfig`) drives a renderer hook (`useVersionGate`) that fetches the remote config on startup + throttled window focus, caches the last-good config, and renders an overlay/banner in `AppShell`. The only new main-process surface is one IPC that exposes `app.getVersion()`. The "Actualizar" button uses `window.open`, routed to the OS browser by the existing `setWindowOpenHandler`.

**Tech Stack:** Electron, React, TypeScript, Vitest + Testing Library. No new runtime deps.

**Spec:** `/specs/2026-06-28-version-gate-design`

**Conventions (read before starting):**
- Repo content (code, comments) is **English**; only end-user copy is Spanish.
- **No TS enums** — `as const` + derived types.
- Commit kaipu-record with `git commit --no-verify` (oxfmt churn hold).
- Run tests from `apps/kaipu-record`: `bunx vitest run <path>`.
- Renderer tests run under the `renderer` (jsdom) project; pure `shared/` tests run under the `main` (node) project. `bunx vitest run path/to/file.test.ts` auto-selects.

---

## File Structure

- **Create** `src/shared/version-gate.ts` — pure model: types, constants, `compareSemver`, `evaluateGate`, `parseVersionGateConfig`.
- **Create** `src/shared/version-gate.test.ts` — pure model tests (node project).
- **Modify** `src/shared/types/ipc.ts` — add `getAppVersion` channel + `ElectronAPI.getAppVersion`.
- **Modify** `src/main/index.ts` — `ipcMain.handle("app:get-version", …)`.
- **Modify** `src/preload/index.ts` — expose `getAppVersion`.
- **Modify** `src/renderer/src/test/setup.ts` — add `getAppVersion` to the stub.
- **Create** `src/renderer/src/features/version-gate/fetch-version-gate-config.ts` (+ test).
- **Create** `src/renderer/src/features/version-gate/use-version-gate.ts` (+ test).
- **Create** `src/renderer/src/features/version-gate/version-gate-overlay.tsx` (+ `.module.css` + test).
- **Create** `src/renderer/src/features/version-gate/version-gate-banner.tsx` (+ `.module.css` + test).
- **Create** `src/renderer/src/features/version-gate/index.ts` — barrel.
- **Modify** `src/renderer/src/shell/app-shell.tsx` — mount the gate.
- **Modify** `.env.example` — document `VITE_VERSION_GATE_URL`.

All paths are relative to `apps/kaipu-record/`.

---

### Task 1: Pure model — types, constants, `compareSemver`

**Files:**
- Create: `src/shared/version-gate.ts`
- Test: `src/shared/version-gate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/version-gate.test.ts
import { describe, expect, it } from "vitest";
import { compareSemver } from "./version-gate";

describe("compareSemver", () => {
  it("orders by major, minor, patch", () => {
    expect(compareSemver("1.0.0", "1.0.1")).toBe(-1);
    expect(compareSemver("1.2.0", "1.1.9")).toBe(1);
    expect(compareSemver("2.0.0", "2.0.0")).toBe(0);
  });

  it("compares numerically, not lexically", () => {
    expect(compareSemver("1.10.0", "1.9.0")).toBe(1);
    expect(compareSemver("1.0.10", "1.0.9")).toBe(1);
  });

  it("pads missing parts with zero", () => {
    expect(compareSemver("1.2", "1.2.0")).toBe(0);
    expect(compareSemver("1", "1.0.1")).toBe(-1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/shared/version-gate.test.ts`
Expected: FAIL — `compareSemver` is not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/shared/version-gate.ts
/**
 * Pure version-gate model shared by both processes. No electron/node/DOM imports.
 * House rule: `as const` + derived types, no TS enums (same idiom as shared/analytics.ts).
 */

/** 10 minutes between network checks — the primary rate limiter for focus re-checks. */
export const VERSION_GATE_THROTTLE_MS = 10 * 60 * 1000;

/** Where the "Actualizar" button points when the config omits a downloadUrl. */
export const DEFAULT_DOWNLOAD_URL =
  "https://github.com/csdev19/kaipu-record-monorepo/releases/latest";

export interface VersionGateConfig {
  minVersion: string;
  latestVersion: string;
  message?: string;
  downloadUrl?: string;
}

export type GateState =
  | { kind: "ok" }
  | { kind: "soft"; message: string; downloadUrl: string }
  | { kind: "hard"; message: string; downloadUrl: string };

/** Parse "1.2.3" into [1, 2, 3]; non-numeric or missing parts become 0. */
function parts(version: string): [number, number, number] {
  const [a, b, c] = version.split(".").map((p) => {
    const n = Number.parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  });
  return [a ?? 0, b ?? 0, c ?? 0];
}

/** -1 | 0 | 1 for a vs b on plain x.y.z. Missing/short parts are treated as 0. */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/shared/version-gate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/version-gate.ts src/shared/version-gate.test.ts
git commit --no-verify -m "feat(version-gate): pure semver comparator + model types"
```

---

### Task 2: Pure model — `evaluateGate` + `parseVersionGateConfig`

**Files:**
- Modify: `src/shared/version-gate.ts`
- Modify: `src/shared/version-gate.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/shared/version-gate.test.ts`:

```ts
import { evaluateGate, parseVersionGateConfig } from "./version-gate";

const config = { minVersion: "1.2.0", latestVersion: "1.4.0" };

describe("evaluateGate", () => {
  it("hard-blocks below minVersion", () => {
    expect(evaluateGate("1.1.0", config).kind).toBe("hard");
  });

  it("soft-nudges at/above minVersion but below latestVersion", () => {
    expect(evaluateGate("1.2.0", config).kind).toBe("soft");
    expect(evaluateGate("1.3.9", config).kind).toBe("soft");
  });

  it("returns ok at/above latestVersion", () => {
    expect(evaluateGate("1.4.0", config).kind).toBe("ok");
    expect(evaluateGate("2.0.0", config).kind).toBe("ok");
  });

  it("uses config.message and config.downloadUrl when present", () => {
    const state = evaluateGate("1.0.0", { ...config, message: "Hola", downloadUrl: "https://x.test" });
    expect(state).toEqual({ kind: "hard", message: "Hola", downloadUrl: "https://x.test" });
  });

  it("falls back to a default download url when omitted", () => {
    const state = evaluateGate("1.0.0", config);
    if (state.kind === "ok") throw new Error("expected a block");
    expect(state.downloadUrl).toBe(DEFAULT_DOWNLOAD_URL);
  });
});

describe("parseVersionGateConfig", () => {
  it("accepts a well-formed object", () => {
    expect(parseVersionGateConfig({ minVersion: "1.0.0", latestVersion: "1.1.0" })).toEqual({
      minVersion: "1.0.0",
      latestVersion: "1.1.0",
    });
  });

  it("keeps optional message and downloadUrl", () => {
    expect(
      parseVersionGateConfig({ minVersion: "1.0.0", latestVersion: "1.1.0", message: "m", downloadUrl: "u" }),
    ).toEqual({ minVersion: "1.0.0", latestVersion: "1.1.0", message: "m", downloadUrl: "u" });
  });

  it("returns null on missing required fields or wrong types", () => {
    expect(parseVersionGateConfig({ minVersion: "1.0.0" })).toBeNull();
    expect(parseVersionGateConfig({ minVersion: 1, latestVersion: "1.1.0" })).toBeNull();
    expect(parseVersionGateConfig(null)).toBeNull();
    expect(parseVersionGateConfig("nope")).toBeNull();
  });
});
```

Add `DEFAULT_DOWNLOAD_URL` to the existing import from `./version-gate` at the top of the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/shared/version-gate.test.ts`
Expected: FAIL — `evaluateGate` / `parseVersionGateConfig` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/shared/version-gate.ts`:

```ts
const DEFAULT_HARD_MESSAGE =
  "Esta versión ya no es compatible. Actualizá para seguir usando Kaipu.";
const DEFAULT_SOFT_MESSAGE =
  "Hay una versión nueva con mejoras. Actualizá cuando puedas.";

/** Map current version + config → GateState. minVersion drives hard, latestVersion drives soft. */
export function evaluateGate(currentVersion: string, config: VersionGateConfig): GateState {
  const downloadUrl = config.downloadUrl ?? DEFAULT_DOWNLOAD_URL;
  if (compareSemver(currentVersion, config.minVersion) < 0) {
    return { kind: "hard", message: config.message ?? DEFAULT_HARD_MESSAGE, downloadUrl };
  }
  if (compareSemver(currentVersion, config.latestVersion) < 0) {
    return { kind: "soft", message: config.message ?? DEFAULT_SOFT_MESSAGE, downloadUrl };
  }
  return { kind: "ok" };
}

/** Validate untrusted JSON. Returns null on anything malformed (→ fail-open). */
export function parseVersionGateConfig(raw: unknown): VersionGateConfig | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.minVersion !== "string" || typeof r.latestVersion !== "string") return null;
  const config: VersionGateConfig = { minVersion: r.minVersion, latestVersion: r.latestVersion };
  if (typeof r.message === "string") config.message = r.message;
  if (typeof r.downloadUrl === "string") config.downloadUrl = r.downloadUrl;
  return config;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/shared/version-gate.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/shared/version-gate.ts src/shared/version-gate.test.ts
git commit --no-verify -m "feat(version-gate): evaluateGate + config parsing (fail-open)"
```

---

### Task 3: `app:get-version` IPC (plumbing)

**Files:**
- Modify: `src/shared/types/ipc.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/test/setup.ts`

This is a thin IPC bridge (preload is untested by repo convention), so no dedicated unit test — it is exercised by the hook tests via the stub.

- [ ] **Step 1: Add the channel + API type**

In `src/shared/types/ipc.ts`, add to the `IPC_CHANNELS` object (near the other invoke channels like `getSettings`):

```ts
  getAppVersion: "app:get-version",
```

And add to the `ElectronAPI` interface (next to `getSettings`):

```ts
  getAppVersion: () => Promise<string>;
```

- [ ] **Step 2: Handle it in main**

In `src/main/index.ts`, where other `ipcMain.handle(...)` calls are registered (the IPC setup block), add:

```ts
ipcMain.handle(IPC_CHANNELS.getAppVersion, () => app.getVersion());
```

Ensure `app` and `ipcMain` are imported from `electron` and `IPC_CHANNELS` from the shared types (they already are if other handlers exist there; otherwise add the import).

- [ ] **Step 3: Expose it in preload**

In `src/preload/index.ts`, add to the `electronAPI` object (next to `getSettings`):

```ts
  getAppVersion: () => ipcRenderer.invoke(IPC_CHANNELS.getAppVersion),
```

- [ ] **Step 4: Add it to the renderer test stub**

In `src/renderer/src/test/setup.ts`, add to the `window.electronAPI` stub object:

```ts
  getAppVersion: async () => "1.0.0",
```

- [ ] **Step 5: Typecheck + commit**

Run: `bunx tsc --noEmit -p tsconfig.web.json` (and `-p tsconfig.node.json` if present) — expected: no errors.

```bash
git add src/shared/types/ipc.ts src/main/index.ts src/preload/index.ts src/renderer/src/test/setup.ts
git commit --no-verify -m "feat(version-gate): expose app.getVersion() over IPC"
```

---

### Task 4: `fetchVersionGateConfig`

**Files:**
- Create: `src/renderer/src/features/version-gate/fetch-version-gate-config.ts`
- Test: `src/renderer/src/features/version-gate/fetch-version-gate-config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// fetch-version-gate-config.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchVersionGateConfig } from "./fetch-version-gate-config";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(impl: () => Promise<Response>): void {
  vi.stubGlobal("fetch", vi.fn(impl));
}

describe("fetchVersionGateConfig", () => {
  it("returns a parsed config on 200 + valid JSON", async () => {
    stubFetch(async () => new Response(JSON.stringify({ minVersion: "1.0.0", latestVersion: "1.2.0" }), { status: 200 }));
    expect(await fetchVersionGateConfig("https://x.test/v.json")).toEqual({
      minVersion: "1.0.0",
      latestVersion: "1.2.0",
    });
  });

  it("returns null on a non-2xx response", async () => {
    stubFetch(async () => new Response("", { status: 500 }));
    expect(await fetchVersionGateConfig("https://x.test/v.json")).toBeNull();
  });

  it("returns null when fetch throws (offline)", async () => {
    stubFetch(async () => {
      throw new Error("offline");
    });
    expect(await fetchVersionGateConfig("https://x.test/v.json")).toBeNull();
  });

  it("returns null on malformed JSON", async () => {
    stubFetch(async () => new Response("{ not json", { status: 200 }));
    expect(await fetchVersionGateConfig("https://x.test/v.json")).toBeNull();
  });

  it("returns null on JSON that fails validation", async () => {
    stubFetch(async () => new Response(JSON.stringify({ minVersion: 1 }), { status: 200 }));
    expect(await fetchVersionGateConfig("https://x.test/v.json")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/renderer/src/features/version-gate/fetch-version-gate-config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// fetch-version-gate-config.ts
import { parseVersionGateConfig, type VersionGateConfig } from "@shared/version-gate";

/**
 * Fetch + parse the remote version-gate config. Returns null on ANY failure
 * (network, non-2xx, malformed JSON, failed validation) — the caller treats
 * null as "no opinion" so the gate stays fail-open.
 */
export async function fetchVersionGateConfig(url: string): Promise<VersionGateConfig | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const raw: unknown = await res.json();
    return parseVersionGateConfig(raw);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/renderer/src/features/version-gate/fetch-version-gate-config.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/features/version-gate/fetch-version-gate-config.ts src/renderer/src/features/version-gate/fetch-version-gate-config.test.ts
git commit --no-verify -m "feat(version-gate): fail-open remote config fetcher"
```

---

### Task 5: `useVersionGate` hook

**Files:**
- Create: `src/renderer/src/features/version-gate/use-version-gate.ts`
- Test: `src/renderer/src/features/version-gate/use-version-gate.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// use-version-gate.test.tsx
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useVersionGate } from "./use-version-gate";

const URL = "https://x.test/version-gate.json";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function stubFetchOnce(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("useVersionGate", () => {
  it("is ok before the config resolves (fail-open) and when no URL is set", async () => {
    vi.stubEnv("VITE_VERSION_GATE_URL", "");
    const { result } = renderHook(() => useVersionGate());
    expect(result.current).toEqual({ kind: "ok" });
  });

  it("hard-blocks when the fetched minVersion is above the app version", async () => {
    vi.stubEnv("VITE_VERSION_GATE_URL", URL);
    window.electronAPI.getAppVersion = async () => "1.0.0";
    stubFetchOnce({ minVersion: "2.0.0", latestVersion: "2.0.0" });
    const { result } = renderHook(() => useVersionGate());
    await waitFor(() => expect(result.current.kind).toBe("hard"));
  });

  it("does not re-fetch on focus within the throttle window", async () => {
    vi.stubEnv("VITE_VERSION_GATE_URL", URL);
    window.electronAPI.getAppVersion = async () => "1.0.0";
    const fetchFn = stubFetchOnce({ minVersion: "1.0.0", latestVersion: "1.0.0" });
    renderHook(() => useVersionGate());
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event("focus"));
    // still 1 — throttled
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/renderer/src/features/version-gate/use-version-gate.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// use-version-gate.ts
import { useEffect, useRef, useState } from "react";
import {
  VERSION_GATE_THROTTLE_MS,
  evaluateGate,
  type GateState,
  type VersionGateConfig,
} from "@shared/version-gate";
import { fetchVersionGateConfig } from "./fetch-version-gate-config";

/**
 * Evaluate the version gate against a remote config. Fail-open: returns
 * { kind: "ok" } until a fetched config says otherwise. Re-checks on window
 * focus, throttled to VERSION_GATE_THROTTLE_MS, and caches the last-good config
 * so a throttled/failed focus check never regresses a real block.
 */
export function useVersionGate(): GateState {
  const [state, setState] = useState<GateState>({ kind: "ok" });
  const lastGood = useRef<VersionGateConfig | null>(null);
  const lastCheckedAt = useRef<number>(0);
  const versionRef = useRef<string | null>(null);

  useEffect(() => {
    const url = import.meta.env.VITE_VERSION_GATE_URL as string | undefined;
    if (!url) return; // gate disabled (e.g. local dev) — stay ok

    let cancelled = false;

    async function check(): Promise<void> {
      lastCheckedAt.current = Date.now();
      if (!versionRef.current) versionRef.current = await window.electronAPI.getAppVersion();
      const fetched = await fetchVersionGateConfig(url);
      const config = fetched ?? lastGood.current;
      if (cancelled || !config || !versionRef.current) return;
      lastGood.current = config;
      setState(evaluateGate(versionRef.current, config));
    }

    void check();

    const onFocus = (): void => {
      if (Date.now() - lastCheckedAt.current >= VERSION_GATE_THROTTLE_MS) void check();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return state;
}
```

Also declare the env var type. In `src/renderer/src/env.d.ts` (or the existing `vite-env.d.ts` — search for `ImportMetaEnv`), add the field inside `interface ImportMetaEnv`:

```ts
  readonly VITE_VERSION_GATE_URL?: string;
```

If no such interface exists, create `src/renderer/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_VERSION_GATE_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/renderer/src/features/version-gate/use-version-gate.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/features/version-gate/use-version-gate.ts src/renderer/src/features/version-gate/use-version-gate.test.tsx src/renderer/src/*env.d.ts
git commit --no-verify -m "feat(version-gate): useVersionGate hook (throttled, fail-open, cached)"
```

---

### Task 6: Overlay + banner components

**Files:**
- Create: `src/renderer/src/features/version-gate/version-gate-overlay.tsx` + `.module.css`
- Create: `src/renderer/src/features/version-gate/version-gate-banner.tsx` + `.module.css`
- Test: `src/renderer/src/features/version-gate/version-gate-ui.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// version-gate-ui.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VersionGateOverlay } from "./version-gate-overlay";
import { VersionGateBanner } from "./version-gate-banner";

afterEach(() => vi.unstubAllGlobals());

describe("VersionGateOverlay", () => {
  it("renders the message and opens the download url", () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    render(<VersionGateOverlay message="Actualizá" downloadUrl="https://x.test" />);
    expect(screen.getByText("Actualizá")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /actualizar/i }));
    expect(open).toHaveBeenCalledWith("https://x.test", "_blank");
  });

  it("has no dismiss affordance", () => {
    render(<VersionGateOverlay message="m" downloadUrl="https://x.test" />);
    expect(screen.queryByRole("button", { name: /cerrar|dismiss|close/i })).toBeNull();
  });
});

describe("VersionGateBanner", () => {
  it("renders and can be dismissed", () => {
    render(<VersionGateBanner message="Nueva versión" downloadUrl="https://x.test" />);
    expect(screen.getByText("Nueva versión")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /cerrar/i }));
    expect(screen.queryByText("Nueva versión")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/renderer/src/features/version-gate/version-gate-ui.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// version-gate-overlay.tsx
import React from "react";
import styles from "./version-gate-overlay.module.css";

interface Props {
  message: string;
  downloadUrl: string;
}

/** Full-screen, non-dismissible block for an unsupported build. */
export function VersionGateOverlay({ message, downloadUrl }: Props): React.JSX.Element {
  return (
    <div className={styles.overlay} role="alertdialog" aria-modal="true">
      <div className={styles.card}>
        <h1 className={styles.title}>Actualización requerida</h1>
        <p className={styles.message}>{message}</p>
        <button className={styles.button} onClick={() => window.open(downloadUrl, "_blank")}>
          Actualizar
        </button>
      </div>
    </div>
  );
}
```

```css
/* version-gate-overlay.module.css */
.overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(10, 10, 12, 0.92);
  -webkit-app-region: no-drag;
}
.card {
  max-width: 28rem;
  padding: 2rem;
  text-align: center;
  background: var(--surface, #16161a);
  border-radius: 12px;
}
.title {
  margin: 0 0 0.75rem;
  font-size: 1.25rem;
}
.message {
  margin: 0 0 1.5rem;
  opacity: 0.85;
  line-height: 1.5;
}
.button {
  padding: 0.6rem 1.25rem;
  border: 0;
  border-radius: 8px;
  background: var(--accent, #5b7cfa);
  color: white;
  font-weight: 600;
  cursor: pointer;
}
```

```tsx
// version-gate-banner.tsx
import React from "react";
import styles from "./version-gate-banner.module.css";

interface Props {
  message: string;
  downloadUrl: string;
}

/** Slim dismissible nudge for an outdated-but-usable build. */
export function VersionGateBanner({ message, downloadUrl }: Props): React.JSX.Element | null {
  const [dismissed, setDismissed] = React.useState(false);
  if (dismissed) return null;
  return (
    <div className={styles.banner}>
      <span className={styles.message}>{message}</span>
      <button className={styles.action} onClick={() => window.open(downloadUrl, "_blank")}>
        Actualizar
      </button>
      <button className={styles.close} aria-label="Cerrar" onClick={() => setDismissed(true)}>
        ×
      </button>
    </div>
  );
}
```

```css
/* version-gate-banner.module.css */
.banner {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 1rem;
  background: var(--accent-muted, #2a2f4a);
  font-size: 0.875rem;
}
.message {
  flex: 1;
}
.action {
  padding: 0.3rem 0.75rem;
  border: 0;
  border-radius: 6px;
  background: var(--accent, #5b7cfa);
  color: white;
  cursor: pointer;
}
.close {
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 1.1rem;
  line-height: 1;
  cursor: pointer;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/renderer/src/features/version-gate/version-gate-ui.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/features/version-gate/version-gate-overlay.tsx src/renderer/src/features/version-gate/version-gate-overlay.module.css src/renderer/src/features/version-gate/version-gate-banner.tsx src/renderer/src/features/version-gate/version-gate-banner.module.css src/renderer/src/features/version-gate/version-gate-ui.test.tsx
git commit --no-verify -m "feat(version-gate): overlay (hard) + banner (soft) UI"
```

---

### Task 7: Barrel + wire into `AppShell` + env example

**Files:**
- Create: `src/renderer/src/features/version-gate/index.ts`
- Modify: `src/renderer/src/shell/app-shell.tsx`
- Modify: `.env.example`

- [ ] **Step 1: Create the barrel**

```ts
// index.ts
export { useVersionGate } from "./use-version-gate";
export { VersionGateOverlay } from "./version-gate-overlay";
export { VersionGateBanner } from "./version-gate-banner";
```

- [ ] **Step 2: Wire into AppShell**

In `src/renderer/src/shell/app-shell.tsx`:

Add the import:

```ts
import {
  useVersionGate,
  VersionGateOverlay,
  VersionGateBanner,
} from "@renderer/features/version-gate";
```

Inside `AppShell`, after the existing `const shortcuts = useShortcutLabels();` line:

```ts
  const gate = useVersionGate();
```

In the returned JSX, render the banner just inside the top of `.shell` (above `.body`) and the overlay as the last child of `.shell` (so it paints on top):

```tsx
  return (
    <div className={styles.shell}>
      {gate.kind === "soft" && (
        <VersionGateBanner message={gate.message} downloadUrl={gate.downloadUrl} />
      )}
      <div className={styles.body}>
        <Sidebar />
        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
      {/* …existing status bar… */}
      {gate.kind === "hard" && (
        <VersionGateOverlay message={gate.message} downloadUrl={gate.downloadUrl} />
      )}
    </div>
  );
```

(Keep the existing status-bar block exactly where it is; only add the two gate lines.)

- [ ] **Step 3: Document the env var**

In `.env.example`, add:

```
# Version gate: URL of the remote JSON config (Cloudflare). Unset → gate disabled (fail-open).
VITE_VERSION_GATE_URL=
```

- [ ] **Step 4: Typecheck + full test run**

Run: `bunx tsc --noEmit -p tsconfig.web.json` — expected: no errors.
Run: `bunx vitest run` — expected: all tests pass (the existing suite plus the new version-gate tests).
Run: `bunx oxlint` — expected: 0 errors / 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/features/version-gate/index.ts src/renderer/src/shell/app-shell.tsx .env.example
git commit --no-verify -m "feat(version-gate): mount gate in AppShell + document env"
```

---

## Self-Review notes

- **Spec coverage:** hard block (Task 6 overlay + Task 2 evaluate), soft nudge (Task 6 banner + Task 2), remote JSON via env (Task 4 + Task 5), startup + throttled focus + last-good (Task 5), fail-open table (Task 2 parse, Task 4 fetch, Task 5 no-URL), `app.getVersion()` IPC (Task 3), `window.open` for the button (Task 6), Cloudflare JSON shape (documented in spec; `.env.example` in Task 7). All covered.
- **Type consistency:** `VersionGateConfig`, `GateState`, `compareSemver`, `evaluateGate`, `parseVersionGateConfig`, `fetchVersionGateConfig`, `useVersionGate`, `getAppVersion` used identically across tasks.
- **Out of scope (confirmed not built here):** electron-updater wiring, pre-release semver, channels.
