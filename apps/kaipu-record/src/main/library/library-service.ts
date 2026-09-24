import type { LocalRecording } from "@shared/types/library-storage";
import type {
  CatalogRefreshResult,
  CloudCatalogEntry,
  EditingState,
  LibraryListResult,
  RemoveLocalCopyResult,
} from "@shared/types/library-item";
import type { CatalogCache } from "../cloud/catalog-cache";
import { composeLibrary } from "./compose-library";
import {
  hasEditSession,
  probeEditing,
  probeEditSession,
  type EditSessionState,
} from "./edit-project-probe";
import type { LibraryVault } from "./library-vault";
import { canRemoveLocalCopy } from "./remove-local-copy-policy";

export interface LibraryServiceDeps {
  vault: () => LibraryVault;
  vaultDir: () => string;
  cache: CatalogCache;
  account: () => { userId: string; token: string } | null;
  fetchCatalog: (token: string) => Promise<CloudCatalogEntry[]>;
  now?: () => number;
}

/** Everything the library IPC needs, with no direct Electron import (transitively via
 *  edit-project-probe → video-edit-session) — testable against temp dirs. */
export class LibraryService {
  private inflightRefresh: Promise<CatalogRefreshResult> | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: LibraryServiceDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  async list(): Promise<LibraryListResult> {
    let local: LocalRecording[] | null = null;
    let vaultError: string | null = null;
    try {
      local = await this.deps.vault().list();
    } catch (err) {
      vaultError = err instanceof Error ? err.message : String(err);
    }
    const account = this.deps.account();
    const catalog = account ? await this.deps.cache.read(account.userId) : null;

    const editing: Record<string, EditingState> = {};
    const editSession: Record<string, EditSessionState> = {};
    for (const rec of local ?? []) {
      editing[rec.id] = await probeEditing(this.deps.vaultDir(), rec);
      editSession[rec.id] = await probeEditSession(this.deps.vaultDir(), rec.id);
    }

    const { items, catalogUpdates } = composeLibrary({ local, catalog, editing, editSession });
    if (account && catalog && local && JSON.stringify(catalogUpdates) !== JSON.stringify(catalog)) {
      // Best-effort: remembering which cloud items were also local is what lets an
      // unplugged drive read as "local unavailable" instead of "cloud only". Skipped
      // when nothing changed so a plain `list()` doesn't keep rewriting the cache file.
      await this.deps.cache.write(account.userId, catalogUpdates).catch(() => undefined);
    }
    const catalogVerifiedAt = account
      ? (catalog ?? []).reduce((max, e) => Math.max(max, e.lastVerifiedAt), 0)
      : null;
    return { items, vaultError, catalogVerifiedAt };
  }

  refreshCatalog(): Promise<CatalogRefreshResult> {
    if (this.inflightRefresh) return this.inflightRefresh;
    this.inflightRefresh = this.doRefresh().finally(() => {
      this.inflightRefresh = null;
    });
    return this.inflightRefresh;
  }

  private async doRefresh(): Promise<CatalogRefreshResult> {
    const account = this.deps.account();
    if (!account) return { ok: false, reason: "signed-out" };
    try {
      const fresh = await this.deps.fetchCatalog(account.token);
      const previous = (await this.deps.cache.read(account.userId)) ?? [];
      const seen = new Map(previous.map((e) => [e.assetId, e.lastSeenLocalId] as const));
      const verifiedAt = this.now();
      await this.deps.cache.write(
        account.userId,
        fresh.map((e) => ({
          ...e,
          lastVerifiedAt: verifiedAt,
          lastSeenLocalId: seen.get(e.assetId) ?? null,
        })),
      );
      return { ok: true, verifiedAt };
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "kind" in err &&
        (err as { kind: string }).kind === "unauthorized"
      ) {
        return { ok: false, reason: "unauthorized" };
      }
      return { ok: false, reason: "network" };
    }
  }

  async removeLocalCopy(id: string): Promise<RemoveLocalCopyResult> {
    const vault = this.deps.vault();
    const rec = await vault.describe(id);
    if (!rec) return { ok: false, reason: "not-found" };
    const account = this.deps.account();
    const catalog = account ? await this.deps.cache.read(account.userId) : null;
    const cloud = catalog?.find((e) => e.assetId === rec.assetId) ?? null;
    // A file still being written cannot be proven identical to the cloud copy —
    // refuse, do not reject: the policy below turns a null hash into "hash-unknown".
    const hashed = cloud ? await vault.ensureContentHash(id).catch(() => null) : null;
    const decision = canRemoveLocalCopy({
      local: {
        contentSha256: hashed?.contentSha256 ?? null,
        sizeBytes: hashed?.sizeBytes ?? rec.sizeBytes,
      },
      cloud: cloud ? { contentSha256: cloud.contentSha256, sizeBytes: cloud.sizeBytes } : null,
      hasEditSession: await hasEditSession(this.deps.vaultDir(), id),
    });
    if (!decision.allowed) return { ok: false, reason: decision.reason };
    await vault.removeLocalCopy(id);
    return { ok: true };
  }
}
