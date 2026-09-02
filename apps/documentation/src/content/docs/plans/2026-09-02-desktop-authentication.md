---
title: Desktop authentication — implementation plan
description: Task-by-task TDD plan to build email/password sign-in/sign-up for the Kaipu desktop app — main-process auth via Better Auth's bearer plugin, safeStorage-encrypted session persistence.
---

# Desktop Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** let a user sign in or sign up to their Kaipu account from the desktop app with
email/password, session persisted encrypted-at-rest across restarts, never blocking local-first
usage.

**Architecture:** The main process owns all networking and credential handling — a pure-ish HTTP
client (`auth-client.ts`, mocked-`fetch`-testable) talks to server-hono using Better Auth's
`bearer` plugin (a new one-line server addition) instead of a cookie jar; a store
(`auth-store.ts`, mirrors the existing `settings-store.ts` shape) persists the token via
`safeStorage` and exposes it over five new IPC channels. The renderer never receives the token —
only a `signed-out | signed-in | unknown` status — via a `useAuthStatus()` hook feeding a new
"Cuenta" section in Settings.

**Tech Stack:** Electron main process (Node `fetch`, `safeStorage`), Better Auth `bearer` plugin
(server-side), React + Vitest + Testing Library (renderer), Vitest node project (main). No new
runtime dependencies.

**Spec:** `/specs/2026-09-02-desktop-authentication-design`

## Global Constraints

- Repo content (code, comments) is **English**; only end-user copy (i18n message catalogs) is
  Spanish/English pairs.
- No TS enums — `as const` + derived types (existing house rule, see `src/shared/analytics.ts:7`).
- The renderer must **never** receive the session token in any code path — only `AuthStatus`
  (`signed-out` / `signed-in` / `unknown`).
- `getSession` (in `auth-client.ts`) must **reject** on network/non-401 failure, and resolve
  `null` **only** on a confirmed 401. Conflating the two would silently sign a user out while
  offline — the bug the design review caught and fixed. This distinction is load-bearing; do not
  simplify it away during implementation.
- `authSignIn` / `authSignUp` / `authSignOut` IPC handlers must reject any call whose
  `event.sender` isn't the main window's `webContents` (`authGetStatus` and `authStatusChanged`
  stay unrestricted — read-only).
- Any `safeStorage.decryptString` failure (corrupted blob, wrong machine, different code-signing
  identity) must be caught and treated as "no token," never an uncaught exception — this runs
  synchronously during `app.whenReady()`.
- All paths below are relative to `apps/kaipu-record/`, except Task 1 (`packages/infra-auth/`).

---

## File Structure

- **Modify** `packages/infra-auth/src/config/base-config.ts` — add the `bearer()` plugin.
- **Create** `src/shared/types/auth.ts` — pure `AuthStatus` / `AuthCredentials` / `SignUpInput` /
  `AuthError` types.
- **Create** `src/main/services/auth-client.ts` (+ test) — HTTP calls to server-hono's auth
  endpoints.
- **Create** `src/main/infrastructure/auth-store.ts` (+ test) — `safeStorage` persistence, IPC
  registration, sender validation, broadcast.
- **Modify** `src/shared/types/ipc.ts` — 5 new `IPC_CHANNELS` entries.
- **Modify** `src/shared/types/electron-api.ts` — 5 new `KaipuElectronAPI` method signatures.
- **Modify** `src/preload/index.ts` — implement the 5 methods.
- **Modify** `src/main/index.ts` — call `registerAuth(config, () => mainWindow)`.
- **Modify** `.env.example` and `src/main/env.d.ts` — document and type `MAIN_VITE_SERVER_URL`.
- **Modify** `src/renderer/src/test/setup.ts` — stub the 5 new `window.electronAPI` methods.
- **Create** `src/renderer/src/features/auth/use-auth-status.ts` (+ test).
- **Create** `src/renderer/src/features/auth/account-panel.tsx` (+ `.module.css` + test).
- **Modify** `src/renderer/src/pages/settings/settings-page.tsx` — new "Cuenta" `<Section>`.
- **Modify** `src/renderer/src/pages/settings/settings-page.test.tsx` — assert the new section
  renders.
- **Modify** `packages/i18n/messages/en.json` + `es.json` — new `settings.account*` keys.

---

### Task 1: Server — add the `bearer` plugin

**Files:**

- Modify: `packages/infra-auth/src/config/base-config.ts`

**Interfaces:**

- Produces: the server accepts `Authorization: Bearer <token>` on every Better Auth-mediated
  request (`/api/auth/*` and, via `authMiddleware`, the oRPC `/api/v1/recordings/*` routes), and
  a successful sign-in/sign-up response carries a `set-auth-token` response header.

This package has no existing test suite (`packages/infra-auth/package.json` defines no `test`
script and has no `.test.ts` files — it's a thin config object, verified via `check-types` and
the manual integration pass in Task 12, not unit tests).

- [ ] **Step 1: Add the plugin**

```ts
// packages/infra-auth/src/config/base-config.ts
import { bearer } from "better-auth/plugins"; // add to the existing import line if one exists

export const baseConfig: BetterAuthOptions = {
  // ...unchanged...
  plugins: [bearer()],
};
```

- [ ] **Step 2: Type-check**

Run (from the monorepo root): `bun run check-types --filter=@kaipu/infra-auth`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/infra-auth/src/config/base-config.ts
git commit -m "feat(infra-auth): add the bearer plugin for non-browser clients"
```

---

### Task 2: Shared types — `auth.ts`

**Files:**

- Create: `src/shared/types/auth.ts`

**Interfaces:**

- Produces: `AuthStatus`, `AuthCredentials`, `SignUpInput`, `AuthError` — every later task imports
  from here.

Pure types (no `electron`/`node` imports, matches `src/shared/types/ipc.ts`'s own constraint) —
excluded from coverage same as the rest of `src/shared/types/**` (see `vitest.config.ts:29`), no
test file.

- [ ] **Step 1: Create the file**

```ts
// src/shared/types/auth.ts

export type AuthStatus =
  | { kind: "signed-out" }
  | { kind: "signed-in"; email: string; name: string }
  /** A token is stored but its last verification attempt couldn't reach the server (offline,
   *  timeout) — distinct from `signed-out` so a network blip never silently drops the session. */
  | { kind: "unknown"; lastKnownEmail?: string };

export interface AuthCredentials {
  email: string;
  password: string;
}

export interface SignUpInput extends AuthCredentials {
  name: string;
}

/** What a failed sign-in/sign-up/session-check reports to the renderer. */
export type AuthError =
  | { kind: "invalid-credentials" }
  | { kind: "email-taken" }
  | { kind: "network" }
  | { kind: "unknown"; message: string };
```

- [ ] **Step 2: Type-check**

Run: `bunx tsc --noEmit -p apps/kaipu-record` (from monorepo root)
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/shared/types/auth.ts
git commit -m "feat(auth): add shared AuthStatus/AuthCredentials/AuthError types"
```

---

### Task 3: Main — `auth-client.ts`

**Files:**

- Create: `src/main/services/auth-client.ts`
- Test: `src/main/services/auth-client.test.ts`

**Interfaces:**

- Consumes: `AuthCredentials`, `SignUpInput` (Task 2).
- Produces: `AuthClientConfig`, `SignInResult`, `signInWithPassword`, `signUpWithPassword`,
  `getSession`, `signOutRemote` — Task 4 (`auth-store.ts`) calls all four.

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/services/auth-client.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getSession,
  signInWithPassword,
  signOutRemote,
  signUpWithPassword,
} from "./auth-client";

