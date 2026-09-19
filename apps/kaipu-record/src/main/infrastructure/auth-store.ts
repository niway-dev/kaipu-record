import { app, BrowserWindow, ipcMain, safeStorage } from "electron";
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FREE_ENTITLEMENTS, type Entitlements } from "@shared/entitlements";
import type { AuthCredentials, AuthError, AuthStatus, SignUpInput } from "@shared/types/auth";
import type { AuthAttemptResult } from "@shared/types/electron-api";
import { IPC_CHANNELS } from "@shared/types/ipc";
import {
  getEntitlements,
  getSession,
  resendVerificationEmail,
  signInWithPassword,
  signOutRemote,
  signUpWithPassword,
  type AuthClientConfig,
} from "../services/auth-client";

function tokenFilePath(): string {
  return join(app.getPath("userData"), "auth.enc");
}

/** What survives a restart. The identity is stored alongside the token, not just the token,
 *  so the very first status check of a new process can already name the account it is trying
 *  to verify — `unknown`'s `lastKnownEmail` exists precisely for the "restarted while offline"
 *  case, which is exactly when a process-local cache is still empty. */
interface StoredSession {
  token: string;
  userId: string;
  email: string;
  name: string;
  /** Last plan the server reported. Optional on read only: files written before entitlements
   *  existed have none and load as free — a one-time re-check on the next status call, not a
   *  re-login. */
  entitlements?: Entitlements;
  /** When this machine last sent a verification email for this account. Optional on read:
   *  files written before this existed simply have none, which reads as "never sent". */
  verificationEmailSentAt?: number;
}

/** The signed-in (or restored-from-disk) account, handed to main modules only — the renderer
 *  never sees the token. Produced by `registerAuth`, consumed by later main-process wiring
 *  (e.g. the library vault) that needs to know which account owns what it stores. */
export interface AuthHandle {
  /** The signed-in (or restored-from-disk) account, or null. Never the renderer's business. */
  getCurrentAccount(): { userId: string; token: string } | null;
  /** Fires with the new userId on sign-in and null on sign-out / confirmed-invalid token. */
  onAccountChanged(listener: (userId: string | null) => void): () => void;
}

function readStoredSession(): StoredSession | null {
  if (!safeStorage.isEncryptionAvailable()) return null;
  const path = tokenFilePath();
  if (!existsSync(path)) return null;
  try {
    const decrypted = safeStorage.decryptString(readFileSync(path));
    const parsed = JSON.parse(decrypted) as StoredSession;
    // A stored file without a string `userId` predates cloud identity — treated as absent,
    // forcing one re-login rather than trusting a session with no known account.
    if (
      typeof parsed.token !== "string" ||
      typeof parsed.userId !== "string" ||
      typeof parsed.email !== "string"
    )
      return null;
    return parsed;
  } catch {
    // Corrupted blob, copied to another machine, a different code-signing identity, or a
    // pre-envelope plain-token file (JSON.parse throws on a raw token string) — none of these
    // should crash app startup. Treat as "no token": a one-time re-login, not a crash.
    return null;
  }
}

function writeStoredSession(session: StoredSession): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Cannot store the session: OS-level encryption is unavailable");
  }
  const path = tokenFilePath();
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(session)));
  renameSync(tmp, path); // atomic — a crash mid-write can't corrupt the real file
}

function clearStoredSession(): void {
  // In-memory state and the sign-out broadcast already flipped before this runs, so a throwing
  // unlink would otherwise leave a usable token on disk that silently restores the session on
  // the next launch — after the user explicitly signed out. Log and continue instead.
  try {
    const path = tokenFilePath();
    if (existsSync(path)) unlinkSync(path);
  } catch (err) {
    console.error("failed to remove the stored auth session", err);
  }
}

/** Narrow whatever auth-client threw into the structured shape the renderer switches on.
 *  auth-client only ever throws `AuthError`-shaped literals, so the cast is a narrowing,
 *  not a lie; anything else (a genuine runtime Error) becomes `unknown` with its message. */
