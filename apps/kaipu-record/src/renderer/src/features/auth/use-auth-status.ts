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
  // Starts true: the default `status` above is indistinguishable from a genuine signed-out
  // user until the initial getAuthStatus() round-trip actually resolves. Against a real
  // server this can take noticeably longer than a mocked promise, and without this flag
  // AccountPanel briefly renders the "Sign in"/"Create account" buttons even for an
  // already-signed-in user, before flipping to the real state a moment later.
  const [pending, setPending] = useState(true);
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
      setPending(false);
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
      .finally(() => setPending(false));
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
    () =>
      runAttempt(async () => {
        await window.electronAPI.signOut();
        setStatus({ kind: "signed-out" });
      }),
    [runAttempt],
  );

  return { status, pending, error, refresh, signIn, signUp, signOut };
}
