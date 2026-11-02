import type { CloudClientConfig } from "./catalog-client";

/**
 * `PUT /api/v1/assets/{assetId}/workspace` (ADR 0032): record which workspace a cloud asset
 * lives in, or clear it with null. Never throws; the outcome says what to do next:
 *
 * - `ok`: the server holds it now;
 * - `not-found`: the account has no such live asset (never uploaded, or its cloud copy was
 *   deleted). Retrying will not help;
 * - `unsupported`: a server that predates the endpoint (Hono's plain 404, or 405). The
 *   desktop may ship before the server: the assignment waits and is retried later;
 * - `unauthorized`: the session expired; retried after the next sign-in;
 * - `retry`: offline, a timeout or a server error.
 */
export type AssignOutcome = "ok" | "not-found" | "unsupported" | "unauthorized" | "retry";

export async function assignAssetWorkspace(
  config: CloudClientConfig,
  token: string,
  assetId: string,
  workspaceId: string | null,
): Promise<AssignOutcome> {
  let res: Response;
  try {
    res = await fetch(
      `${config.serverUrl}/api/v1/assets/${encodeURIComponent(assetId)}/workspace`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    return "retry";
  }
  if (res.ok) return "ok";
  if (res.status === 401) return "unauthorized";
  if (res.status === 405) return "unsupported";
  if (res.status === 404) {
    // The route answers a JSON error with code NOT_FOUND for a missing asset; a server without
    // the route answers Hono's plain-text 404.
    const body = (await res.json().catch(() => null)) as { code?: unknown } | null;
    return body?.code === "NOT_FOUND" ? "not-found" : "unsupported";
  }
  return "retry";
}
