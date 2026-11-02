import type { CloudClientConfig } from "./catalog-client";

/**
 * `POST /api/v1/assets/upload-intents`, the first step of a desktop upload. The upload flow
 * itself (NIW2-214) has not shipped; this is its request, so the one thing workspaces need from
 * it is fixed in the type: **every upload names the workspace the item lives in** (ADR 0032).
 * `workspaceId` is required here, unlike on the server, which accepts its absence from an
 * older desktop.
 */
export interface UploadIntentRequest {
  assetId: string;
  intentKey: string;
  kind: "recording" | "screenshot";
  title: string;
  contentType: string;
  sizeBytes: number;
  contentSha256: string;
  durationSeconds: number;
  derivedFromAssetId: string | null;
  thumbnail: { sizeBytes: number; contentSha256: string } | null;
  /** The workspace the item is in when it is uploaded: the one it was captured or moved into. */
  workspaceId: string;
}

export type UploadIntentError = { kind: "unauthorized" } | { kind: "rejected"; status: number };

/** Resolves the server's `data` (the intent and its tickets); rejects on any failure. */
export async function requestUploadIntent(
  config: CloudClientConfig,
  token: string,
  request: UploadIntentRequest,
): Promise<unknown> {
  const res = await fetch(`${config.serverUrl}/api/v1/assets/upload-intents`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 401) throw { kind: "unauthorized" } satisfies UploadIntentError;
  if (!res.ok) throw { kind: "rejected", status: res.status } satisfies UploadIntentError;
  const body = (await res.json()) as { data: unknown };
  return body.data;
}
