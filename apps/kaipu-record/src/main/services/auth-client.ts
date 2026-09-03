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
  body: AuthCredentials | SignUpInput,
  invalidStatusKind: AuthErrorLike["kind"],
): Promise<SignInResult> {
  let res: Response;
  try {
    res = await fetch(`${config.serverUrl}/api/auth/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "kaipu-record://app" },
      body: JSON.stringify(body),
    });
  } catch {
    throw networkError();
  }

  if (!res.ok) {
    throw { kind: invalidStatusKind } satisfies AuthErrorLike;
  }

  const token = res.headers.get("set-auth-token");
  if (!token)
    throw {
      kind: "unknown",
      message: "sign-in succeeded but no session token was issued",
    } satisfies AuthErrorLike;

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