const config = { serverUrl: "http://localhost:3000" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("signInWithPassword", () => {
  it("extracts the token from set-auth-token, not Set-Cookie", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ user: { email: "a@b.com", name: "A" } }), {
          status: 200,
          headers: { "set-auth-token": "tok_123" },
        }),
      ),
    );
    const result = await signInWithPassword(config, { email: "a@b.com", password: "pw" });
    expect(result).toEqual({ token: "tok_123", email: "a@b.com", name: "A" });
  });

  it("rejects with invalid-credentials on a 401/400 body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    );
    await expect(
      signInWithPassword(config, { email: "a@b.com", password: "wrong" }),
    ).rejects.toMatchObject({ kind: "invalid-credentials" });
  });

  it("rejects with network on a fetch throw", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(
      signInWithPassword(config, { email: "a@b.com", password: "pw" }),
    ).rejects.toMatchObject({ kind: "network" });
  });
});

describe("signUpWithPassword", () => {
  it("returns the same shape as sign-in", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ user: { email: "new@b.com", name: "New" } }), {
          status: 200,
          headers: { "set-auth-token": "tok_456" },
        }),
      ),
    );
    const result = await signUpWithPassword(config, {
      email: "new@b.com",
      password: "pw",
      name: "New",
    });
    expect(result).toEqual({ token: "tok_456", email: "new@b.com", name: "New" });
  });

  it("rejects with email-taken on a 422 body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 422 })));
    await expect(
      signUpWithPassword(config, { email: "dup@b.com", password: "pw", name: "Dup" }),
    ).rejects.toMatchObject({ kind: "email-taken" });
  });
});

describe("getSession", () => {
  it("resolves the session on 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ user: { email: "a@b.com", name: "A" } }), { status: 200 }),
      ),
    );
    await expect(getSession(config, "tok")).resolves.toEqual({ email: "a@b.com", name: "A" });
  });

  it("resolves null on a confirmed 401 — the session is genuinely gone", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    await expect(getSession(config, "tok")).resolves.toBeNull();
  });

  it("REJECTS (does not resolve null) on a network failure — the caller must not treat this the same as a 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(getSession(config, "tok")).rejects.toThrow();
  });

  it("rejects on a non-401 error status too (e.g. 500) — only 401 means null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    await expect(getSession(config, "tok")).rejects.toThrow();
  });
});

