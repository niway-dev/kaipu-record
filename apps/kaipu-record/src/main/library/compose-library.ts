import type { LocalRecording } from "@shared/types/library-storage";
import type {
  Availability,
  CloudCatalogEntry,
  Comparison,
  EditingState,
  LibraryItem,
} from "@shared/types/library-item";
import type { EditSessionState } from "./edit-project-probe";

export interface ComposeInput {
  local: LocalRecording[] | null;
  catalog: CloudCatalogEntry[] | null;
  editing: Record<string, EditingState>;
  /** Per local id, from `probeEditSession`. */
  editSession: Record<string, EditSessionState>;
}

export interface ComposeResult {
  items: LibraryItem[];
  /** The catalog with `lastSeenLocalId` refreshed; persist it. Empty when there is no catalog. */
  catalogUpdates: CloudCatalogEntry[];
}

function compare(local: LocalRecording, cloud: CloudCatalogEntry): Comparison {
  if (local.contentSha256 === null) return "pending";
  return local.contentSha256 === cloud.contentSha256 && local.sizeBytes === cloud.sizeBytes
    ? "same"
    : "local-changes";
}

/**
 * Pure merge of the local vault and the account's cloud catalog. The join key is
 * `assetId` and nothing else — never the filename, never the title.
 */
export function composeLibrary(input: ComposeInput): ComposeResult {
  const vaultReadable = input.local !== null;
  const localByAsset = new Map<string, LocalRecording>();
  for (const rec of input.local ?? []) localByAsset.set(rec.assetId, rec);

  const items: LibraryItem[] = [];
  const catalogUpdates: CloudCatalogEntry[] = [];
  const merged = new Set<string>();

  for (const entry of input.catalog ?? []) {
    const local = localByAsset.get(entry.assetId) ?? null;
    let availability: Availability;
    if (local) availability = "local-and-cloud";
    else if (!vaultReadable && entry.lastSeenLocalId) availability = "local-unavailable";
    else availability = "cloud";
    merged.add(entry.assetId);
    catalogUpdates.push({
      ...entry,
      // A readable vault where the file is now gone clears the association (the item
      // reads as "cloud", not stuck pointing at a local id that no longer exists); an
      // *unreadable* vault (disconnected drive) must NOT clear it — that's what lets
      // the item read as "local unavailable" instead of losing the association forever.
      lastSeenLocalId: local ? local.id : vaultReadable ? null : entry.lastSeenLocalId,
    });
    items.push({
      assetId: entry.assetId,
      kind: local?.kind ?? entry.kind,
      title: local?.title ?? entry.title,
      createdAt: local?.createdAt ?? entry.createdAt,
      // `||` on purpose: a local 0 means "unknown (no sidecar metadata)", so the
      // cloud value is the better answer.
      durationSeconds: local?.durationSeconds || entry.durationSeconds,
      derivedFromAssetId: local?.derivedFromAssetId ?? entry.derivedFromAssetId,
      editSavedAt: local ? (input.editSession[local.id]?.savedAt ?? null) : null,
      editExportedSavedAt: local ? (input.editSession[local.id]?.exportedSavedAt ?? null) : null,
      local,
      cloud: entry,
      availability,
      transfer: { state: "idle" },
      comparison: local ? compare(local, entry) : "pending",
      editing: local ? (input.editing[local.id] ?? "project-available") : "needs-source",
      sharing: "private",
    });
  }

  for (const rec of input.local ?? []) {
    if (merged.has(rec.assetId)) continue;
    items.push({
      assetId: rec.assetId,
      kind: rec.kind,
      title: rec.title,
      createdAt: rec.createdAt,
      durationSeconds: rec.durationSeconds,
      derivedFromAssetId: rec.derivedFromAssetId,
      editSavedAt: input.editSession[rec.id]?.savedAt ?? null,
      editExportedSavedAt: input.editSession[rec.id]?.exportedSavedAt ?? null,
      local: rec,
      cloud: null,
      availability: "local",
      transfer: { state: "idle" },
      comparison: "pending",
      editing: input.editing[rec.id] ?? "project-available",
      sharing: "private",
    });
  }

  items.sort((a, b) => b.createdAt - a.createdAt || (a.assetId < b.assetId ? -1 : 1));
  return { items, catalogUpdates };
}
