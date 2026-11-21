import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IPC_CHANNELS } from "@shared/types/ipc";
import { FREE_ENTITLEMENTS, type Entitlements } from "@shared/entitlements";

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
import { registerAuth as registerRealAuth, type AuthStoreDeps } from "./auth-store";
import type { AuthClientConfig } from "../services/auth-client";

/** Stand-in for the plugin-backed browser hand-off (see services/browser-sign-in.ts). */
const browser = vi.hoisted(() => ({ begin: vi.fn(), exchange: vi.fn() }));

function registerAuth(
  config: AuthClientConfig,
  getWindow: () => never | null,
  deps: AuthStoreDeps = {},
): ReturnType<typeof registerRealAuth> {
  return registerRealAuth(config, getWindow as never, { browser, ...deps });
}

/** What the renderer does: press "Sign in with your browser", then the code comes back. */
async function signInVia(event: { sender: unknown }): Promise<unknown> {
  await mockState.handlers.get(IPC_CHANNELS.authBeginBrowserSignIn)!(event, "sign-in");
  return mockState.handlers.get(IPC_CHANNELS.authSubmitCode)!(event, "code-from-browser");
}

const OTHER_SENDER = { id: "other" };
/** Sentinel used as the main window's `webContents`, so a fake main-window object can be built
 *  as `{ webContents: MAIN_SENDER }` and IPC calls sent with `{ sender: MAIN_SENDER }`. */
const MAIN_SENDER = { id: "main" };
const config = { serverUrl: "http://localhost:3000" };

/** The on-disk shape readStoredSession expects: the fake safeStorage marker wrapped around the
 *  JSON envelope (token + identity), matching what writeStoredSession produces. */
