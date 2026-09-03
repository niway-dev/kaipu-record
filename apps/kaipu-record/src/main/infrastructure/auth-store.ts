import { app, BrowserWindow, ipcMain, safeStorage } from "electron";
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AuthCredentials, AuthStatus, SignUpInput } from "@shared/types/auth";
import { IPC_CHANNELS } from "@shared/types/ipc";
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
      if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.authStatusChanged, status);
    }
  }

  function requireMainWindow(event: Electron.IpcMainInvokeEvent): void {
    if (event.sender !== getMainWindow()?.webContents) {
      throw new Error("auth IPC calls are only accepted from the main window");
    }
  }

  ipcMain.handle(IPC_CHANNELS.authGetStatus, async (): Promise<AuthStatus> => {
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
    IPC_CHANNELS.authSignIn,
    async (event, credentials: AuthCredentials): Promise<AuthStatus> => {
      requireMainWindow(event);
      return commitSignIn(await signInWithPassword(config, credentials));
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.authSignUp,
    async (event, input: SignUpInput): Promise<AuthStatus> => {
      requireMainWindow(event);
      return commitSignIn(await signUpWithPassword(config, input));
    },
  );

  ipcMain.handle(IPC_CHANNELS.authSignOut, async (event): Promise<void> => {
    requireMainWindow(event);
    const outgoingToken = token;
    token = null;
    cachedIdentity = null;
    clearStoredToken();
    broadcast({ kind: "signed-out" });
    if (outgoingToken)
      void signOutRemote(config, outgoingToken).catch((error) => {
        console.error("remote auth sign-out failed", error);
      });
  });
}
