import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IPC_CHANNELS } from "@shared/types/ipc";

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

const OTHER_SENDER = { id: "other" };
const config = { serverUrl: "http://localhost:3000" };

/** The on-disk shape readStoredSession expects: the fake safeStorage marker wrapped around the
 *  JSON envelope (token + identity), matching what writeStoredSession produces. */
function storedBlob(token: string, email = "a@b.com", name = "A"): string {
  return `ENC:${JSON.stringify({ token, email, name })}`;
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

  it("authSignIn persists the token, caches identity, and broadcasts signed-in", async () => {
    vi.spyOn(authClient, "signInWithPassword").mockResolvedValue({
      token: "tok_1",
      email: "a@b.com",
      name: "A",
    });
    const mainWindow = mockState.windows[0]!;
    registerAuth(config, () => mainWindow as never);

    const status = await mockState.handlers.get(IPC_CHANNELS.authSignIn)!(
      { sender: mainWindow.webContents },
      { email: "a@b.com", password: "pw" },
    );

    expect(status).toEqual({
      ok: true,
      status: { kind: "signed-in", email: "a@b.com", name: "A" },
    });
    expect(mainWindow.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.authStatusChanged, {
      kind: "signed-in",
      email: "a@b.com",
      name: "A",
    });
  });

  it("does not send a broadcast to a destroyed window", async () => {
    const destroyed = fakeWindow();
    destroyed.isDestroyed = () => true;
    const liveWindow = fakeWindow();
    mockState.windows = [destroyed, liveWindow];
    vi.spyOn(authClient, "signInWithPassword").mockResolvedValue({
      token: "tok_1",
      email: "a@b.com",
      name: "A",
    });
    registerAuth(config, () => liveWindow as never);

    await mockState.handlers.get(IPC_CHANNELS.authSignIn)!(
      { sender: liveWindow.webContents },
      { email: "a@b.com", password: "pw" },
    );

    expect(destroyed.webContents.send).not.toHaveBeenCalled();
    expect(liveWindow.webContents.send).toHaveBeenCalledOnce();
  });

  it("rejects authSignIn from a window that isn't the main window", async () => {
    const mainWindow = mockState.windows[0]!;
    registerAuth(config, () => mainWindow as never);

    await expect(
      mockState.handlers.get(IPC_CHANNELS.authSignIn)!(
        { sender: OTHER_SENDER },
        { email: "a@b.com", password: "pw" },
      ),
    ).rejects.toThrow();
  });

  it("returns a credential failure as a structured result instead of throwing it", async () => {
    // Electron serializes anything thrown out of ipcMain.handle down to its `.message`, so a
    // thrown `{ kind }` would reach the renderer with no discriminant at all. The handler must
    // resolve the error instead, where structured cloning preserves it in full.
    vi.spyOn(authClient, "signInWithPassword").mockRejectedValue({ kind: "invalid-credentials" });
    const mainWindow = mockState.windows[0]!;
    registerAuth(config, () => mainWindow as never);

    await expect(
      mockState.handlers.get(IPC_CHANNELS.authSignIn)!(
        { sender: mainWindow.webContents },
        { email: "a@b.com", password: "wrong" },
      ),
    ).resolves.toEqual({ ok: false, error: { kind: "invalid-credentials" } });
    expect(mainWindow.webContents.send).not.toHaveBeenCalled();
  });

  it("authGetStatus does not reject from a non-main sender — it's read-only", async () => {
    registerAuth(config, () => null);
    await expect(
      mockState.handlers.get(IPC_CHANNELS.authGetStatus)!({ sender: OTHER_SENDER }),
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
    await mockState.handlers.get(IPC_CHANNELS.authSignIn)!(
      { sender: mainWindow.webContents },
      { email: "a@b.com", password: "pw" },
    );

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
    vi.spyOn(authClient, "signInWithPassword").mockResolvedValue({
      token: "tok_1",
      email: "a@b.com",
      name: "A",
    });
    const mainWindow = mockState.windows[0]!;
    registerAuth(config, () => mainWindow as never);
    await mockState.handlers.get(IPC_CHANNELS.authSignIn)!(
      { sender: mainWindow.webContents },
      { email: "a@b.com", password: "pw" },
    );

    vi.spyOn(authClient, "getSession").mockRejectedValue(new Error("offline"));
    const status = await mockState.handlers.get(IPC_CHANNELS.authGetStatus)!({
      sender: OTHER_SENDER,
    });
    expect(status).toEqual({ kind: "unknown", lastKnownEmail: "a@b.com" });

    // The token on disk must survive — a fresh registerAuth + a working getSession proves it.
    vi.spyOn(authClient, "getSession").mockResolvedValue({ email: "a@b.com", name: "A" });
    registerAuth(config, () => mainWindow as never);
    const restored = await mockState.handlers.get(IPC_CHANNELS.authGetStatus)!({
      sender: OTHER_SENDER,
    });
    expect(restored).toEqual({ kind: "signed-in", email: "a@b.com", name: "A" });
  });

  it("names the persisted account in `unknown` on the first check after a restart", async () => {
    // The canonical case lastKnownEmail exists for: the app restarted with a token on disk and
    // the server is unreachable, so nothing in THIS process has ever had a successful
    // getSession to populate an in-memory identity cache. Before the identity was persisted
    // alongside the token, this rendered an empty label.
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      join(mockState.userDataDir, "auth.enc"),
      storedBlob("tok_1", "restored@b.com", "Restored"),
    );
    vi.spyOn(authClient, "getSession").mockRejectedValue(new Error("offline"));

    registerAuth(config, () => null);
    const status = await mockState.handlers.get(IPC_CHANNELS.authGetStatus)!({
      sender: OTHER_SENDER,
    });

    expect(status).toEqual({ kind: "unknown", lastKnownEmail: "restored@b.com" });
  });

  it("persists the identity with the token, so a restart restores it without a round-trip", async () => {
    vi.spyOn(authClient, "signInWithPassword").mockResolvedValue({
      token: "tok_1",
      email: "a@b.com",
      name: "A",
    });
    const mainWindow = mockState.windows[0]!;
    registerAuth(config, () => mainWindow as never);
    await mockState.handlers.get(IPC_CHANNELS.authSignIn)!(
      { sender: mainWindow.webContents },
      { email: "a@b.com", password: "pw" },
    );

    const { readFile } = await import("node:fs/promises");
    const onDisk = await readFile(join(mockState.userDataDir, "auth.enc"), "utf8");
    expect(JSON.parse(onDisk.slice("ENC:".length))).toEqual({
      token: "tok_1",
      email: "a@b.com",
      name: "A",
    });

    // A fresh process reading that file reports the identity even with the server unreachable.
    vi.spyOn(authClient, "getSession").mockRejectedValue(new Error("offline"));
    registerAuth(config, () => mainWindow as never);
    await expect(
      mockState.handlers.get(IPC_CHANNELS.authGetStatus)!({ sender: OTHER_SENDER }),
    ).resolves.toEqual({ kind: "unknown", lastKnownEmail: "a@b.com" });
  });

  it("treats a pre-envelope plain-token file as no session rather than crashing", async () => {
    // An app installed before the envelope has a raw token string on disk; JSON.parse throws on
    // it, which readStoredSession swallows like any other corruption. A one-time re-login.
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(mockState.userDataDir, "auth.enc"), "ENC:tok_legacy_plain");

    expect(() => registerAuth(config, () => null)).not.toThrow();
    await expect(
      mockState.handlers.get(IPC_CHANNELS.authGetStatus)!({ sender: OTHER_SENDER }),
    ).resolves.toEqual({ kind: "signed-out" });
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
    await mockState.handlers.get(IPC_CHANNELS.authSignIn)!(
      { sender: mainWindow.webContents },
      { email: "a@b.com", password: "pw" },
    );

    await mockState.handlers.get(IPC_CHANNELS.authSignOut)!({ sender: mainWindow.webContents });

    registerAuth(config, () => mainWindow as never);
    const status = await mockState.handlers.get(IPC_CHANNELS.authGetStatus)!({
      sender: OTHER_SENDER,
    });
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

    // The handler RETURNS the failure rather than throwing it (Electron would strip a thrown
    // error down to its `.message` and lose the structured `kind`).
    await expect(
      mockState.handlers.get(IPC_CHANNELS.authSignIn)!(
        { sender: mainWindow.webContents },
        { email: "a@b.com", password: "pw" },
      ),
    ).resolves.toMatchObject({ ok: false, error: { kind: "unknown" } });

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
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(mockState.userDataDir, "auth.enc"), "not-encrypted-garbage");

    expect(() => registerAuth(config, () => null)).not.toThrow();
    const status = await mockState.handlers.get(IPC_CHANNELS.authGetStatus)!({
      sender: OTHER_SENDER,
    });
    expect(status).toEqual({ kind: "signed-out" });
  });

  it("fails closed when encryption becomes unavailable while a token exists", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(mockState.userDataDir, "auth.enc"), storedBlob("tok_1"));
    mockState.encryptionAvailable = false;

    registerAuth(config, () => null);
    const status = await mockState.handlers.get(IPC_CHANNELS.authGetStatus)!({
      sender: OTHER_SENDER,
    });
    expect(status).toEqual({ kind: "signed-out" });
  });

  it("routes sign-up through the same persist-then-cache transaction", async () => {
    vi.spyOn(authClient, "signUpWithPassword").mockResolvedValue({
      token: "tok_2",
      email: "new@b.com",
      name: "New",
    });
    const mainWindow = mockState.windows[0]!;
    registerAuth(config, () => mainWindow as never);

    await expect(
      mockState.handlers.get(IPC_CHANNELS.authSignUp)!(
        { sender: mainWindow.webContents },
        { email: "new@b.com", password: "pw", name: "New" },
      ),
    ).resolves.toEqual({
      ok: true,
      status: { kind: "signed-in", email: "new@b.com", name: "New" },
    });
  });

  it("rejects authSignOut from a non-main sender", async () => {
    registerAuth(config, () => mockState.windows[0] as never);
    await expect(
      mockState.handlers.get(IPC_CHANNELS.authSignOut)!({ sender: OTHER_SENDER }),
    ).rejects.toThrow();
  });
});