function storedBlob(token: string, email = "a@b.com", name = "A", userId = "user-1"): string {
  return `ENC:${JSON.stringify({ token, userId, email, name })}`;
}

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
    browser.begin.mockReset().mockResolvedValue(undefined);
    browser.exchange.mockReset();
    vi.spyOn(authClient, "getEntitlements").mockRejectedValue(new Error("offline"));
  });

  afterEach(async () => {
    await rm(mockState.userDataDir, { recursive: true, force: true });
  });

  it("authGetStatus returns signed-out when no token is stored", async () => {
    registerAuth(config, () => null);
    const status = await mockState.handlers.get(IPC_CHANNELS.authGetStatus)!({
      sender: OTHER_SENDER,
    });
    expect(status).toEqual({ kind: "signed-out" });
  });

  it("a browser sign-in persists the token, caches identity, and broadcasts signed-in", async () => {
    browser.exchange.mockResolvedValue({
      token: "tok_1",
      userId: "user-1",
      email: "a@b.com",
      name: "A",
    });
    const mainWindow = mockState.windows[0]!;
    registerAuth(config, () => mainWindow as never);

    const status = await signInVia({ sender: mainWindow.webContents });

    expect(status).toEqual({
      ok: true,
      status: {
        kind: "signed-in",
        userId: "user-1",
        email: "a@b.com",
        name: "A",
        entitlements: FREE_ENTITLEMENTS,
      },
    });
    expect(mainWindow.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.authStatusChanged, {
      kind: "signed-in",
      userId: "user-1",
      email: "a@b.com",
      name: "A",
      entitlements: FREE_ENTITLEMENTS,
    });
  });

  it("does not send a broadcast to a destroyed window", async () => {
    const destroyed = fakeWindow();
    destroyed.isDestroyed = () => true;
    const liveWindow = fakeWindow();
    mockState.windows = [destroyed, liveWindow];
    browser.exchange.mockResolvedValue({
      token: "tok_1",
      userId: "user-1",
      email: "a@b.com",
      name: "A",
    });
    registerAuth(config, () => liveWindow as never);

    await signInVia({ sender: liveWindow.webContents });

    expect(destroyed.webContents.send).not.toHaveBeenCalled();
    expect(liveWindow.webContents.send).toHaveBeenCalledOnce();
  });

  it("rejects a browser sign-in from a window that isn't the main window", async () => {
    const mainWindow = mockState.windows[0]!;
    registerAuth(config, () => mainWindow as never);

    await expect(signInVia({ sender: OTHER_SENDER })).rejects.toThrow();
  });

  it("returns a sign-in failure as a structured result instead of throwing it", async () => {
    // Electron serializes anything thrown out of ipcMain.handle down to its `.message`, so a
    // thrown `{ kind }` would reach the renderer with no discriminant at all. The handler must
    // resolve the error instead, where structured cloning preserves it in full.
    browser.exchange.mockRejectedValue({ kind: "invalid-code" });
    const mainWindow = mockState.windows[0]!;
    registerAuth(config, () => mainWindow as never);

    await expect(signInVia({ sender: mainWindow.webContents })).resolves.toEqual({
      ok: false,
      error: { kind: "invalid-code" },
    });
    expect(mainWindow.webContents.send).not.toHaveBeenCalled();
  });

  it("authGetStatus does not reject from a non-main sender — it's read-only", async () => {
    registerAuth(config, () => null);
    await expect(
      mockState.handlers.get(IPC_CHANNELS.authGetStatus)!({ sender: OTHER_SENDER }),
    ).resolves.toEqual({ kind: "signed-out" });
  });

  it("a confirmed 401 on restore clears the stored token and returns signed-out", async () => {
    browser.exchange.mockResolvedValue({
      token: "tok_1",
      userId: "user-1",
      email: "a@b.com",
      name: "A",
    });
    const mainWindow = mockState.windows[0]!;
    registerAuth(config, () => mainWindow as never);
    await signInVia({ sender: mainWindow.webContents });

    vi.spyOn(authClient, "getSession").mockResolvedValue(null); // confirmed 401
    const status = await mockState.handlers.get(IPC_CHANNELS.authGetStatus)!({
      sender: OTHER_SENDER,
    });
    expect(status).toEqual({ kind: "signed-out" });

    // A second registerAuth (simulating app restart) must not find a token — it was cleared.
    registerAuth(config, () => mainWindow as never);
    const restored = await mockState.handlers.get(IPC_CHANNELS.authGetStatus)!({
      sender: OTHER_SENDER,
    });
    expect(restored).toEqual({ kind: "signed-out" });
  });

  it("a network failure on restore keeps the stored token and returns unknown, not signed-out", async () => {
    browser.exchange.mockResolvedValue({
      token: "tok_1",
      userId: "user-1",
      email: "a@b.com",
      name: "A",
    });
    const mainWindow = mockState.windows[0]!;
    registerAuth(config, () => mainWindow as never);
    await signInVia({ sender: mainWindow.webContents });

    vi.spyOn(authClient, "getSession").mockRejectedValue(new Error("offline"));
    const status = await mockState.handlers.get(IPC_CHANNELS.authGetStatus)!({
      sender: OTHER_SENDER,
    });
    expect(status).toEqual({
      kind: "unknown",
      lastKnownUserId: "user-1",
      lastKnownEmail: "a@b.com",
      entitlements: FREE_ENTITLEMENTS,
    });

    // The token on disk must survive — a fresh registerAuth + a working getSession proves it.
    vi.spyOn(authClient, "getSession").mockResolvedValue({
      userId: "user-1",
      email: "a@b.com",
      name: "A",
    });
    registerAuth(config, () => mainWindow as never);
    const restored = await mockState.handlers.get(IPC_CHANNELS.authGetStatus)!({
      sender: OTHER_SENDER,
    });
    expect(restored).toEqual({
      kind: "signed-in",
      userId: "user-1",
      email: "a@b.com",
      name: "A",
      entitlements: FREE_ENTITLEMENTS,
    });
  });

  it("names the persisted account in `unknown` on the first check after a restart", async () => {
    // The canonical case lastKnownEmail exists for: the app restarted with a token on disk and
    // the server is unreachable, so nothing in THIS process has ever had a successful
    // getSession to populate an in-memory identity cache. Before the identity was persisted
    // alongside the token, this rendered an empty label.
    await writeFile(
      join(mockState.userDataDir, "auth.enc"),
      storedBlob("tok_1", "restored@b.com", "Restored"),
    );
    vi.spyOn(authClient, "getSession").mockRejectedValue(new Error("offline"));

    registerAuth(config, () => null);
    const status = await mockState.handlers.get(IPC_CHANNELS.authGetStatus)!({
      sender: OTHER_SENDER,
    });

    expect(status).toEqual({
      kind: "unknown",
      lastKnownUserId: "user-1",
      lastKnownEmail: "restored@b.com",
      entitlements: FREE_ENTITLEMENTS,
    });
  });

  it("persists the identity with the token, so a restart restores it without a round-trip", async () => {
    browser.exchange.mockResolvedValue({
      token: "tok_1",
      userId: "user-1",
      email: "a@b.com",
      name: "A",
    });
    const mainWindow = mockState.windows[0]!;
    registerAuth(config, () => mainWindow as never);
    await signInVia({ sender: mainWindow.webContents });

    const { readFile } = await import("node:fs/promises");
    const onDisk = await readFile(join(mockState.userDataDir, "auth.enc"), "utf8");
    expect(JSON.parse(onDisk.slice("ENC:".length))).toEqual({
      token: "tok_1",
      userId: "user-1",
      email: "a@b.com",
      name: "A",
      entitlements: FREE_ENTITLEMENTS,
      admin: false,
    });

    // A fresh process reading that file reports the identity even with the server unreachable.
    vi.spyOn(authClient, "getSession").mockRejectedValue(new Error("offline"));
    registerAuth(config, () => mainWindow as never);
    await expect(
      mockState.handlers.get(IPC_CHANNELS.authGetStatus)!({ sender: OTHER_SENDER }),
    ).resolves.toEqual({
      kind: "unknown",
      lastKnownUserId: "user-1",
      lastKnownEmail: "a@b.com",
      entitlements: FREE_ENTITLEMENTS,
    });
  });

  it("treats a pre-envelope plain-token file as no session rather than crashing", async () => {
    // An app installed before the envelope has a raw token string on disk; JSON.parse throws on
    // it, which readStoredSession swallows like any other corruption. A one-time re-login.
    await writeFile(join(mockState.userDataDir, "auth.enc"), "ENC:tok_legacy_plain");

    expect(() => registerAuth(config, () => null)).not.toThrow();
    await expect(
      mockState.handlers.get(IPC_CHANNELS.authGetStatus)!({ sender: OTHER_SENDER }),
    ).resolves.toEqual({ kind: "signed-out" });
  });

  it("authSignOut clears local state synchronously even when the remote sign-out fails", async () => {
    browser.exchange.mockResolvedValue({
      token: "tok_1",
      userId: "user-1",
      email: "a@b.com",
      name: "A",
    });
    vi.spyOn(authClient, "signOutRemote").mockRejectedValue(new Error("offline"));
    const mainWindow = mockState.windows[0]!;
    registerAuth(config, () => mainWindow as never);
    await signInVia({ sender: mainWindow.webContents });

    await mockState.handlers.get(IPC_CHANNELS.authSignOut)!({ sender: mainWindow.webContents });

    registerAuth(config, () => mainWindow as never);
    const status = await mockState.handlers.get(IPC_CHANNELS.authGetStatus)!({
      sender: OTHER_SENDER,
    });
    expect(status).toEqual({ kind: "signed-out" });
  });

  it("isEncryptionAvailable() === false: sign-in fails and nothing is persisted", async () => {
    mockState.encryptionAvailable = false;
    browser.exchange.mockResolvedValue({
      token: "tok_1",
      userId: "user-1",
      email: "a@b.com",
      name: "A",
    });
    const mainWindow = mockState.windows[0]!;
    registerAuth(config, () => mainWindow as never);

    // The handler RETURNS the failure rather than throwing it (Electron would strip a thrown
    // error down to its `.message` and lose the structured `kind`).
    await expect(signInVia({ sender: mainWindow.webContents })).resolves.toMatchObject({
      ok: false,
      error: { kind: "unknown" },
    });

    // Query the same registration closure: a regression that cached before persistence failed
    // would be hidden by registering a fresh store below.
    const inProcessStatus = await mockState.handlers.get(IPC_CHANNELS.authGetStatus)!({
      sender: OTHER_SENDER,
    });
    expect(inProcessStatus).toEqual({ kind: "signed-out" });

    mockState.encryptionAvailable = true; // restore encryption to read what (shouldn't be) there
    registerAuth(config, () => mainWindow as never);
    const status = await mockState.handlers.get(IPC_CHANNELS.authGetStatus)!({
      sender: OTHER_SENDER,
    });
    expect(status).toEqual({ kind: "signed-out" });
  });

  it("a corrupted token file on disk is treated as signed-out, not a crash", async () => {
    await writeFile(join(mockState.userDataDir, "auth.enc"), "not-encrypted-garbage");

    expect(() => registerAuth(config, () => null)).not.toThrow();
    const status = await mockState.handlers.get(IPC_CHANNELS.authGetStatus)!({
      sender: OTHER_SENDER,
    });
    expect(status).toEqual({ kind: "signed-out" });
  });

  it("fails closed when encryption becomes unavailable while a token exists", async () => {
    await writeFile(join(mockState.userDataDir, "auth.enc"), storedBlob("tok_1"));
    mockState.encryptionAvailable = false;

    registerAuth(config, () => null);
    const status = await mockState.handlers.get(IPC_CHANNELS.authGetStatus)!({
      sender: OTHER_SENDER,
    });
    expect(status).toEqual({ kind: "signed-out" });
  });

  it("a sign-up started in the browser goes through the same persist-then-cache transaction", async () => {
    browser.exchange.mockResolvedValue({
      token: "tok_2",
      userId: "user-2",
      email: "new@b.com",
      name: "New",
    });
    const mainWindow = mockState.windows[0]!;
    registerAuth(config, () => mainWindow as never);

    await expect(signInVia({ sender: mainWindow.webContents })).resolves.toEqual({
      ok: true,
      status: {
        kind: "signed-in",
        userId: "user-2",
        email: "new@b.com",
        name: "New",
        entitlements: FREE_ENTITLEMENTS,
      },
    });
  });

  it("rejects authSignOut from a non-main sender", async () => {
    registerAuth(config, () => mockState.windows[0] as never);
    await expect(
      mockState.handlers.get(IPC_CHANNELS.authSignOut)!({ sender: OTHER_SENDER }),
    ).rejects.toThrow();
  });

  // ── Entitlements ──────────────────────────────────────────────────────

  const PRO: Entitlements = {
    plan: "pro",
    status: "active",
    currentPeriodEnd: null,
    features: { watermarkRemoval: true, cloudUploads: true, cloudStorageBytes: 1_000_000_000 },
  };

  async function signInAs(mainWindow: ReturnType<typeof fakeWindow>): Promise<void> {
    browser.exchange.mockResolvedValue({
      token: "tok_1",
      userId: "user-1",
      email: "a@b.com",
      name: "A",
    });
    registerAuth(config, () => mainWindow as never);
    await signInVia({ sender: mainWindow.webContents });
  }

  it("authGetStatus re-checks entitlements on every successful session check", async () => {
    const mainWindow = mockState.windows[0]!;
    await signInAs(mainWindow);

    vi.spyOn(authClient, "getSession").mockResolvedValue({
      userId: "user-1",
      email: "a@b.com",
      name: "A",
    });
    vi.spyOn(authClient, "getEntitlements").mockResolvedValue(PRO);
    const status = await mockState.handlers.get(IPC_CHANNELS.authGetStatus)!({
      sender: OTHER_SENDER,
    });

    expect(status).toEqual({
      kind: "signed-in",
      userId: "user-1",
      email: "a@b.com",
      name: "A",
      entitlements: PRO,
    });
  });

  it("a failed entitlements fetch keeps the last known copy — it never downgrades to free", async () => {
    const mainWindow = mockState.windows[0]!;
    await signInAs(mainWindow);
    vi.spyOn(authClient, "getSession").mockResolvedValue({
      userId: "user-1",
      email: "a@b.com",
      name: "A",
    });
    vi.spyOn(authClient, "getEntitlements").mockResolvedValue(PRO);
    await mockState.handlers.get(IPC_CHANNELS.authGetStatus)!({ sender: OTHER_SENDER });

    vi.spyOn(authClient, "getEntitlements").mockRejectedValue(new Error("offline"));
    const status = await mockState.handlers.get(IPC_CHANNELS.authGetStatus)!({
      sender: OTHER_SENDER,
    });

    expect(status).toEqual({
      kind: "signed-in",
      userId: "user-1",
      email: "a@b.com",
      name: "A",
      entitlements: PRO,
    });
  });

  it("persists entitlements with the token, so an offline restart still reports them in `unknown`", async () => {
    const mainWindow = mockState.windows[0]!;
    await signInAs(mainWindow);
    vi.spyOn(authClient, "getSession").mockResolvedValue({
      userId: "user-1",
      email: "a@b.com",
      name: "A",
    });
    vi.spyOn(authClient, "getEntitlements").mockResolvedValue(PRO);
    await mockState.handlers.get(IPC_CHANNELS.authGetStatus)!({ sender: OTHER_SENDER });

    // Fresh process, server unreachable.
    vi.spyOn(authClient, "getSession").mockRejectedValue(new Error("offline"));
    registerAuth(config, () => mainWindow as never);
    const status = await mockState.handlers.get(IPC_CHANNELS.authGetStatus)!({
      sender: OTHER_SENDER,
    });

    expect(status).toEqual({
      kind: "unknown",
      lastKnownUserId: "user-1",
      lastKnownEmail: "a@b.com",
      entitlements: PRO,
    });
  });

  it("sign-in fetches entitlements right away so the first signed-in status already carries them", async () => {
    vi.spyOn(authClient, "getEntitlements").mockResolvedValue(PRO);
    const mainWindow = mockState.windows[0]!;
    browser.exchange.mockResolvedValue({
      token: "tok_1",
      userId: "user-1",
      email: "a@b.com",
      name: "A",
    });
    registerAuth(config, () => mainWindow as never);

    const result = await signInVia({ sender: mainWindow.webContents });

    expect(result).toEqual({
      ok: true,
      status: {
        kind: "signed-in",
        userId: "user-1",
        email: "a@b.com",
        name: "A",
        entitlements: PRO,
      },
    });
  });

  it("sign-out drops the cached entitlements along with the token", async () => {
    const mainWindow = mockState.windows[0]!;
    vi.spyOn(authClient, "getEntitlements").mockResolvedValue(PRO);
    await signInAs(mainWindow);

    await mockState.handlers.get(IPC_CHANNELS.authSignOut)!({ sender: mainWindow.webContents });

    // A fresh process finds nothing on disk: no token, and therefore no plan to inherit.
    registerAuth(config, () => mainWindow as never);
    await expect(
      mockState.handlers.get(IPC_CHANNELS.authGetStatus)!({ sender: OTHER_SENDER }),
    ).resolves.toEqual({ kind: "signed-out" });
  });

  // ── Admin permission (ADR 0067) ───────────────────────────────────────

  const answerFor = (userId: string | undefined, admin: boolean | undefined): Entitlements =>
    ({
      ...FREE_ENTITLEMENTS,
      ...(userId === undefined ? {} : { userId }),
      ...(admin === undefined ? {} : { admin }),
    }) as Entitlements;

  async function signInWith(
    answer: Entitlements,
    result = { token: "tok_1", userId: "user-1", email: "a@b.com", name: "A" },
  ): Promise<ReturnType<typeof registerRealAuth>> {
    vi.spyOn(authClient, "getEntitlements").mockResolvedValue(answer);
    const mainWindow = mockState.windows[0]!;
    browser.exchange.mockResolvedValue(result);
    const handle = registerAuth(config, () => mainWindow as never);
    await signInVia({ sender: mainWindow.webContents });
    return handle;
  }

  const getStatus = async (): Promise<unknown> =>
    mockState.handlers.get(IPC_CHANNELS.authGetStatus)!({ sender: OTHER_SENDER });

  it("signed out: no admin session at all", () => {
    const handle = registerAuth(config, () => null);
    expect(handle.getAdminSession()).toBeNull();
  });

  it("stores admin:true from an answer for the signed-in user, and keeps it out of the plan the renderer sees", async () => {
    const handle = await signInWith(answerFor("user-1", true));
    expect(handle.getAdminSession()).toEqual({ admin: true });
    const status = (await getStatus()) as { entitlements: object };
    expect(status.entitlements).not.toHaveProperty("admin");
    expect(status.entitlements).not.toHaveProperty("userId");
  });

  it("discards an answer for another user", async () => {
    const handle = await signInWith(answerFor("user-2", true));
    expect(handle.getAdminSession()).toEqual({ admin: false });
  });

  it("treats an answer with no userId as not admin", async () => {
    const handle = await signInWith(answerFor(undefined, true));
    expect(handle.getAdminSession()).toEqual({ admin: false });
  });

  it("a failed write still keeps the fresh plan and admin answer in memory", async () => {
    const handle = await signInWith(answerFor("user-1", false));
    vi.spyOn(authClient, "getSession").mockResolvedValue({
      userId: "user-1",
      email: "a@b.com",
      name: "A",
    });
    const pro = { ...answerFor("user-1", true), plan: "pro" } as Entitlements;
    vi.spyOn(authClient, "getEntitlements").mockResolvedValue(pro);
    mockState.encryptionAvailable = false; // writeStoredSession throws
    try {
      const status = (await getStatus()) as { entitlements: { plan: string } };
      expect(status.entitlements.plan).toBe("pro");
      expect(handle.getAdminSession()).toEqual({ admin: true });
    } finally {
      mockState.encryptionAvailable = true;
    }
  });

  it("of two overlapping checks of the same session, the later request's answer wins", async () => {
    const handle = await signInWith(answerFor("user-1", false));
    vi.spyOn(authClient, "getSession").mockResolvedValue({
      userId: "user-1",
      email: "a@b.com",
      name: "A",
    });
    const answers: Array<(value: Entitlements) => void> = [];
    vi.spyOn(authClient, "getEntitlements").mockImplementation(
      () => new Promise<Entitlements>((resolve) => answers.push(resolve)),
    );
    const older = getStatus();
    const newer = getStatus();
    await vi.waitFor(() => expect(answers).toHaveLength(2));
    answers[1]!(answerFor("user-1", false)); // newer: revoked
    await newer;
    answers[0]!(answerFor("user-1", true)); // older lands last
    await older;
    expect(handle.getAdminSession()).toEqual({ admin: false });
    expect(registerAuth(config, () => null).getAdminSession()).toEqual({ admin: false });
  });

  it("an older answer still applies when the newer check of the same session failed", async () => {
    const handle = await signInWith(answerFor("user-1", false));
    vi.spyOn(authClient, "getSession").mockResolvedValue({
      userId: "user-1",
      email: "a@b.com",
      name: "A",
    });
    const calls: Array<{ resolve: (value: Entitlements) => void; reject: (e: Error) => void }> = [];
    vi.spyOn(authClient, "getEntitlements").mockImplementation(
      () => new Promise<Entitlements>((resolve, reject) => calls.push({ resolve, reject })),
    );
    const older = getStatus();
    const newer = getStatus();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    calls[1]!.reject(new Error("offline")); // newer fails
    await newer;
    calls[0]!.resolve(answerFor("user-1", true)); // older succeeds after it
    await older;
    expect(handle.getAdminSession()).toEqual({ admin: true });
  });

  it("treats a missing admin (an older server) as false", async () => {
    const handle = await signInWith(answerFor("user-1", undefined));
    expect(handle.getAdminSession()).toEqual({ admin: false });
  });

  it("is not admin when the sign-in could not fetch the answer", async () => {
    browser.exchange.mockResolvedValue({
      token: "tok_1",
      userId: "user-1",
      email: "a@b.com",
      name: "A",
    });
    const handle = registerAuth(config, () => mockState.windows[0] as never);
    await signInVia({ sender: mockState.windows[0]!.webContents });
    expect(handle.getAdminSession()).toEqual({ admin: false });
  });

  it("persists admin with the session: an offline restart still has it, before any round trip", async () => {
    await signInWith(answerFor("user-1", true));

    vi.spyOn(authClient, "getSession").mockRejectedValue(new Error("offline"));
    const reopened = registerAuth(config, () => null);
    expect(reopened.getAdminSession()).toEqual({ admin: true });

    // Still offline after a status check: the last answer holds until a good check replaces it.
    await getStatus();
    expect(reopened.getAdminSession()).toEqual({ admin: true });
  });

  it("a failed entitlements fetch keeps the stored admin; a good one replaces it", async () => {
    const handle = await signInWith(answerFor("user-1", true));
    vi.spyOn(authClient, "getSession").mockResolvedValue({
      userId: "user-1",
      email: "a@b.com",
      name: "A",
    });

    vi.spyOn(authClient, "getEntitlements").mockRejectedValue(new Error("offline"));
    await getStatus();
    expect(handle.getAdminSession()).toEqual({ admin: true });

    vi.spyOn(authClient, "getEntitlements").mockResolvedValue(answerFor("user-1", false));
    await getStatus();
    expect(handle.getAdminSession()).toEqual({ admin: false });
  });

  it("a refresh whose answer names another user does not grant admin", async () => {
    const handle = await signInWith(answerFor("user-1", false));
    vi.spyOn(authClient, "getSession").mockResolvedValue({
      userId: "user-1",
      email: "a@b.com",
      name: "A",
    });
    vi.spyOn(authClient, "getEntitlements").mockResolvedValue(answerFor("user-2", true));
    await getStatus();
    expect(handle.getAdminSession()).toEqual({ admin: false });
  });

  it("sign-out clears the permission, in memory and on disk", async () => {
    const handle = await signInWith(answerFor("user-1", true));
    const changes: Array<boolean | null> = [];
    handle.onAdminChanged(() => changes.push(handle.getAdminSession()?.admin ?? null));

    await mockState.handlers.get(IPC_CHANNELS.authSignOut)!({
      sender: mockState.windows[0]!.webContents,
    });

    expect(handle.getAdminSession()).toBeNull();
    expect(changes).toEqual([null]);
    expect(registerAuth(config, () => null).getAdminSession()).toBeNull();
  });

  it("an admin:true answer for A that arrives after A signed out and B signed in does not make B admin", async () => {
    const mainWindow = mockState.windows[0]!;
    const handle = await signInWith(answerFor("user-1", false));
    vi.spyOn(authClient, "getSession").mockResolvedValue({
      userId: "user-1",
      email: "a@b.com",
      name: "A",
    });
    let answerA!: (value: Entitlements) => void;
    const late = new Promise<Entitlements>((resolve) => (answerA = resolve));
    vi.spyOn(authClient, "getEntitlements").mockImplementation(async (_config, token) =>
      token === "tok_1" ? late : answerFor("user-2", false),
    );

    const refresh = getStatus(); // A's refresh is in flight
    await Promise.resolve();
    await mockState.handlers.get(IPC_CHANNELS.authSignOut)!({ sender: mainWindow.webContents });
    browser.exchange.mockResolvedValue({
      token: "tok_2",
      userId: "user-2",
      email: "b@b.com",
      name: "B",
    });
    await signInVia({ sender: mainWindow.webContents });

    answerA(answerFor("user-1", true)); // arrives late
    const status = await refresh;

    expect(status).not.toMatchObject({ kind: "signed-in", userId: "user-1" });
    expect(status).toMatchObject({ kind: "signed-in", userId: "user-2", email: "b@b.com" });
    expect(handle.getAdminSession()).toEqual({ admin: false });
    expect(handle.getCurrentAccount()).toEqual({ userId: "user-2", token: "tok_2" });
    expect(registerAuth(config, () => null).getAdminSession()).toEqual({ admin: false });
  });

  it("a session check for A that returns after A signed out and B signed in does not overwrite B's identity", async () => {
    const mainWindow = mockState.windows[0]!;
    const handle = await signInWith(answerFor("user-1", false));
    let identityA!: (value: { userId: string; email: string; name: string }) => void;
    const late = new Promise<{ userId: string; email: string; name: string }>(
      (resolve) => (identityA = resolve),
    );
    vi.spyOn(authClient, "getSession").mockReturnValue(late);
    const entitlements = vi
      .spyOn(authClient, "getEntitlements")
      .mockResolvedValue(answerFor("user-2", false));

    const check = getStatus(); // A's session check is in flight
    await Promise.resolve();
    await mockState.handlers.get(IPC_CHANNELS.authSignOut)!({ sender: mainWindow.webContents });
    browser.exchange.mockResolvedValue({
      token: "tok_2",
      userId: "user-2",
      email: "b@b.com",
      name: "B",
    });
    await signInVia({ sender: mainWindow.webContents });
    entitlements.mockClear();

    identityA({ userId: "user-1", email: "a@b.com", name: "A" }); // arrives late
    const status = await check;

    expect(entitlements).not.toHaveBeenCalled();
    expect(handle.getCurrentAccount()).toEqual({ userId: "user-2", token: "tok_2" });
    expect(JSON.stringify(status)).not.toContain("user-1");
    expect(status).toMatchObject({ kind: "signed-in", userId: "user-2" });
    expect(JSON.stringify(handle.getAdminSession())).not.toContain("user-1");
  });

  it("a session check for A that fails after A signed out and B signed in reports B as signed in", async () => {
    const mainWindow = mockState.windows[0]!;
    await signInWith(answerFor("user-1", false));
    let failA!: (reason: Error) => void;
    const late = new Promise<never>((_resolve, reject) => (failA = reject));
    vi.spyOn(authClient, "getSession").mockReturnValue(late);
    vi.spyOn(authClient, "getEntitlements").mockResolvedValue(answerFor("user-2", false));

    const check = getStatus(); // A's session check is in flight
    await Promise.resolve();
    await mockState.handlers.get(IPC_CHANNELS.authSignOut)!({ sender: mainWindow.webContents });
    browser.exchange.mockResolvedValue({
      token: "tok_2",
      userId: "user-2",
      email: "b@b.com",
      name: "B",
    });
    await signInVia({ sender: mainWindow.webContents });

    failA(new Error("timeout")); // A's check fails late
    const status = await check;

    expect(status).toMatchObject({ kind: "signed-in", userId: "user-2", email: "b@b.com" });
    expect(JSON.stringify(status)).not.toContain("user-1");
  });

  it("a session check for A that fails after A signed out reports signed-out, not unknown", async () => {
    const mainWindow = mockState.windows[0]!;
    await signInWith(answerFor("user-1", false));
    let failA!: (reason: Error) => void;
    const late = new Promise<never>((_resolve, reject) => (failA = reject));
    vi.spyOn(authClient, "getSession").mockReturnValue(late);

    const check = getStatus();
    await Promise.resolve();
    await mockState.handlers.get(IPC_CHANNELS.authSignOut)!({ sender: mainWindow.webContents });

    failA(new Error("timeout"));
    expect(await check).toEqual({ kind: "signed-out" });
  });

  it("signing in as another account never inherits the previous account's permission", async () => {
    const mainWindow = mockState.windows[0]!;
    const handle = await signInWith(answerFor("user-1", true));
    expect(handle.getAdminSession()).toEqual({ admin: true });

    vi.spyOn(authClient, "getEntitlements").mockResolvedValue(answerFor("user-2", false));
    vi.spyOn(authClient, "signOutRemote").mockResolvedValue();
    browser.exchange.mockResolvedValue({
      token: "tok_2",
      userId: "user-2",
      email: "b@b.com",
      name: "B",
    });
    await signInVia({ sender: mainWindow.webContents });
    expect(handle.getAdminSession()).toEqual({ admin: false });
  });

  it("notifies when the permission changes value, and only then", async () => {
    const handle = await signInWith(answerFor("user-1", false));
    vi.spyOn(authClient, "getSession").mockResolvedValue({
      userId: "user-1",
      email: "a@b.com",
      name: "A",
    });
    const seen: boolean[] = [];
    handle.onAdminChanged(() => seen.push(handle.getAdminSession()?.admin === true));

    await getStatus(); // still false: nothing to say
    vi.spyOn(authClient, "getEntitlements").mockResolvedValue(answerFor("user-1", true));
    await getStatus();
    await getStatus(); // still true
    expect(seen).toEqual([true]);
  });

  it("the verification-email timestamp write keeps the stored admin", async () => {
    const mainWindow = mockState.windows[0]!;
    await signInWith(answerFor("user-1", true));
    vi.spyOn(authClient, "resendVerificationEmail").mockResolvedValue(true);
    await mockState.handlers.get(IPC_CHANNELS.authResendVerification)!({
      sender: mainWindow.webContents,
    });
    expect(registerAuth(config, () => null).getAdminSession()).toEqual({ admin: true });
  });

  it("a verification email for A that finishes after B signed in is not recorded on B's session", async () => {
    const mainWindow = mockState.windows[0]!;
    await signInWith(answerFor("user-1", false));
    let sendDone!: (value: boolean) => void;
    vi.spyOn(authClient, "resendVerificationEmail").mockReturnValue(
      new Promise<boolean>((resolve) => (sendDone = resolve)),
    );
    vi.spyOn(authClient, "getEntitlements").mockResolvedValue(answerFor("user-2", false));

    const resend = mockState.handlers.get(IPC_CHANNELS.authResendVerification)!({
      sender: mainWindow.webContents,
    });
    await Promise.resolve();
    await mockState.handlers.get(IPC_CHANNELS.authSignOut)!({ sender: mainWindow.webContents });
    browser.exchange.mockResolvedValue({
      token: "tok_2",
      userId: "user-2",
      email: "b@b.com",
      name: "B",
    });
    await signInVia({ sender: mainWindow.webContents });
    sendDone(true); // A's mail went out, after B signed in

    expect(await resend).toMatchObject({ ok: true });
    vi.spyOn(authClient, "getSession").mockResolvedValue({
      userId: "user-2",
      email: "b@b.com",
      name: "B",
    });
    expect(await getStatus()).not.toHaveProperty("verificationEmailSentAt", expect.any(Number));
    // A fresh process reads B's session from disk without A's timestamp either.
    vi.spyOn(authClient, "getSession").mockRejectedValue(new Error("offline"));
    registerAuth(config, () => null);
    expect(await getStatus()).not.toHaveProperty("verificationEmailSentAt", expect.any(Number));
  });

  // ── Account identity (AuthHandle for main modules) ────────────────────

  it("exposes the current account (userId + token) to main modules and notifies on change", async () => {
    browser.exchange.mockResolvedValue({
      token: "t1",
      userId: "user-1",
      email: "a@b.com",
      name: "A",
    });
    const handle = registerAuth(config, () => ({ webContents: MAIN_SENDER }) as never);
    const seen: Array<string | null> = [];
    handle.onAccountChanged((userId) => seen.push(userId));

    expect(handle.getCurrentAccount()).toBeNull();
    await signInVia({ sender: MAIN_SENDER });
    expect(handle.getCurrentAccount()).toEqual({ userId: "user-1", token: "t1" });

    await mockState.handlers.get(IPC_CHANNELS.authSignOut)!({ sender: MAIN_SENDER });
    expect(handle.getCurrentAccount()).toBeNull();
    expect(seen).toEqual(["user-1", null]);
  });

  it("restores the account id from disk before any server round-trip", async () => {
    await writeFile(join(mockState.userDataDir, "auth.enc"), storedBlob("t-disk"));
    const handle = registerAuth(config, () => null);
    expect(handle.getCurrentAccount()).toEqual({ userId: "user-1", token: "t-disk" });
  });

  // ── Browser sign-in ───────────────────────────────────────────────────

  const BROWSER_RESULT = { token: "signed.tok", userId: "user-9", email: "z@b.com", name: "Z" };

  it("commits the signed token from the browser exchange to auth.enc, where every consumer reads it", async () => {
    browser.exchange.mockResolvedValue(BROWSER_RESULT);
    const handle = registerAuth(config, () => ({ webContents: MAIN_SENDER }) as never);

    await signInVia({ sender: MAIN_SENDER });

    expect(browser.begin).toHaveBeenCalledWith("sign-in");
    expect(browser.exchange).toHaveBeenCalledWith("code-from-browser");
    expect(handle.getCurrentAccount()).toEqual({ userId: "user-9", token: "signed.tok" });
    // A fresh process reads the same bearer token back from disk.
    const reopened = registerAuth(config, () => null);
    expect(reopened.getCurrentAccount()).toEqual({ userId: "user-9", token: "signed.tok" });
  });

  it("keeps a session written before the browser flow valid: it loads without a re-login", async () => {
    await writeFile(join(mockState.userDataDir, "auth.enc"), storedBlob("legacy.tok"));
    const getSession = vi
      .spyOn(authClient, "getSession")
      .mockResolvedValue({ userId: "user-1", email: "a@b.com", name: "A" });
    registerAuth(config, () => null);

    const status = await mockState.handlers.get(IPC_CHANNELS.authGetStatus)!({
      sender: OTHER_SENDER,
    });

    expect(getSession).toHaveBeenCalledWith(config, "legacy.tok");
    expect(status).toMatchObject({ kind: "signed-in", email: "a@b.com" });
    expect(browser.begin).not.toHaveBeenCalled();
  });

  it("passes the sign-up intent through to the browser", async () => {
    registerAuth(config, () => ({ webContents: MAIN_SENDER }) as never);
    await mockState.handlers.get(IPC_CHANNELS.authBeginBrowserSignIn)!(
      { sender: MAIN_SENDER },
      "sign-up",
    );
    expect(browser.begin).toHaveBeenCalledWith("sign-up");
  });

  it("refuses a code when no sign-in was started, and after Cancel", async () => {
    browser.exchange.mockResolvedValue(BROWSER_RESULT);
    registerAuth(config, () => ({ webContents: MAIN_SENDER }) as never);
    const submit = async (): Promise<unknown> =>
      mockState.handlers.get(IPC_CHANNELS.authSubmitCode)!({ sender: MAIN_SENDER }, "c");

    await expect(submit()).resolves.toEqual({ ok: false, error: { kind: "state-mismatch" } });

    await mockState.handlers.get(IPC_CHANNELS.authBeginBrowserSignIn)!(
      { sender: MAIN_SENDER },
      "sign-in",
    );
    await mockState.handlers.get(IPC_CHANNELS.authCancelBrowserSignIn)!({ sender: MAIN_SENDER });
    await expect(submit()).resolves.toEqual({ ok: false, error: { kind: "state-mismatch" } });
    expect(browser.exchange).not.toHaveBeenCalled();
  });

  it("reports a failed browser start and a missing web address as results", async () => {
    browser.begin.mockRejectedValue(new TypeError("fetch failed"));
    registerAuth(config, () => ({ webContents: MAIN_SENDER }) as never);
    await expect(
      mockState.handlers.get(IPC_CHANNELS.authBeginBrowserSignIn)!(
        { sender: MAIN_SENDER },
        "sign-in",
      ),
    ).resolves.toEqual({ ok: false, error: { kind: "unknown", message: "fetch failed" } });

    mockState.handlers.clear();
    registerRealAuth(config, (() => ({ webContents: MAIN_SENDER })) as never);
    await expect(
      mockState.handlers.get(IPC_CHANNELS.authBeginBrowserSignIn)!(
        { sender: MAIN_SENDER },
        "sign-in",
      ),
    ).resolves.toEqual({ ok: false, error: { kind: "not-configured" } });
  });

  it("completes a sign-in from the deep link and tells the renderer when it fails", async () => {
    const sendToRenderer = vi.fn();
    browser.exchange.mockRejectedValueOnce({ kind: "invalid-code" });
    const handle = registerAuth(config, () => ({ webContents: MAIN_SENDER }) as never, {
      sendToRenderer,
    });
    await mockState.handlers.get(IPC_CHANNELS.authBeginBrowserSignIn)!(
      { sender: MAIN_SENDER },
      "sign-in",
    );

    await expect(handle.completeBrowserSignIn("expired")).resolves.toEqual({
      ok: false,
      error: { kind: "invalid-code" },
    });
    expect(sendToRenderer).toHaveBeenCalledWith(IPC_CHANNELS.authBrowserSignInFailed, {
      kind: "invalid-code",
    });

    browser.exchange.mockResolvedValueOnce(BROWSER_RESULT);
    await expect(handle.completeBrowserSignIn("good")).resolves.toMatchObject({ ok: true });
    expect(handle.getCurrentAccount()).toEqual({ userId: "user-9", token: "signed.tok" });
  });

  it("a deep link with nothing pending reports a mismatch (cold start by a stale link)", async () => {
    const sendToRenderer = vi.fn();
    const handle = registerAuth(config, () => null, { sendToRenderer });

    await expect(handle.completeBrowserSignIn("stale")).resolves.toEqual({
      ok: false,
      error: { kind: "state-mismatch" },
    });
    expect(sendToRenderer).toHaveBeenCalledWith(IPC_CHANNELS.authBrowserSignInFailed, {
      kind: "state-mismatch",
    });
    expect(browser.exchange).not.toHaveBeenCalled();
  });

  it("ignores a stale link while signed in with nothing pending, without showing an error", async () => {
    await writeFile(join(mockState.userDataDir, "auth.enc"), storedBlob("tok"));
    const sendToRenderer = vi.fn();
    const handle = registerAuth(config, () => null, { sendToRenderer });

    await handle.completeBrowserSignIn("stale");

    expect(sendToRenderer).not.toHaveBeenCalled();
    expect(handle.getCurrentAccount()).toEqual({ userId: "user-1", token: "tok" });
  });

  it("signing in over an existing session releases the old one on the server", async () => {
    await writeFile(join(mockState.userDataDir, "auth.enc"), storedBlob("old.tok"));
    const signOutRemote = vi.spyOn(authClient, "signOutRemote").mockResolvedValue();
    browser.exchange.mockResolvedValue(BROWSER_RESULT);
    registerAuth(config, () => ({ webContents: MAIN_SENDER }) as never);

    await signInVia({ sender: MAIN_SENDER });

    expect(signOutRemote).toHaveBeenCalledWith(config, "old.tok");
  });

  it("sign-out after a browser sign-in clears auth.enc and signs out on the server with the bearer token", async () => {
    browser.exchange.mockResolvedValue(BROWSER_RESULT);
    const signOutRemote = vi.spyOn(authClient, "signOutRemote").mockResolvedValue();
    registerAuth(config, () => ({ webContents: MAIN_SENDER }) as never);
    await signInVia({ sender: MAIN_SENDER });

    await mockState.handlers.get(IPC_CHANNELS.authSignOut)!({ sender: MAIN_SENDER });

    expect(signOutRemote).toHaveBeenCalledWith(config, "signed.tok");
    const reopened = registerAuth(config, () => null);
    expect(reopened.getCurrentAccount()).toBeNull();
  });
});
