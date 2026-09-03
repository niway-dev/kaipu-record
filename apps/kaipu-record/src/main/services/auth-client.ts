import type { AuthCredentials, AuthError, SignUpInput } from "@shared/types/auth";

export interface AuthClientConfig {
  serverUrl: string;
}

export interface SignInResult {
  token: string;
  email: string;
  name: string;
}

/** The per-endpoint default reported for a rejected credential submission, used whenever the
 *  response body carries no more specific code. */
type DefaultFailureKind = "invalid-credentials" | "email-taken";

function networkError(): AuthError {
  return { kind: "network" };
}

async function callCredentialEndpoint(
  config: AuthClientConfig,
  path: string,
  body: AuthCredentials | SignUpInput,
  invalidStatusKind: DefaultFailureKind,
): Promise<SignInResult> {
  let res: Response;
  try {
    res = await fetch(`${config.serverUrl}/api/auth/${path}`, {
      method: "POST",
      // This Origin is load-bearing, not decorative: Electron's main-process fetch()
      // (Chromium's network stack) attaches Sec-Fetch-* headers even outside a page
      // context, which trips better-auth's Sec-Fetch-gated CSRF check on sign-in/email
      // and sign-up/email specifically — without a trusted Origin, both 403 with
      // MISSING_OR_NULL_ORIGIN. Must stay byte-identical to the trustedOrigins entry in
      // apps/server-hono/src/lib/auth.ts, which explains the mechanism in full.
      headers: { "Content-Type": "application/json", Origin: "kaipu-record://app" },
      body: JSON.stringify(body),
    });
  } catch {
    throw networkError();
  }

  if (!res.ok) {
    // better-auth answers an error with a `{code, message}` JSON body. Only PASSWORD_TOO_SHORT
    // is special-cased: baseConfig sets no `minPasswordLength`, so better-auth's default of 8
    // applies, and a shorter sign-up password would otherwise be reported to the user as "that
    // email is already registered" — actively misleading. Every other code keeps the
    // per-endpoint default, which is already the common case for its endpoint
    // (INVALID_EMAIL_OR_PASSWORD on sign-in, USER_ALREADY_EXISTS on sign-up).
    const body = (await res.json().catch(() => null)) as { code?: string } | null;
    if (body?.code === "PASSWORD_TOO_SHORT")
      throw { kind: "password-too-short" } satisfies AuthError;
    throw { kind: invalidStatusKind } satisfies AuthError;
  }

  const token = res.headers.get("set-auth-token");
  if (!token)
    throw {
      kind: "unknown",
      message: "sign-in succeeded but no session token was issued",
    } satisfies AuthError;

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
 * Resolves `null` ONLY on a confirmed "the session is gone" answer from the server (a 401, or
 * the far more common 200 + `null` body — see below). Any other failure (network, timeout,
 * non-401 error status) REJECTS — the caller must not conflate "server said no" with "couldn't
 * ask the server," or an offline status check would delete a still-valid token.
 */
export async function getSession(
  config: AuthClientConfig,
  token: string,
): Promise<{ email: string; name: string } | null> {
  const res = await fetch(`${config.serverUrl}/api/auth/get-session`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  // A network failure throws out of `fetch` itself and propagates — intentionally not caught here.
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`get-session failed: ${res.status}`);
  // better-auth answers "no valid session" (no cookie resolved, or session expired) with
  // 200 + a `null` body, not 401 — 401 only fires in a narrow concurrent-update edge case.
  // Both must be treated identically: "confirmed gone," safe to clear the local token.
  const data = (await res.json().catch(() => null)) as {
    user?: { email: string; name: string };
  } | null;
  if (!data?.user) return null;
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