describe("signOutRemote", () => {
  it("resolves on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    await expect(signOutRemote(config, "tok")).resolves.toBeUndefined();
  });

  it("does not throw on failure — best-effort by contract", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(signOutRemote(config, "tok")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run src/main/services/auth-client.test.ts`
Expected: FAIL — `Cannot find module './auth-client'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/main/services/auth-client.ts
import type { AuthCredentials, SignUpInput } from "@shared/types/auth";

export interface AuthClientConfig {
  serverUrl: string;
}

export interface SignInResult {
  token: string;
  email: string;
  name: string;
}

interface AuthErrorLike {
  kind: "invalid-credentials" | "email-taken" | "network" | "unknown";
  message?: string;
}

function networkError(): AuthErrorLike {
  return { kind: "network" };
}

async function callCredentialEndpoint(
  config: AuthClientConfig,
  path: string,
  body: Record<string, string>,
  invalidStatusKind: AuthErrorLike["kind"],
): Promise<SignInResult> {
  let res: Response;
  try {
    res = await fetch(`${config.serverUrl}/api/auth/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw networkError();
  }

  if (!res.ok) {
    throw { kind: invalidStatusKind } satisfies AuthErrorLike;
  }

  const token = res.headers.get("set-auth-token");
  if (!token) throw { kind: "unknown", message: "sign-in succeeded but no session token was issued" } satisfies AuthErrorLike;

  const data = (await res.json()) as { user: { email: string; name: string } };
  return { token, email: data.user.email, name: data.user.name };
}

export function signInWithPassword(
  config: AuthClientConfig,
  credentials: AuthCredentials,
): Promise<SignInResult> {
  return callCredentialEndpoint(config, "sign-in/email", credentials, "invalid-credentials");
}

export function signUpWithPassword(
  config: AuthClientConfig,
  input: SignUpInput,
): Promise<SignInResult> {
  return callCredentialEndpoint(config, "sign-up/email", input, "email-taken");
}

/**
 * Resolves `null` ONLY on a confirmed 401. Any other failure (network, timeout, non-401 status)
 * REJECTS — the caller must not conflate "server said no" with "couldn't ask the server," or an
 * offline status check would delete a still-valid token.
 */
export async function getSession(
  config: AuthClientConfig,
  token: string,
): Promise<{ email: string; name: string } | null> {
  const res = await fetch(`${config.serverUrl}/api/auth/get-session`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  // A network failure throws out of `fetch` itself and propagates — intentionally not caught here.
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`get-session failed: ${res.status}`);
  const data = (await res.json()) as { user: { email: string; name: string } };
  return { email: data.user.email, name: data.user.name };
}

/** Best-effort — never rejects. A failed remote sign-out just means the orphaned server-side
 *  session expires on its own schedule; it must never block the caller's local sign-out. */
export async function signOutRemote(config: AuthClientConfig, token: string): Promise<void> {
  try {
    await fetch(`${config.serverUrl}/api/auth/sign-out`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // best-effort, see docstring
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run src/main/services/auth-client.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/auth-client.ts src/main/services/auth-client.test.ts
git commit -m "feat(auth): add auth-client — sign-in/sign-up/get-session/sign-out over bearer"
```

---

### Task 4: Main — `auth-store.ts`

**Files:**

- Create: `src/main/infrastructure/auth-store.ts`
- Test: `src/main/infrastructure/auth-store.test.ts`

**Interfaces:**

- Consumes: `AuthClientConfig`, `SignInResult`, `signInWithPassword`, `signUpWithPassword`,
  `getSession`, `signOutRemote` (Task 3); `AuthStatus` (Task 2). Task 5 replaces this task's
  deliberately local channel map with `IPC_CHANNELS.auth*`; this keeps Task 4 independently
  runnable and its red/green loop honest.
- Produces: `registerAuth(config: AuthClientConfig, getMainWindow: () => Electron.BrowserWindow | null): void`
  — Task 8 (`main/index.ts`) is the only caller.

Follows the codebase's `getMainWindow: () => BrowserWindow | null` callback convention (see
`src/main/recording/recording-hub.ts:53` and `src/main/updater/auto-updater.ts:26` — not a new
pattern). Testing follows `src/main/library/vault-location.test.ts`'s precedent: mock the
`electron` module with `vi.mock` + `vi.hoisted`, and use a real `mkdtemp` temp directory instead
of mocking `node:fs` (this codebase has no existing precedent for testing an `ipcMain.handle`
registrant, so this task establishes one others can copy).

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/infrastructure/auth-store.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mockState = vi.hoisted(() => ({
  userDataDir: "",
  encryptionAvailable: true,
  // Reversible fake "encryption": prefixes with a marker so decrypt can validate it, and a
  // decrypt failure can be simulated by writing bytes that don't start with the marker.
  handlers: new Map<string, (event: { sender: unknown }, ...args: unknown[]) => unknown>(),
  windows: [] as Array<{
    isDestroyed: () => boolean;
    webContents: { send: ReturnType<typeof vi.fn> };
  }>,
}));

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => (name === "userData" ? mockState.userDataDir : "/tmp"),
  },
  safeStorage: {
    isEncryptionAvailable: () => mockState.encryptionAvailable,
    encryptString: (s: string) => Buffer.from(`ENC:${s}`),
    decryptString: (b: Buffer) => {
      const str = b.toString();
      if (!str.startsWith("ENC:")) throw new Error("decryption failed");
      return str.slice(4);
    },
  },
  ipcMain: {
    handle: (channel: string, fn: (event: { sender: unknown }, ...args: unknown[]) => unknown) => {
      mockState.handlers.set(channel, fn);
    },
  },
  BrowserWindow: {
    getAllWindows: () => mockState.windows,
  },
}));

import * as authClient from "../services/auth-client";
import { registerAuth } from "./auth-store";

const CHANNELS = {
  authGetStatus: "auth:get-status",
  authSignIn: "auth:sign-in",
  authSignUp: "auth:sign-up",
  authSignOut: "auth:sign-out",
  authStatusChanged: "auth:status-changed",
};

const OTHER_SENDER = { id: "other" };
const config = { serverUrl: "http://localhost:3000" };

function fakeWindow(): {
  isDestroyed: () => boolean;
  webContents: { send: ReturnType<typeof vi.fn> };
} {
  return { isDestroyed: () => false, webContents: { send: vi.fn() } };
}

describe("auth-store", () => {
  beforeEach(async () => {
    mockState.userDataDir = await mkdtemp(join(tmpdir(), "kaipu-auth-"));
    mockState.encryptionAvailable = true;
    mockState.handlers.clear();
    mockState.windows = [fakeWindow()];
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await rm(mockState.userDataDir, { recursive: true, force: true });
  });

  it("authGetStatus returns signed-out when no token is stored", async () => {
    registerAuth(config, () => null);
    const status = await mockState.handlers.get(CHANNELS.authGetStatus)!({ sender: OTHER_SENDER });
    expect(status).toEqual({ kind: "signed-out" });
  });

  it("authSignIn persists the token, caches identity, and broadcasts signed-in", async () => {
    vi.spyOn(authClient, "signInWithPassword").mockResolvedValue({
      token: "tok_1",
      email: "a@b.com",
      name: "A",
    });
    const mainWindow = mockState.windows[0]!;
    registerAuth(config, () => mainWindow as never);

    const status = await mockState.handlers.get(CHANNELS.authSignIn)!(
      { sender: mainWindow.webContents },
      { email: "a@b.com", password: "pw" },
    );

    expect(status).toEqual({ kind: "signed-in", email: "a@b.com", name: "A" });
    expect(mainWindow.webContents.send).toHaveBeenCalledWith(
      CHANNELS.authStatusChanged,
      { kind: "signed-in", email: "a@b.com", name: "A" },
    );
  });

  it("does not send a broadcast to a destroyed window", async () => {
    const destroyed = fakeWindow();
    destroyed.isDestroyed = () => true;
    const liveWindow = fakeWindow();
    mockState.windows = [destroyed, liveWindow];
    vi.spyOn(authClient, "signInWithPassword").mockResolvedValue({
      token: "tok_1", email: "a@b.com", name: "A",
    });
    registerAuth(config, () => liveWindow as never);

    await mockState.handlers.get(CHANNELS.authSignIn)!(
      { sender: liveWindow.webContents }, { email: "a@b.com", password: "pw" },
    );

    expect(destroyed.webContents.send).not.toHaveBeenCalled();
    expect(liveWindow.webContents.send).toHaveBeenCalledOnce();
  });

  it("rejects authSignIn from a window that isn't the main window", async () => {
    const mainWindow = mockState.windows[0]!;
    registerAuth(config, () => mainWindow as never);

    await expect(
      mockState.handlers.get(CHANNELS.authSignIn)!(
        { sender: OTHER_SENDER },
        { email: "a@b.com", password: "pw" },
      ),
    ).rejects.toThrow();
  });

  it("authGetStatus does not reject from a non-main sender — it's read-only", async () => {
    registerAuth(config, () => null);
    await expect(
      mockState.handlers.get(CHANNELS.authGetStatus)!({ sender: OTHER_SENDER }),
    ).resolves.toEqual({ kind: "signed-out" });
  });

  it("a confirmed 401 on restore clears the stored token and returns signed-out", async () => {
    vi.spyOn(authClient, "signInWithPassword").mockResolvedValue({
      token: "tok_1",
      email: "a@b.com",
      name: "A",
    });
    const mainWindow = mockState.windows[0]!;
    registerAuth(config, () => mainWindow as never);
    await mockState.handlers.get(CHANNELS.authSignIn)!(
      { sender: mainWindow.webContents },
      { email: "a@b.com", password: "pw" },
    );

    vi.spyOn(authClient, "getSession").mockResolvedValue(null); // confirmed 401
    const status = await mockState.handlers.get(CHANNELS.authGetStatus)!({ sender: OTHER_SENDER });
    expect(status).toEqual({ kind: "signed-out" });

    // A second registerAuth (simulating app restart) must not find a token — it was cleared.
    registerAuth(config, () => mainWindow as never);
    const restored = await mockState.handlers.get(CHANNELS.authGetStatus)!({ sender: OTHER_SENDER });
    expect(restored).toEqual({ kind: "signed-out" });
  });

  it("a network failure on restore keeps the stored token and returns unknown, not signed-out", async () => {
    vi.spyOn(authClient, "signInWithPassword").mockResolvedValue({
      token: "tok_1",
      email: "a@b.com",
      name: "A",
    });
    const mainWindow = mockState.windows[0]!;
    registerAuth(config, () => mainWindow as never);
    await mockState.handlers.get(CHANNELS.authSignIn)!(
      { sender: mainWindow.webContents },
      { email: "a@b.com", password: "pw" },
    );

    vi.spyOn(authClient, "getSession").mockRejectedValue(new Error("offline"));
    const status = await mockState.handlers.get(CHANNELS.authGetStatus)!({ sender: OTHER_SENDER });
    expect(status).toEqual({ kind: "unknown", lastKnownEmail: "a@b.com" });

    // The token on disk must survive — a fresh registerAuth + a working getSession proves it.
    vi.spyOn(authClient, "getSession").mockResolvedValue({ email: "a@b.com", name: "A" });
    registerAuth(config, () => mainWindow as never);
    const restored = await mockState.handlers.get(CHANNELS.authGetStatus)!({ sender: OTHER_SENDER });
    expect(restored).toEqual({ kind: "signed-in", email: "a@b.com", name: "A" });
  });

  it("authSignOut clears local state synchronously even when the remote sign-out fails", async () => {
    vi.spyOn(authClient, "signInWithPassword").mockResolvedValue({
      token: "tok_1",
      email: "a@b.com",
      name: "A",
    });
    vi.spyOn(authClient, "signOutRemote").mockRejectedValue(new Error("offline"));
    const mainWindow = mockState.windows[0]!;
    registerAuth(config, () => mainWindow as never);
    await mockState.handlers.get(CHANNELS.authSignIn)!(
      { sender: mainWindow.webContents },
      { email: "a@b.com", password: "pw" },
    );

    await mockState.handlers.get(CHANNELS.authSignOut)!({ sender: mainWindow.webContents });

    registerAuth(config, () => mainWindow as never);
    const status = await mockState.handlers.get(CHANNELS.authGetStatus)!({ sender: OTHER_SENDER });
    expect(status).toEqual({ kind: "signed-out" });
  });

  it("isEncryptionAvailable() === false: sign-in fails and nothing is persisted", async () => {
    mockState.encryptionAvailable = false;
    vi.spyOn(authClient, "signInWithPassword").mockResolvedValue({
      token: "tok_1",
      email: "a@b.com",
      name: "A",
    });
    const mainWindow = mockState.windows[0]!;
    registerAuth(config, () => mainWindow as never);

    await expect(
      mockState.handlers.get(CHANNELS.authSignIn)!(
        { sender: mainWindow.webContents },
        { email: "a@b.com", password: "pw" },
      ),
    ).rejects.toThrow();

    // Query the same registration closure: a regression that cached before persistence failed
    // would be hidden by registering a fresh store below.
    const inProcessStatus = await mockState.handlers.get(CHANNELS.authGetStatus)!({ sender: OTHER_SENDER });
    expect(inProcessStatus).toEqual({ kind: "signed-out" });

    mockState.encryptionAvailable = true; // restore encryption to read what (shouldn't be) there
    registerAuth(config, () => mainWindow as never);
    const status = await mockState.handlers.get(CHANNELS.authGetStatus)!({ sender: OTHER_SENDER });
    expect(status).toEqual({ kind: "signed-out" });
  });

  it("a corrupted token file on disk is treated as signed-out, not a crash", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(mockState.userDataDir, "auth.enc"), "not-encrypted-garbage");

    expect(() => registerAuth(config, () => null)).not.toThrow();
    const status = await mockState.handlers.get(CHANNELS.authGetStatus)!({ sender: OTHER_SENDER });
    expect(status).toEqual({ kind: "signed-out" });
  });

  it("fails closed when encryption becomes unavailable while a token exists", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(mockState.userDataDir, "auth.enc"), "ENC:tok_1");
    mockState.encryptionAvailable = false;

    registerAuth(config, () => null);
    const status = await mockState.handlers.get(CHANNELS.authGetStatus)!({ sender: OTHER_SENDER });
    expect(status).toEqual({ kind: "signed-out" });
  });

  it("routes sign-up through the same persist-then-cache transaction", async () => {
    vi.spyOn(authClient, "signUpWithPassword").mockResolvedValue({
      token: "tok_2", email: "new@b.com", name: "New",
    });
    const mainWindow = mockState.windows[0]!;
    registerAuth(config, () => mainWindow as never);

    await expect(mockState.handlers.get(CHANNELS.authSignUp)!(
      { sender: mainWindow.webContents },
      { email: "new@b.com", password: "pw", name: "New" },
    )).resolves.toEqual({ kind: "signed-in", email: "new@b.com", name: "New" });
  });

  it("rejects authSignOut from a non-main sender", async () => {
    registerAuth(config, () => mockState.windows[0] as never);
    await expect(mockState.handlers.get(CHANNELS.authSignOut)!({ sender: OTHER_SENDER })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run src/main/infrastructure/auth-store.test.ts`
Expected: FAIL — `Cannot find module './auth-store'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/main/infrastructure/auth-store.ts
import { app, BrowserWindow, ipcMain, safeStorage } from "electron";
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AuthCredentials, AuthStatus, SignUpInput } from "@shared/types/auth";
import {
  getSession,
  signInWithPassword,
  signOutRemote,
  signUpWithPassword,
  type AuthClientConfig,
} from "../services/auth-client";

function tokenFilePath(): string {
  return join(app.getPath("userData"), "auth.enc");
}

// Task 5 promotes these exact values to the shared IPC contract. Keeping this map local until
// then lets this task compile and run independently instead of depending on a future commit.
const AUTH_IPC_CHANNELS = {
  authGetStatus: "auth:get-status",
  authSignIn: "auth:sign-in",
  authSignUp: "auth:sign-up",
  authSignOut: "auth:sign-out",
  authStatusChanged: "auth:status-changed",
} as const;

function readStoredToken(): string | null {
  if (!safeStorage.isEncryptionAvailable()) return null;
  const path = tokenFilePath();
  if (!existsSync(path)) return null;
  try {
    return safeStorage.decryptString(readFileSync(path));
  } catch {
    // Corrupted blob, copied to another machine, or a different code-signing identity — none of
    // these should crash app startup. Treat as "no token."
    return null;
  }
}

function writeStoredToken(token: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Cannot store the session: OS-level encryption is unavailable");
  }
  const path = tokenFilePath();
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, safeStorage.encryptString(token));
  renameSync(tmp, path); // atomic — a crash mid-write can't corrupt the real file
}