function toAuthError(err: unknown): AuthError {
  if (err && typeof err === "object" && "kind" in err) return err as AuthError;
  return { kind: "unknown", message: err instanceof Error ? err.message : String(err) };
}

export function registerAuth(
  config: AuthClientConfig,
  getMainWindow: () => BrowserWindow | null,
): AuthHandle {
  const stored = readStoredSession();
  let token: string | null = stored?.token ?? null;
  // Seeded from disk, not left null until the first successful getSession: the whole point of
  // `unknown`'s lastKnownEmail is the "app restarted, token on disk, server unreachable" case,
  // where nothing in this process has ever talked to the server yet.
  let cachedIdentity: { userId: string; email: string; name: string } | null = stored
    ? { userId: stored.userId, email: stored.email, name: stored.name }
    : null;
  // Same rationale as cachedIdentity: seeded from disk so an offline restart keeps the plan.
  // Only ever replaced by a successful fetch or cleared by sign-out — a failed fetch is not a
  // downgrade. Null iff there is no token.
  let cachedEntitlements: Entitlements | null = stored
    ? (stored.entitlements ?? FREE_ENTITLEMENTS)
    : null;
  // Seeded from disk for the same reason: the cloud screen is remounted on every visit, so
  // this is the only thing that can tell it the verification mail has already gone out.
  let verificationEmailSentAt: number | undefined = stored?.verificationEmailSentAt;

  // Notified on sign-in (new userId) and on sign-out / confirmed-invalid token (null) — how
  // main-process modules that need to know which account owns what they store (e.g. the
  // library vault) learn of an account change without the renderer relaying the token.
  const accountListeners = new Set<(userId: string | null) => void>();
  function notifyAccountChanged(userId: string | null): void {
    for (const listener of accountListeners) listener(userId);
  }

  /** Re-check the plan and persist it. Failure keeps the cached copy — "couldn't ask" ≠ free. */
  async function refreshEntitlements(
    current: string,
    identity: { userId: string; email: string; name: string },
  ): Promise<Entitlements> {
    try {
      const fresh = await getEntitlements(config, current);
      cachedEntitlements = fresh;
      writeStoredSession({ token: current, ...identity, entitlements: fresh });
      return fresh;
    } catch {
      return cachedEntitlements ?? FREE_ENTITLEMENTS;
    }
  }

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
        // Confirmed gone (a 401, or better-auth's far commoner 200 + null body). Safe to clear.
        token = null;
        cachedIdentity = null;
        cachedEntitlements = null;
        verificationEmailSentAt = undefined;
        clearStoredSession();
        notifyAccountChanged(null);
        return { kind: "signed-out" };
      }
      cachedIdentity = identity;
      // Every successful session check re-checks the plan too: this is how a purchase made on
      // the web reaches the app — the user reopens it. No push, no sync engine.
      const entitlements = await refreshEntitlements(token, identity);
      return { kind: "signed-in", ...identity, entitlements, verificationEmailSentAt };
    } catch {
      // Network/other failure — NEVER clear a token we couldn't actually verify was invalid,
      // and keep reporting the plan we last saw.
      return {
        kind: "unknown",
        lastKnownUserId: cachedIdentity?.userId,
        lastKnownEmail: cachedIdentity?.email,
        entitlements: cachedEntitlements ?? FREE_ENTITLEMENTS,
        verificationEmailSentAt,
      };
    }
  });

  // Shared by sign-in and sign-up: persist FIRST, only update in-memory state if that succeeds.
  // Setting `token`/`cachedIdentity` before a possible `writeStoredSession` failure would leave this
  // running process's in-memory state "signed in" even though nothing was saved and the call
  // rejected to the renderer — an inconsistent state a later authGetStatus in the same session
  // could act on.
  async function commitSignIn(result: {
    token: string;
    userId: string;
    email: string;
    name: string;
  }): Promise<AuthStatus> {
    // A fresh credential means a fresh account: never carry a previous user's plan across.
    // Best-effort fetch — a sign-in must not fail because billing was unreachable.
    let entitlements = FREE_ENTITLEMENTS;
    try {
      entitlements = await getEntitlements(config, result.token);
    } catch {
      // stays free until the next successful status check
    }
    writeStoredSession({ ...result, entitlements });
    token = result.token;
    cachedIdentity = { userId: result.userId, email: result.email, name: result.name };
    cachedEntitlements = entitlements;
    // A fresh credential means a fresh account: never inherit the previous user's send
    // history. The written session omits the field, so disk and memory agree.
    verificationEmailSentAt = undefined;
    const status: AuthStatus = {
      kind: "signed-in",
      userId: result.userId,
      email: result.email,
      name: result.name,
      entitlements,
    };
    broadcast(status);
    notifyAccountChanged(result.userId);
    return status;
  }

  // Both handlers RETURN their failure instead of throwing it: Electron serializes anything
  // thrown out of `ipcMain.handle` down to its `.message`, which would strip the structured
  // `kind` the renderer needs to pick the right error copy. `requireMainWindow` deliberately
  // still throws — that is a programming/security error, not a user-facing auth outcome.
  ipcMain.handle(
    IPC_CHANNELS.authSignIn,
    async (event, credentials: AuthCredentials): Promise<AuthAttemptResult> => {
      requireMainWindow(event);
      try {
        return {
          ok: true,
          status: await commitSignIn(await signInWithPassword(config, credentials)),
        };
      } catch (err) {
        return { ok: false, error: toAuthError(err) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.authSignUp,
    async (event, input: SignUpInput): Promise<AuthAttemptResult> => {
      requireMainWindow(event);
      try {
        return { ok: true, status: await commitSignIn(await signUpWithPassword(config, input)) };
      } catch (err) {
        return { ok: false, error: toAuthError(err) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.authResendVerification,
    async (event): Promise<{ ok: true; sentAt: number } | { ok: false }> => {
      requireMainWindow(event);
      if (!cachedIdentity || !token) return { ok: false };
      if (!(await resendVerificationEmail(config, cachedIdentity.email))) return { ok: false };

      const sentAt = Date.now();
      verificationEmailSentAt = sentAt;
      // Best-effort persistence: the mail is already out, so a failed write must not be
      // reported as a failed send. Worst case the fact is forgotten on the next restart —
      // the same behaviour as before this existed, and strictly better than claiming the
      // send failed and prompting the user to trigger a second email.
      try {
        writeStoredSession({
          token,
          userId: cachedIdentity.userId,
          email: cachedIdentity.email,
          name: cachedIdentity.name,
          entitlements: cachedEntitlements ?? FREE_ENTITLEMENTS,
          verificationEmailSentAt: sentAt,
        });
      } catch (err) {
        console.error("failed to persist the verification-email timestamp", err);
      }
      return { ok: true, sentAt };
    },
  );

  ipcMain.handle(IPC_CHANNELS.authSignOut, async (event): Promise<void> => {
    requireMainWindow(event);
    const outgoingToken = token;
    token = null;
    cachedIdentity = null;
    cachedEntitlements = null;
    verificationEmailSentAt = undefined;
    clearStoredSession();
    broadcast({ kind: "signed-out" });
    notifyAccountChanged(null);
    if (outgoingToken)
      void signOutRemote(config, outgoingToken).catch((error) => {
        console.error("remote auth sign-out failed", error);
      });
  });

  return {
    getCurrentAccount: () =>
      token && cachedIdentity ? { userId: cachedIdentity.userId, token } : null,
    onAccountChanged: (listener) => {
      accountListeners.add(listener);
      return () => accountListeners.delete(listener);
    },
  };
}
