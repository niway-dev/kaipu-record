import type { StorageUsage } from "@shared/types/cloud-storage";
import type { CloudClientConfig } from "./catalog-client";

export type StorageUsageError = { kind: "unauthorized" } | { kind: "not-available" };

const FIELDS_NUMBER = [
  "capacityBytes",
  "usedBytes",
  "reservedBytes",
  "availableBytes",
  "pendingUploads",
] as const;
const FIELDS_BOOLEAN = ["uploadsEnabled", "cloudUploads"] as const;

function isStorageUsage(value: unknown): value is StorageUsage {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    FIELDS_NUMBER.every((f) => {
      const n = record[f];
      return typeof n === "number" && Number.isFinite(n) && n >= 0;
    }) && FIELDS_BOOLEAN.every((f) => typeof record[f] === "boolean")
  );
}

/**
 * The account's cloud capacity from `GET /api/v1/me/storage`. Rejects on every failure,
 * including a malformed body: the caller must never mistake "could not ask" for zeros.
 * Rejects with `{ kind: "unauthorized" }` on 401 so the UI can ask for a new sign-in, and
 * `{ kind: "not-available" }` on 404 — a server without the endpoint, which retrying won't fix.
 */
export async function fetchStorageUsage(
  config: CloudClientConfig,
  token: string,
): Promise<StorageUsage> {
  const res = await fetch(`${config.serverUrl}/api/v1/me/storage`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401) throw { kind: "unauthorized" } satisfies StorageUsageError;
  // A 404 is not a transient failure: this server does not offer cloud storage (yet).
  if (res.status === 404) throw { kind: "not-available" } satisfies StorageUsageError;
  if (!res.ok) throw new Error(`storage usage failed: ${res.status}`);
  const body = (await res.json()) as { data?: unknown; error?: { message?: string } | null };
  if (!isStorageUsage(body.data)) {
    throw new Error(body.error?.message ?? "storage usage returned an invalid body");
  }
  const { capacityBytes, usedBytes, reservedBytes, availableBytes, pendingUploads } = body.data;
  return {
    capacityBytes,
    usedBytes,
    reservedBytes,
    availableBytes,
    pendingUploads,
    uploadsEnabled: body.data.uploadsEnabled,
    cloudUploads: body.data.cloudUploads,
  };
}