function clearStoredToken(): void {
  const path = tokenFilePath();
  if (existsSync(path)) unlinkSync(path);
}

export function registerAuth(
  config: AuthClientConfig,
  getMainWindow: () => BrowserWindow | null,
): void {
  let token: string | null = readStoredToken();
  let cachedIdentity: { email: string; name: string } | null = null;

  function broadcast(status: AuthStatus): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(AUTH_IPC_CHANNELS.authStatusChanged, status);
    }
  }

  function requireMainWindow(event: Electron.IpcMainInvokeEvent): void {
    if (event.sender !== getMainWindow()?.webContents) {
      throw new Error("auth IPC calls are only accepted from the main window");
    }
  }

  ipcMain.handle(AUTH_IPC_CHANNELS.authGetStatus, async (): Promise<AuthStatus> => {
    if (!token) return { kind: "signed-out" };
    try {
      const identity = await getSession(config, token);
      if (!identity) {
        // Confirmed 401 — the session is genuinely gone. Safe to clear.
        token = null;
        clearStoredToken();
        return { kind: "signed-out" };
      }
      cachedIdentity = identity;
      return { kind: "signed-in", ...identity };
    } catch {
      // Network/other failure — NEVER clear a token we couldn't actually verify was invalid.
      return { kind: "unknown", lastKnownEmail: cachedIdentity?.email };
    }
  });

  // Shared by sign-in and sign-up: persist FIRST, only update in-memory state if that succeeds.
  // Setting `token`/`cachedIdentity` before a possible `writeStoredToken` failure would leave this
  // running process's in-memory state "signed in" even though nothing was saved and the call
  // rejected to the renderer — an inconsistent state a later authGetStatus in the same session
  // could act on.
  function commitSignIn(result: { token: string; email: string; name: string }): AuthStatus {
    writeStoredToken(result.token);
    token = result.token;
    cachedIdentity = { email: result.email, name: result.name };
    const status: AuthStatus = { kind: "signed-in", email: result.email, name: result.name };
    broadcast(status);
    return status;
  }

  ipcMain.handle(
    AUTH_IPC_CHANNELS.authSignIn,
    async (event, credentials: AuthCredentials): Promise<AuthStatus> => {
      requireMainWindow(event);
      return commitSignIn(await signInWithPassword(config, credentials));
    },
  );

  ipcMain.handle(
    AUTH_IPC_CHANNELS.authSignUp,
    async (event, input: SignUpInput): Promise<AuthStatus> => {
      requireMainWindow(event);
      return commitSignIn(await signUpWithPassword(config, input));
    },
  );

  ipcMain.handle(AUTH_IPC_CHANNELS.authSignOut, async (event): Promise<void> => {
    requireMainWindow(event);
    const outgoingToken = token;
    token = null;
    cachedIdentity = null;
    clearStoredToken();
    broadcast({ kind: "signed-out" });
    if (outgoingToken) void signOutRemote(config, outgoingToken).catch((error) => {
      console.error("remote auth sign-out failed", error);
    });
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run src/main/infrastructure/auth-store.test.ts`
Expected: PASS. The local `CHANNELS` / `AUTH_IPC_CHANNELS` maps deliberately duplicate the future
shared contract so this task remains a valid standalone red → green slice. Task 5 removes both.

- [ ] **Step 5: Commit**

```bash
git add src/main/infrastructure/auth-store.ts src/main/infrastructure/auth-store.test.ts
git commit -m "feat(auth): add auth-store — safeStorage persistence, sender-validated IPC, broadcast"
```

---

### Task 5: Shared — `IPC_CHANNELS` + `KaipuElectronAPI`

**Files:**

- Modify: `src/shared/types/ipc.ts`
- Modify: `src/shared/types/electron-api.ts`
- Modify: `src/main/infrastructure/auth-store.ts` and `src/main/infrastructure/auth-store.test.ts`
  (replace both Task 4 local maps with the real import)

**Interfaces:**

- Consumes: `AuthStatus`, `AuthCredentials`, `SignUpInput` (Task 2).
- Produces: `IPC_CHANNELS.auth*` string constants and the `KaipuElectronAPI` method signatures
  Task 6 (preload) implements.

Type-only changes — no test file (matches `src/shared/types/**`'s existing exclusion from
coverage).

- [ ] **Step 1: Add the IPC channels**

```ts
// src/shared/types/ipc.ts — add to the existing IPC_CHANNELS object literal
export const IPC_CHANNELS = {
  // ...existing entries...
  authGetStatus: "auth:get-status",
  authSignIn: "auth:sign-in",
  authSignUp: "auth:sign-up",
  authSignOut: "auth:sign-out",
  authStatusChanged: "auth:status-changed",
} as const;
```

- [ ] **Step 2: Add the `KaipuElectronAPI` methods**

```ts
// src/shared/types/electron-api.ts — add to the KaipuElectronAPI interface
import type { AuthCredentials, AuthStatus, SignUpInput } from "./auth";

export interface KaipuElectronAPI {
  // ...existing methods...
  getAuthStatus(): Promise<AuthStatus>;
  signIn(credentials: AuthCredentials): Promise<AuthStatus>;
  signUp(input: SignUpInput): Promise<AuthStatus>;
  signOut(): Promise<void>;
  onAuthStatusChanged(callback: (status: AuthStatus) => void): () => void;
}
```

- [ ] **Step 3: Wire `auth-store.ts` and its test to the real constants**

In `src/main/infrastructure/auth-store.ts`, import `IPC_CHANNELS` from `@shared/types/ipc`, delete
`AUTH_IPC_CHANNELS`, and replace each of its usages. In `auth-store.test.ts`, replace the local
`CHANNELS` object and its usages with the same import. This is a mechanical promotion: the string
values must remain identical.

- [ ] **Step 4: Run the full main-project test suite**

Run: `bunx vitest run --project=main`
Expected: PASS, including `auth-store.test.ts` still green against the real constants.

- [ ] **Step 5: Type-check**

Run: `bunx tsc --noEmit -p apps/kaipu-record`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types/ipc.ts src/shared/types/electron-api.ts src/main/infrastructure/auth-store.ts src/main/infrastructure/auth-store.test.ts
git commit -m "feat(auth): declare the 5 auth IPC channels and KaipuElectronAPI methods"
```

---

### Task 6: Preload — implement the 5 methods

**Files:**

- Modify: `src/preload/index.ts`

**Interfaces:**

- Consumes: `IPC_CHANNELS.auth*` (Task 5).
- Produces: `window.electronAPI.getAuthStatus/signIn/signUp/signOut/onAuthStatusChanged` — Task 9
  (`use-auth-status.ts`) is the consumer.

No test file — the preload process is intentionally untested (thin IPC bridge, see
`vitest.config.ts:11` and `:26`).

- [ ] **Step 1: Implement the methods**

Add to the `kaipuApi` object in `src/preload/index.ts`, following the existing
`getSettings`/`updateSettings`/`onSettingsChanged` pattern immediately above it:

```ts
// src/preload/index.ts — inside the kaipuApi object literal
getAuthStatus: () => ipcRenderer.invoke(IPC_CHANNELS.authGetStatus),
signIn: (credentials: AuthCredentials) => ipcRenderer.invoke(IPC_CHANNELS.authSignIn, credentials),
signUp: (input: SignUpInput) => ipcRenderer.invoke(IPC_CHANNELS.authSignUp, input),
signOut: () => ipcRenderer.invoke(IPC_CHANNELS.authSignOut),
onAuthStatusChanged: (callback: (status: AuthStatus) => void) => {
  const listener = (_event: Electron.IpcRendererEvent, status: AuthStatus): void => callback(status);
  ipcRenderer.on(IPC_CHANNELS.authStatusChanged, listener);
  return () => ipcRenderer.removeListener(IPC_CHANNELS.authStatusChanged, listener);
},
```

Add `AuthCredentials`, `AuthStatus`, `SignUpInput` to the existing `@shared/types` (or
`@shared/types/auth`, matching however the file's existing type imports are organized) import
line at the top of the file.

- [ ] **Step 2: Type-check**

Run: `bunx tsc --noEmit -p apps/kaipu-record`
Expected: no errors — this is the only verification available for the preload bridge.

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat(auth): expose auth methods on window.electronAPI"
```

---

### Task 7: Wire `main/index.ts`

**Files:**

- Modify: `src/main/index.ts`
- Modify: `.env.example`
- Modify: `src/main/env.d.ts`

**Interfaces:**

- Consumes: `registerAuth` (Task 4).

No test file (integration-level wiring; covered by Task 12's manual pass).

- [ ] **Step 1: Add the env var to `.env.example`**

```bash
# .env.example — add near the other MAIN_VITE_* entries
# Server URL for Desktop authentication — WITH scheme (main-process fetch, not a browser fetch,
# so a bare host:port is not a valid URL to it either — same gotcha as web-hono's VITE_SERVER_URL).
MAIN_VITE_SERVER_URL=http://localhost:3000
```

- [ ] **Step 2: Type the env var**

Add the following optional property to `src/main/env.d.ts`; this repository intentionally uses a
closed `ImportMetaEnv` declaration, so documenting the variable alone is not enough for the node
project to type-check.

```ts
readonly MAIN_VITE_SERVER_URL?: string;
```

- [ ] **Step 3: Call `registerAuth`**

In `src/main/index.ts`, next to the existing `registerSettings();` call (see the codebase excerpt
around that line):

```ts
// src/main/index.ts
import { registerAuth } from "./infrastructure/auth-store";
// ...
registerAuth({ serverUrl: import.meta.env.MAIN_VITE_SERVER_URL }, () => mainWindow);
```

- [ ] **Step 4: Type-check and build**

Run: `bunx tsc --noEmit -p apps/kaipu-record`, then `bun run build` (from `apps/kaipu-record`)
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts .env.example src/main/env.d.ts
git commit -m "feat(auth): wire registerAuth into the main process, document MAIN_VITE_SERVER_URL"
```

---

### Task 8: Renderer — test stub + `use-auth-status.ts`

**Files:**

- Modify: `src/renderer/src/test/setup.ts`
- Create: `src/renderer/src/features/auth/use-auth-status.ts`
- Test: `src/renderer/src/features/auth/use-auth-status.test.ts`

**Interfaces:**

- Consumes: `window.electronAPI.getAuthStatus/signIn/signUp/signOut/onAuthStatusChanged` (Task 6).
- Produces: `useAuthStatus(): { status: AuthStatus; refresh; signIn; signUp; signOut; pending:
boolean; error: AuthError | null }` — Task 9 (`account-panel.tsx`) is the consumer.

- [ ] **Step 1: Extend the renderer test stub**

Add to the `window.electronAPI` stub object in `src/renderer/src/test/setup.ts`, next to
`onSettingsChanged`:

```ts
// src/renderer/src/test/setup.ts
getAuthStatus: async () => ({ kind: "signed-out" }) as const,
signIn: async () => ({ kind: "signed-out" }) as const,
signUp: async () => ({ kind: "signed-out" }) as const,
signOut: async () => {},
onAuthStatusChanged: () => () => {},
```

- [ ] **Step 2: Write the failing hook tests**

```tsx
// src/renderer/src/features/auth/use-auth-status.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useAuthStatus } from "./use-auth-status";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useAuthStatus", () => {
  it("loads the status on mount", async () => {
    vi.spyOn(window.electronAPI, "getAuthStatus").mockResolvedValue({
      kind: "signed-in",
      email: "a@b.com",
      name: "A",
    });

    const { result } = renderHook(() => useAuthStatus());

    await waitFor(() =>
      expect(result.current.status).toEqual({ kind: "signed-in", email: "a@b.com", name: "A" }),
    );
  });

  it("subscribes to onAuthStatusChanged and updates on broadcast", async () => {
    let broadcast: ((s: unknown) => void) | undefined;
    vi.spyOn(window.electronAPI, "onAuthStatusChanged").mockImplementation((cb) => {
      broadcast = cb;
      return () => {};
    });

    const { result } = renderHook(() => useAuthStatus());
    await waitFor(() => expect(result.current.status).toEqual({ kind: "signed-out" }));

    act(() => broadcast?.({ kind: "signed-in", email: "x@y.com", name: "X" }));

    await waitFor(() =>
      expect(result.current.status).toEqual({ kind: "signed-in", email: "x@y.com", name: "X" }),
    );
  });

  it("signIn sets pending during the call and surfaces an AuthError on failure", async () => {
    let rejectSignIn: (error: unknown) => void = () => {};
    vi.spyOn(window.electronAPI, "signIn").mockReturnValue(new Promise((_, reject) => {
      rejectSignIn = reject;
    }));

    const { result } = renderHook(() => useAuthStatus());
    await waitFor(() => expect(result.current.status).toEqual({ kind: "signed-out" }));

    const promise = result.current.signIn({ email: "a@b.com", password: "wrong" });
    await waitFor(() => expect(result.current.pending).toBe(true));
    await act(async () => {
      rejectSignIn({ kind: "invalid-credentials" });
      await promise;
    });

    expect(result.current.pending).toBe(false);
    expect(result.current.error).toEqual({ kind: "invalid-credentials" });
  });

  it("a new attempt clears the previous error", async () => {
    vi.spyOn(window.electronAPI, "signIn")
      .mockRejectedValueOnce({ kind: "invalid-credentials" })
      .mockResolvedValueOnce({ kind: "signed-in", email: "a@b.com", name: "A" });

    const { result } = renderHook(() => useAuthStatus());
    await waitFor(() => expect(result.current.status).toEqual({ kind: "signed-out" }));

    await act(async () => {
      await result.current.signIn({ email: "a@b.com", password: "wrong" }).catch(() => {});
    });
    expect(result.current.error).toEqual({ kind: "invalid-credentials" });

    await act(async () => {
      await result.current.signIn({ email: "a@b.com", password: "right" });
    });
    expect(result.current.error).toBeNull();
  });

  it("refreshes an unknown status on explicit retry", async () => {
    vi.spyOn(window.electronAPI, "getAuthStatus")
      .mockResolvedValueOnce({ kind: "unknown", lastKnownEmail: "a@b.com" })
      .mockResolvedValueOnce({ kind: "signed-in", email: "a@b.com", name: "A" });
    const { result } = renderHook(() => useAuthStatus());
    await waitFor(() => expect(result.current.status.kind).toBe("unknown"));

    await act(async () => { await result.current.refresh(); });
    expect(result.current.status).toEqual({ kind: "signed-in", email: "a@b.com", name: "A" });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bunx vitest run src/renderer/src/features/auth/use-auth-status.test.ts`
Expected: FAIL — `Cannot find module './use-auth-status'`.

- [ ] **Step 4: Write the implementation**

```ts
// src/renderer/src/features/auth/use-auth-status.ts
import { useCallback, useEffect, useState } from "react";
import type { AuthCredentials, AuthError, AuthStatus, SignUpInput } from "@shared/types/auth";

export interface AuthStatusStore {
  status: AuthStatus;
  pending: boolean;
  error: AuthError | null;
  refresh(): Promise<void>;
  signIn(credentials: AuthCredentials): Promise<void>;
  signUp(input: SignUpInput): Promise<void>;
  signOut(): Promise<void>;
}

export function useAuthStatus(): AuthStatusStore {
  const [status, setStatus] = useState<AuthStatus>({ kind: "signed-out" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const next = await window.electronAPI.getAuthStatus();
    setStatus(next);
  }, []);

  useEffect(() => {
    let broadcastWonRace = false;
    const unsubscribe = window.electronAPI.onAuthStatusChanged((status) => {
      broadcastWonRace = true;
      setStatus(status);
    });
    // Subscribe before querying. If a status broadcast lands while the initial query is in flight,
    // it is newer and must not be overwritten by the stale query response.
    void window.electronAPI.getAuthStatus().then((status) => {
      if (!broadcastWonRace) setStatus(status);
    });
    return unsubscribe;
  }, []);

  const runAttempt = useCallback(
    async (attempt: () => Promise<AuthStatus | void>): Promise<void> => {
      setPending(true);
      setError(null);
      try {
        const next = await attempt();
        if (next) setStatus(next);
      } catch (err) {
        setError(err as AuthError);
      } finally {
        setPending(false);
      }
    },
    [],
  );

  const signIn = useCallback(
    (credentials: AuthCredentials) => runAttempt(() => window.electronAPI.signIn(credentials)),
    [runAttempt],
  );
  const signUp = useCallback(
    (input: SignUpInput) => runAttempt(() => window.electronAPI.signUp(input)),
    [runAttempt],
  );
  const signOut = useCallback(
    () => runAttempt(async () => { await window.electronAPI.signOut(); setStatus({ kind: "signed-out" }); }),
    [runAttempt],
  );

  return { status, pending, error, refresh, signIn, signUp, signOut };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bunx vitest run src/renderer/src/features/auth/use-auth-status.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/test/setup.ts src/renderer/src/features/auth/use-auth-status.ts src/renderer/src/features/auth/use-auth-status.test.ts
git commit -m "feat(auth): add useAuthStatus renderer hook"
```

---

### Task 9: Renderer — `account-panel.tsx`

**Files:**

- Create: `src/renderer/src/features/auth/account-panel.tsx`
- Create: `src/renderer/src/features/auth/account-panel.module.css`
- Test: `src/renderer/src/features/auth/account-panel.test.tsx`

**Interfaces:**

- Consumes: `useAuthStatus` (Task 8); `Card`, `Row`, `Button`, `Input` (`@renderer/ui/*`,
  existing); `useTranslations` (`@kaipu/i18n`, existing — namespace `"settings"`, keys from Task
  10, already stubbed by the i18n test mock in `setup.ts` to fall back to `"settings.<key>"`).
- Produces: `<AccountPanel />` — Task 11 (`settings-page.tsx`) is the consumer.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/renderer/src/features/auth/account-panel.test.tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AccountPanel } from "./account-panel";

describe("AccountPanel", () => {
  it("shows sign-in/sign-up buttons when signed out", async () => {
    vi.spyOn(window.electronAPI, "getAuthStatus").mockResolvedValue({ kind: "signed-out" });
    render(<AccountPanel />);
    await waitFor(() => expect(screen.getByRole("button", { name: /settings.signIn/i })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /settings.signUp/i })).toBeInTheDocument();
  });

  it("shows the email and a sign-out button when signed in", async () => {
    vi.spyOn(window.electronAPI, "getAuthStatus").mockResolvedValue({
      kind: "signed-in",
      email: "a@b.com",
      name: "A",
    });
    render(<AccountPanel />);
    await waitFor(() => expect(screen.getByText("a@b.com")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /settings.signOut/i })).toBeInTheDocument();
  });

  it("shows a verify-failed note when status is unknown, not a login prompt", async () => {
    vi.spyOn(window.electronAPI, "getAuthStatus").mockResolvedValue({
      kind: "unknown",
      lastKnownEmail: "a@b.com",
    });
    render(<AccountPanel />);
    await waitFor(() => expect(screen.getByText(/settings.accountUnknown/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /settings.signIn/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /settings.retry/i })).toBeInTheDocument();
  });

  it("retries an unknown session check on request", async () => {
    vi.spyOn(window.electronAPI, "getAuthStatus")
      .mockResolvedValueOnce({ kind: "unknown", lastKnownEmail: "a@b.com" })
      .mockResolvedValueOnce({ kind: "signed-in", email: "a@b.com", name: "A" });
    render(<AccountPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /settings.retry/i }));
    await waitFor(() => expect(screen.getByText("a@b.com")).toBeInTheDocument());
  });

  it("opens the sign-in form, submits it, and shows an inline error on failure", async () => {
    vi.spyOn(window.electronAPI, "getAuthStatus").mockResolvedValue({ kind: "signed-out" });
    const signIn = vi.spyOn(window.electronAPI, "signIn").mockRejectedValue({
      kind: "invalid-credentials",
    });
    render(<AccountPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /settings.signIn/i }));
    fireEvent.change(screen.getByLabelText(/settings.emailLabel/i), {
      target: { value: "a@b.com" },
    });
    fireEvent.change(screen.getByLabelText(/settings.passwordLabel/i), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: /settings.submit/i }));

    await waitFor(() => expect(signIn).toHaveBeenCalledWith({ email: "a@b.com", password: "wrong" }));
    await waitFor(() =>
      expect(screen.getByText(/settings.authErrorInvalidCredentials/i)).toBeInTheDocument(),
    );
  });

  it("disables the submit button while the request is pending", async () => {
    vi.spyOn(window.electronAPI, "getAuthStatus").mockResolvedValue({ kind: "signed-out" });
    let resolveSignIn: (v: never) => void = () => {};
    vi.spyOn(window.electronAPI, "signIn").mockReturnValue(
      new Promise((resolve) => {
        resolveSignIn = resolve;
      }),
    );
    render(<AccountPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /settings.signIn/i }));
    fireEvent.change(screen.getByLabelText(/settings.emailLabel/i), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText(/settings.passwordLabel/i), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: /settings.submit/i }));

    expect(screen.getByRole("button", { name: /settings.submit/i })).toBeDisabled();
    resolveSignIn({ kind: "signed-in", email: "a@b.com", name: "A" } as never);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run src/renderer/src/features/auth/account-panel.test.tsx`
Expected: FAIL — `Cannot find module './account-panel'`.

- [ ] **Step 3: Write the implementation**

```tsx
// src/renderer/src/features/auth/account-panel.tsx
import React from "react";
import { useTranslations } from "@kaipu/i18n";
import { Button } from "@renderer/ui/button";
import { Input } from "@renderer/ui/input";
import { Row } from "@renderer/ui/row";
import type { AuthError } from "@shared/types/auth";
import { useAuthStatus } from "./use-auth-status";
import styles from "./account-panel.module.css";

type FormMode = "closed" | "sign-in" | "sign-up";

function errorCopyKey(err: AuthError): string {
  switch (err.kind) {
    case "invalid-credentials":
      return "authErrorInvalidCredentials";
    case "email-taken":
      return "authErrorEmailTaken";
    case "network":
      return "authErrorNetwork";
    default:
      return "authErrorUnknown";
  }
}

export function AccountPanel(): React.JSX.Element {
  const t = useTranslations("settings");
  const { status, pending, error, refresh, signIn, signUp, signOut } = useAuthStatus();
  const [mode, setMode] = React.useState<FormMode>("closed");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [name, setName] = React.useState("");

  if (status.kind === "signed-in") {
    return (
      <Row
        label={status.email}
        action={
          <Button variant="outline" size="sm" onClick={() => void signOut()}>
            {t("signOut")}
          </Button>
        }
      />
    );
  }

  if (status.kind === "unknown") {
    return (
      <Row
        label={status.lastKnownEmail ?? ""}
        description={<span className={styles.unknownNote}>{t("accountUnknown")}</span>}
        action={
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            {t("retry")}
          </Button>
        }
      />
    );
  }

  if (mode === "closed") {
    return (
      <div className={styles.actions}>
        <Button size="sm" onClick={() => setMode("sign-in")}>
          {t("signIn")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setMode("sign-up")}>
          {t("signUp")}
        </Button>
      </div>
    );
  }

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (mode === "sign-in") void signIn({ email, password });
    else void signUp({ email, password, name });
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <Input
        id="account-email"
        label={t("emailLabel")}
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      {mode === "sign-up" && (
        <Input
          id="account-name"
          label={t("nameLabel")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      )}
      <Input
        id="account-password"
        label={t("passwordLabel")}
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error && <p className={styles.error}>{t(errorCopyKey(error))}</p>}
      <div className={styles.formActions}>
        <Button type="submit" size="sm" disabled={pending}>
          {t("submit")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setMode("closed")}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}
```

```css
/* src/renderer/src/features/auth/account-panel.module.css */
.actions {
  display: flex;
  gap: 0.5rem;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.formActions {
  display: flex;
  gap: 0.5rem;
}

.error {
  color: var(--color-danger, #e5484d);
  font-size: 0.875rem;
  margin: 0;
}

.unknownNote {
  color: var(--color-text-secondary, #888);
  font-size: 0.875rem;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run src/renderer/src/features/auth/account-panel.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/features/auth/account-panel.tsx src/renderer/src/features/auth/account-panel.module.css src/renderer/src/features/auth/account-panel.test.tsx
git commit -m "feat(auth): add AccountPanel — sign-in/sign-up/sign-out UI"
```

---

### Task 10: i18n copy

**Files:**

- Modify: `packages/i18n/messages/en.json`
- Modify: `packages/i18n/messages/es.json`

**Interfaces:**

- Produces: every `t("...")` key `account-panel.tsx` (Task 9) already calls — this task is here,
  after Task 9, only because Task 9's test mock (`setup.ts`'s `useTranslations` stub, see Task
  8/9) falls back to rendering `"settings.<key>"` for a missing key, so Task 9's tests pass either
  way; this task makes the **real, shipped** English/Spanish copy correct, which Task 9's tests
  don't verify.

No test file — `en.json`/`es.json` are data, and the repo's i18n parity test
(`packages/i18n/src/__tests__/parity.test.ts`, run in Step 2) already checks every English key has
a Spanish counterpart; that's the coverage this task needs.

- [ ] **Step 1: Add the keys**

```json
// packages/i18n/messages/en.json — inside the "settings" object, alongside the existing keys
"account": "Account",
"signIn": "Sign in",
"signUp": "Create account",
"signOut": "Sign out",
"submit": "Continue",
"cancel": "Cancel",
"retry": "Retry",
"emailLabel": "Email",
"passwordLabel": "Password",
"nameLabel": "Name",
"accountUnknown": "Couldn't verify your session — still using your last sign-in.",
"authErrorInvalidCredentials": "Wrong email or password.",
"authErrorEmailTaken": "That email is already registered.",
"authErrorNetwork": "Couldn't reach the server — check your connection.",
"authErrorUnknown": "Something went wrong. Try again."
```

```json
// packages/i18n/messages/es.json — inside the "settings" object, alongside the existing keys
"account": "Cuenta",
"signIn": "Iniciar sesión",
"signUp": "Crear cuenta",
"signOut": "Cerrar sesión",
"submit": "Continuar",
"cancel": "Cancelar",
"retry": "Reintentar",
"emailLabel": "Correo electrónico",
"passwordLabel": "Contraseña",
"nameLabel": "Nombre",
"accountUnknown": "No se pudo verificar tu sesión — seguimos usando la última.",
"authErrorInvalidCredentials": "Correo o contraseña incorrectos.",
"authErrorEmailTaken": "Ese correo ya está registrado.",
"authErrorNetwork": "No se pudo conectar con el servidor — revisá tu conexión.",
"authErrorUnknown": "Algo salió mal. Intentá de nuevo."
```

- [ ] **Step 2: Run the i18n parity test**

Run (from `packages/i18n`): `bunx vitest run`
Expected: PASS — every new English key has a Spanish counterpart and vice versa.

- [ ] **Step 3: Commit**

```bash
git add packages/i18n/messages/en.json packages/i18n/messages/es.json
git commit -m "feat(auth): add account/sign-in/sign-up copy (en + es)"
```

---

### Task 11: Wire into `settings-page.tsx`

**Files:**

- Modify: `src/renderer/src/pages/settings/settings-page.tsx`
- Modify: `src/renderer/src/pages/settings/settings-page.test.tsx`

**Interfaces:**

- Consumes: `AccountPanel` (Task 9).

- [ ] **Step 1: Write the failing test**

Add to the existing `describe("SettingsPage", ...)` block in `settings-page.test.tsx`:

```tsx
it("renders the account section", () => {
  renderSettings();
  expect(screen.getByRole("heading", { name: /^account$/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run src/renderer/src/pages/settings/settings-page.test.tsx`
Expected: FAIL — no heading named "Account".

- [ ] **Step 3: Add the section**

In `settings-page.tsx`, add the import and a new `<Section>` (placed as the first section, per
the design spec's note that account state is the most likely thing a returning user checks):

```tsx
import { AccountPanel } from "@renderer/features/auth/account-panel";
// ...
<div className={styles.sections}>
  <Section title={t("account")}>
    <AccountPanel />
  </Section>
  <Section title={t("language")}>
    <LanguageSettings />
  </Section>
  {/* ...rest unchanged... */}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run src/renderer/src/pages/settings/settings-page.test.tsx`
Expected: PASS (all existing tests + the new one).

- [ ] **Step 5: Run the full test suite**

Run: `bunx vitest run` (from `apps/kaipu-record`)
Expected: PASS across both projects (main + renderer).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/pages/settings/settings-page.tsx src/renderer/src/pages/settings/settings-page.test.tsx
git commit -m "feat(auth): add the Account section to Settings"
```

---

## How to run locally

Run these commands after Tasks 1–11 are complete. They intentionally use two terminals so the
Desktop main process can reach the local Worker; `MAIN_VITE_SERVER_URL` is read at build/startup
time, so restart the Desktop dev process after changing it.

1. Prepare the existing server environment as documented by `apps/server-hono`, including its
   database bindings/secrets, then start the Worker from the monorepo root:

   ```bash
   bun run dev:server-hono
   ```

2. In a second terminal, create `apps/kaipu-record/.env` from its committed template and set the
   Worker URL (the default local server is expected at `http://localhost:3000`):

   ```bash
   cd apps/kaipu-record
   cp .env.example .env
   ```

   Add or confirm this value in `.env`:

   ```bash
   MAIN_VITE_SERVER_URL=http://localhost:3000
   ```

3. From `apps/kaipu-record`, run focused checks while working, then the full suite and build:

   ```bash
   bunx vitest run --project=main
   bunx vitest run --project=renderer
   bun run build
   ```

4. Start the Desktop app from the same directory:

   ```bash
   bun run dev
   ```

   Open **Settings → Account**. The manual scenarios below validate the actual Desktop → Worker
   bearer path; the app remains usable locally when the Worker is stopped.

---

### Task 12: Manual verification against local `wrangler dev`

**Files:** none — this is a manual pass, no code changes.

Run `wrangler dev` for server-hono locally (`bun run dev:server-hono` from the monorepo root) and
`bun run dev` for kaipu-record, then, per the spec's own testing plan:

- [ ] **Step 1: Sign up a new Desktop account, then sign out**

Open Settings → Account → "Create account" → fill in a throwaway email/password/name → submit.
Confirm the Account section switches to showing the email + "Sign out". Click "Sign out"; confirm
it reverts to "Sign in"/"Create account" immediately (no network wait for the sign-out button
itself to visually update — the spec's local-first-safe-signout property).

- [ ] **Step 2: Sign in again, then verify session restore**

Sign in with the same credentials. Quit and relaunch the app (or, if faster, force
`registerAuth`'s `app.whenReady()` path to re-run by restarting the dev process). Open Settings →
Account again; confirm it shows signed-in with no re-entered credentials.

- [ ] **Step 3: Verify the offline-safe status check**

While signed in, disconnect network (or stop the local `wrangler dev` process), then close and
reopen the Settings window (unmount/remount `AccountPanel`, forcing a fresh `getAuthStatus` call).
Confirm the UI shows the "couldn't verify" note (`accountUnknown` copy), **not** a sign-in prompt,
and that reconnecting and reopening Settings again returns to normal signed-in state without
re-entering credentials.

- [ ] **Step 4: Verify a corrupted token file doesn't crash the app**

Quit the app. Find `auth.enc` under the app's `userData` directory (macOS:
`~/Library/Application Support/kaipu-record/auth.enc`, exact folder name may differ — check
`app.getName()`/`productName` in `package.json` if unsure) and overwrite it with random bytes
(`echo "garbage" > auth.enc`). Relaunch the app. Confirm it starts normally (no crash) and Settings
→ Account shows signed-out.

- [ ] **Step 5: Confirm the origin/CORS assumption from the spec**

The sign-in call itself (Step 1) already proves this — if it succeeded, the spec's flagged
assumption ("Desktop's absent `Origin` header doesn't trip Better Auth's origin/CSRF check," now
verified against source during the design review) held in practice too. No separate check needed.

- [ ] **Step 6: Record the outcome**

Update the design spec's status line
(`apps/documentation/src/content/docs/specs/2026-09-02-desktop-authentication-design.md`) to note
the date this manual pass ran and that it passed, mirroring how
`apps/documentation/src/content/docs/backlog/cloud-recordings-upload.md` records its own
end-to-end validation date. Commit that doc update on its own.

---

## Self-Review Notes

- **Spec coverage:** every "In scope (v1)" bullet from the design spec maps to a task — sign-in
  (Task 3/4/9), sign-up (same), encrypted persistence + startup validity check (Task 4), sign-out
  local+remote (Task 4), bearer transport (Task 1/3), the server plugin (Task 1). The spec's
  "Error handling" table maps 1:1 onto Task 4's and Task 8's test cases. The spec's sender-guard
  addition (from the adversarial review) is Task 4/5. The decrypt-try/catch fix is Task 4. The
  offline-vs-401 fix is Task 3/4/8 throughout.
- **Deferred items carried forward, not silently dropped:** Google Sign-In, R2 CORS, and the
  "production-equivalent Worker" integration-test gap are NOT tasks here — they're the spec's own
  documented deferrals, restated in Task 12 (the CORS/origin one) and left to their own future
  work (Google, and `production-cloud-security`'s smoke-test extension) per the spec.
