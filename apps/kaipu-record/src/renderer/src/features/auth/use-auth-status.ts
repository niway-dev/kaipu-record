import { useCallback, useEffect, useState } from "react";
import type { AuthError, AuthStatus, BrowserSignInIntent } from "@shared/types/auth";
import type { AuthAttemptResult } from "@shared/types/electron-api";

/** Where a browser sign-in is: not started, or the browser is open and the app is waiting for
 *  the link (or a pasted code) to come back. */
export type BrowserSignInPhase = "idle" | "waiting";

export interface AuthStatusStore {
  status: AuthStatus;
  pending: boolean;
  /** False until the first real status arrives (query or broadcast). Unlike `pending`, it never
   *  goes back to false, so later attempts (sign-out) don't bring back first-load placeholders. */
  resolved: boolean;
  error: AuthError | null;
  refresh(): Promise<void>;
  signOut(): Promise<void>;
  phase: BrowserSignInPhase;
  /** True while a pasted code is being exchanged. */
  submittingCode: boolean;
  /** Open the system browser on the web sign-in (or sign-up) page and start waiting. */
  startBrowserSignIn(intent: BrowserSignInIntent): Promise<void>;
  /** Stop waiting: whatever the browser sends back afterwards is ignored. */
  cancelBrowserSignIn(): Promise<void>;
  /** Paste-code fallback. */
  submitCode(code: string): Promise<void>;
  /** Dismiss the current error without starting an attempt. */
  clearError(): void;
}

function unknownError(err: unknown): AuthError {
  return { kind: "unknown", message: err instanceof Error ? err.message : String(err) };
}

export function useAuthStatus(): AuthStatusStore {
  const [status, setStatus] = useState<AuthStatus>({ kind: "signed-out" });
  // Starts true: the default `status` above is indistinguishable from a genuine signed-out
  // user until the initial getAuthStatus() round-trip actually resolves. Against a real
  // server this can take noticeably longer than a mocked promise, and without this flag
  // AccountPanel briefly renders the "Sign in" button even for an already-signed-in user,
  // before flipping to the real state a moment later.
  const [pending, setPending] = useState(true);
  const [resolved, setResolved] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);
  const [phase, setPhase] = useState<BrowserSignInPhase>("idle");
  const [submittingCode, setSubmittingCode] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    const next = await window.electronAPI.getAuthStatus();
    setStatus(next);
  }, []);

  useEffect(() => {
    let broadcastWonRace = false;
    const unsubscribe = window.electronAPI.onAuthStatusChanged((status) => {
      broadcastWonRace = true;
      setStatus(status);
      // A completed sign-in (from the link, or the pasted code) ends the wait.
      if (status.kind === "signed-in") setPhase("idle");
      setPending(false);
      setResolved(true);
    });
    // The link came back but did not complete (stale, expired, not started here): the wait is over.
    const unsubscribeFailed = window.electronAPI.onBrowserSignInFailed((failure) => {
      setError(failure);
      setPhase("idle");
    });
    // Subscribe before querying. If a status broadcast lands while the initial query is in flight,
    // it is newer and must not be overwritten by the stale query response.
    // In practice authGetStatus's IPC handler never rejects (it catches everything internally),
    // but a `.then()` with no `.catch()` would leave `pending` stuck true forever if it ever did —
    // permanently hiding the sign-in UI, worse than the flash this flag exists to prevent.
    void window.electronAPI
      .getAuthStatus()
      .then((status) => {
        if (!broadcastWonRace) setStatus(status);
      })
      .finally(() => {
        setPending(false);
        setResolved(true);
      });
    return () => {
      unsubscribe();
      unsubscribeFailed();
    };
  }, []);

  // Sign-in failures arrive as a RESOLVED `{ ok: false, error }` (a thrown IPC error would lose
  // the structured `kind` — see AuthAttemptResult). The IPC call itself can still reject for a
  // reason unrelated to the sign-in (e.g. auth-store.ts's requireMainWindow rejecting an
  // unexpected sender); without these catches the rejection would escape and leave the UI stuck
  // disabled with no feedback, which is worse than the generic message they fall back to.
  const signOut = useCallback(async (): Promise<void> => {
    setPending(true);
    setError(null);
    try {
      await window.electronAPI.signOut();
      setStatus({ kind: "signed-out" });
    } catch (err) {
      setError(unknownError(err));
    } finally {
      setPending(false);
    }
  }, []);

  const startBrowserSignIn = useCallback(async (intent: BrowserSignInIntent): Promise<void> => {
    setError(null);
    try {
      const result = await window.electronAPI.beginBrowserSignIn(intent);
      if (result.ok) setPhase("waiting");
      else setError(result.error);
    } catch (err) {
      setError(unknownError(err));
    }
  }, []);

  const cancelBrowserSignIn = useCallback(async (): Promise<void> => {
    setPhase("idle");
    setError(null);
    try {
      await window.electronAPI.cancelBrowserSignIn();
    } catch {
      // Main only flips a flag; if even that fails the next sign-in start resets it.
    }
  }, []);

  const submitCode = useCallback(async (code: string): Promise<void> => {
    setSubmittingCode(true);
    setError(null);
    try {
      const result: AuthAttemptResult = await window.electronAPI.submitSignInCode(code);
      if (result.ok) {
        setStatus(result.status);
        setPhase("idle");
      } else setError(result.error);
    } catch (err) {
      setError(unknownError(err));
    } finally {
      setSubmittingCode(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    status,
    pending,
    resolved,
    error,
    refresh,
    signOut,
    phase,
    submittingCode,
    startBrowserSignIn,
    cancelBrowserSignIn,
    submitCode,
    clearError,
  };
}
