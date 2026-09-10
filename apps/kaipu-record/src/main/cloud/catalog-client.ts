import type { CloudCatalogEntry } from "@shared/types/library-item";

export interface CloudClientConfig {
  serverUrl: string;
}

export type CatalogError = { kind: "unauthorized" };

interface WireAsset {
  assetId: string;
  kind: "recording" | "screenshot";
  title: string;
  currentRevisionId: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  contentSha256: string | null;
  durationSeconds: number;
  hasThumbnail: boolean;
  derivedFromAssetId: string | null;
  autoUploadExcluded: boolean;
  createdAt: string;
  updatedAt: string;
}

const PAGE = 100;

/**
 * The account's ready cloud assets, all pages. Metadata only — no bytes move, so
 * calling this in "Local only" mode is allowed by the product spec. Rejects on
 * every failure: an empty array means "the account has nothing in cloud", never
 * "we could not ask".
 */
export async function fetchCloudCatalog(
  config: CloudClientConfig,
  token: string,
  now: number = Date.now(),
): Promise<CloudCatalogEntry[]> {
  const entries: CloudCatalogEntry[] = [];
  let cursor: string | null = null;
  do {
    const url = new URL(`${config.serverUrl}/api/v1/assets`);
    url.searchParams.set("limit", String(PAGE));
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401) throw { kind: "unauthorized" } satisfies CatalogError;
    if (!res.ok) throw new Error(`assets list failed: ${res.status}`);
    const body = (await res.json()) as {
      data: { items: WireAsset[]; nextCursor: string | null } | null;
      error: { message: string } | null;
    };
    if (!body.data) throw new Error(body.error?.message ?? "assets list returned no data");
    for (const a of body.data.items) {
      if (
        !a.currentRevisionId ||
        a.sizeBytes === null ||
        a.contentSha256 === null ||
        a.contentType === null
      )
        continue;
      entries.push({
        assetId: a.assetId,
        kind: a.kind,
        title: a.title,
        revisionId: a.currentRevisionId,
        contentType: a.contentType,
        sizeBytes: a.sizeBytes,
        contentSha256: a.contentSha256,
        durationSeconds: a.durationSeconds,
        hasThumbnail: a.hasThumbnail,
        derivedFromAssetId: a.derivedFromAssetId,
        autoUploadExcluded: a.autoUploadExcluded,
        createdAt: Date.parse(a.createdAt),
        lastVerifiedAt: now,
        lastSeenLocalId: null,
      });
    }
    cursor = body.data.nextCursor;
  } while (cursor);
  return entries;
}
