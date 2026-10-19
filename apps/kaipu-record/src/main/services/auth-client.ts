import { FREE_ENTITLEMENTS, type Entitlements } from "@shared/entitlements";

export interface AuthClientConfig {
  serverUrl: string;
}

/** What a completed browser sign-in yields: the session token plus who it belongs to. */
export interface SignInResult {
  token: string;
  userId: string;
  email: string;
  name: string;
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
): Promise<{ userId: string; email: string; name: string } | null> {
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
    user?: { id: string; email: string; name: string };
  } | null;
  if (!data?.user) return null;
  return { userId: data.user.id, email: data.user.email, name: data.user.name };
}

/**
 * The account's plan and permissions, from the app's own API (not better-auth — billing is
 * composed with identity server-side, in the route's auth middleware). REJECTS on any failure:
 * a network error, a non-2xx, or an error envelope. The caller holds the last good copy and
 * must keep it; "couldn't ask" is never "you are free now".
 */
export async function getEntitlements(
  config: AuthClientConfig,
  token: string,
): Promise<Entitlements> {
  const res = await fetch(`${config.serverUrl}/api/v1/me/entitlements`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`me/entitlements failed: ${res.status}`);
  const body = (await res.json()) as {
    data: (Omit<Entitlements, "features"> & { features: Partial<Entitlements["features"]> }) | null;
    error: { message: string } | null;
  };
  if (!body.data) throw new Error(body.error?.message ?? "me/entitlements returned no data");
  // The server does not send `cloudUploads`/`cloudStorageBytes` yet (and `watermarkRemoval`
  // may also be absent on an older server) — default whatever the body omits instead of
  // letting `undefined` reach a feature check downstream. See the docstring on
  // `Entitlements` in @shared/entitlements.
  return {
    ...body.data,
    features: {
      watermarkRemoval: body.data.features.watermarkRemoval ?? false,
      cloudUploads: body.data.features.cloudUploads ?? false,
      cloudStorageBytes:
        body.data.features.cloudStorageBytes ?? FREE_ENTITLEMENTS.features.cloudStorageBytes,
    },
  };
}

/** Ask the server to resend the verification email for `email`. Best-effort — never rejects;
 *  the server builds the actual link (see apps/server-hono/src/lib/auth.ts), this call only
 *  triggers it. `callbackURL` is required by the endpoint schema but unused for link
 *  construction. */
export async function resendVerificationEmail(
  config: AuthClientConfig,
  email: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${config.serverUrl}/api/auth/send-verification-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "kaipu-record://app" },
      body: JSON.stringify({ email, callbackURL: "/auth/email-verified" }),
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok;
  } catch {
    return false;
  }
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
