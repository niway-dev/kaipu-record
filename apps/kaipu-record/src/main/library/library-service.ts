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
  probeTranscribedAt,
  probeWebcam,
  type EditSessionState,
} from "./edit-project-probe";
import type { LibraryVault } from "./library-vault";
import { canRemoveLocalCopy } from "./remove-local-copy-policy";
import type {
  ReconcileFixResult,
  ReconcileProgress,
  ReconcileScanResult,
} from "@shared/types/library-reconcile";
import {
  MaintenanceAlreadyRunningError,
  MaintenanceCancelledError,
  VaultBusyError,
  vaultActivity,
  type VaultActivity,
} from "./vault-activity";
import { fixVault, publicFinding, scanVault } from "./vault-reconcile";

export interface LibraryServiceDeps {
  vault: () => LibraryVault;
  vaultDir: () => string;
  cache: CatalogCache;
  account: () => { userId: string; token: string } | null;
  fetchCatalog: (token: string) => Promise<CloudCatalogEntry[]>;
  /**
   * The active workspace owns the account's cloud entries that carry no workspace id (spec
   * decision 3; none carries one until desktop upload ships). Any other workspace lists only
   * the cloud copies of its own local items, and never rewrites the account's cache.
   * Absent: owns them (one workspace, or a caller that predates workspaces).
   */
  ownsLegacyCloud?: () => boolean;
  /**
   * Shows a file in Finder. "Remove local copy" in a synced workspace calls it instead of
   * deleting (spec decision 4).
   */
  reveal?: (path: string) => void;
  now?: () => number;
  /** Maintenance mode; the process' instance unless a test injects one. */
  activity?: VaultActivity;
}

export interface ReconcileFixOptions {
  signal?: AbortSignal;
  onProgress?: (progress: ReconcileProgress) => void;
  /** The item is open in the video editor: its file keeps its name (C2). */
  isEditing?: (id: string, assetId: string) => boolean;
  /** Paths the user unticked: left as they are this run. */
  skip?: ReadonlySet<string>;
}

/** A cloud refresh that succeeded less than this long ago is skipped unless forced. */
export const CLOUD_REFRESH_MIN_INTERVAL_MS = 30_000;

/** True when the two catalogs differ in anything but bookkeeping (when verified, last local id). */
function catalogDiffers(a: CloudCatalogEntry[], b: CloudCatalogEntry[]): boolean {
  if (a.length !== b.length) return true;
  const key = (entry: CloudCatalogEntry): string => {
    const { lastVerifiedAt: _verified, lastSeenLocalId: _seen, ...rest } = entry;
    return JSON.stringify(Object.entries(rest).sort(([x], [y]) => (x < y ? -1 : 1)));
  };
  const before = new Map(a.map((entry) => [entry.assetId, key(entry)] as const));
  return b.some((entry) => before.get(entry.assetId) !== key(entry));
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Everything the library IPC needs, with no direct Electron import (transitively via
 *  edit-project-probe → video-edit-session) — testable against temp dirs. */
export class LibraryService {
  private inflightRefresh: Promise<CatalogRefreshResult> | null = null;
  /** The last successful cloud fetch, for the per-user throttle. */
  private lastRefresh: { userId: string; at: number } | null = null;
  private readonly now: () => number;

  private readonly activity: VaultActivity;

  constructor(private readonly deps: LibraryServiceDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.activity = deps.activity ?? vaultActivity;
  }

  /** Identities of the cached cloud catalog; "unknown" when signed out or never fetched. */
  private async cloudIds(): Promise<ReadonlySet<string> | "unknown"> {
    const account = this.deps.account();
    if (!account) return "unknown";
    const catalog = await this.deps.cache.read(account.userId);
    return catalog ? new Set(catalog.map((entry) => entry.assetId)) : "unknown";
  }

  /** The recording or export using the vault right now, if any. */
  private longActivity(): "recording" | "export" | null {
    const active = this.activity.active();
    return active.includes("export") ? "export" : active.includes("recording") ? "recording" : null;
  }

  /**
   * "Check and fix files", read-only (NIW2-561). Never during a recording, an export or a
   * fix; an unreadable folder is an error, never "no findings" (F7).
   */
  async reconcileScan(): Promise<ReconcileScanResult> {
    if (this.activity.inMaintenance) return { status: "maintenance" };
    const busy = this.longActivity();
    if (busy) return { status: "busy", activity: busy };
    try {
      const { findings } = await this.activity.run("library", async () =>
        scanVault({
          directory: this.deps.vaultDir(),
          vault: this.deps.vault(),
          cloud: await this.cloudIds(),
        }),
      );
      const listed = findings
        .filter((f) => !f.fixable)
        .map((f) => `${f.kind}:${f.path}`)
        .sort();
      return {
        status: "ok",
        findings: findings.map(publicFinding),
        fixableCount: findings.filter((f) => f.fixable).length,
        listedSignature: listed.join("\n"),
      };
    } catch (error) {
      return { status: "error", message: errorMessage(error) };
    }
  }

  /** "Fix all", in maintenance mode: refused during a recording or export, cancellable while it waits. */
  async reconcileFix(options: ReconcileFixOptions): Promise<ReconcileFixResult> {
    let exit: () => void;
    try {
      exit = await this.activity.enterMaintenance({
        signal: options.signal,
        onWaiting: (kinds) => options.onProgress?.({ phase: "waiting", waitingFor: kinds }),
      });
    } catch (error) {
      if (error instanceof VaultBusyError) return { status: "busy", activity: error.activity };
      if (error instanceof MaintenanceCancelledError) return { status: "cancelled" };
      if (error instanceof MaintenanceAlreadyRunningError) return { status: "already-running" };
      return { status: "error", message: errorMessage(error) };
    }
    try {
      const report = await fixVault(this.deps.vaultDir(), {
        vault: this.deps.vault(),
        cloud: await this.cloudIds(),
        isEditing: options.isEditing,
        skip: options.skip,
        now: this.now,
        onProgress: (done, total) => options.onProgress?.({ phase: "fixing", done, total }),
      });
      return { status: "done", report };
    } catch (error) {
      console.error("[reconcile] Fix all failed", error);
      return { status: "error", message: errorMessage(error) };
    } finally {
      exit();
    }
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
    const cached = account ? await this.deps.cache.read(account.userId) : null;
    const owns = this.deps.ownsLegacyCloud?.() ?? true;
    const localAssets = new Set((local ?? []).map((rec) => rec.assetId));
    // Hiding is a view: the cache keeps every entry (it is rewritten only by the owner).
    const catalog = owns || !cached ? cached : cached.filter((e) => localAssets.has(e.assetId));

    const editing: Record<string, EditingState> = {};
    const editSession: Record<string, EditSessionState> = {};
    const transcribed: Record<string, number> = {};
    // The edit meta is read through the vault: bounded, and never a download, in a synced one.
    const vault = this.deps.vault();
    const readMeta = (path: string) => vault.readTextBounded(path);
    for (const rec of local ?? []) {
      editing[rec.id] = await probeEditing(this.deps.vaultDir(), rec, readMeta);
      editSession[rec.id] = await probeEditSession(this.deps.vaultDir(), rec.id, readMeta);
      const transcribedAt = await probeTranscribedAt(this.deps.vaultDir(), rec.id);
      if (transcribedAt !== null) transcribed[rec.id] = transcribedAt;
    }

    const { items, catalogUpdates } = composeLibrary({
      local,
      catalog,
      editing,
      editSession,
      transcribed,
    });
    if (
      owns &&
      account &&
      catalog &&
      local &&
      JSON.stringify(catalogUpdates) !== JSON.stringify(catalog)
    ) {
      // Best-effort: remembering which cloud items were also local is what lets an
      // unplugged drive read as "local unavailable" instead of "cloud only". Skipped
      // when nothing changed so a plain `list()` doesn't keep rewriting the cache file.
      await this.deps.cache.write(account.userId, catalogUpdates).catch(() => undefined);
    }
    const catalogVerifiedAt = account
      ? (cached ?? []).reduce((max, e) => Math.max(max, e.lastVerifiedAt), 0)
      : null;
    return { items, vaultError, catalogVerifiedAt };
  }

  /**
   * Re-confirm the cloud catalog. Never rejects: the cloud is optional, so any failure
   * (signed out, unauthorized, offline, a throwing account or cache) is a result the caller
   * can ignore, and the local list never depends on it.
   */
  refreshCatalog(opts: { force?: boolean } = {}): Promise<CatalogRefreshResult> {
    try {
      const account = this.deps.account();
      const last = this.lastRefresh;
      if (
        !opts.force &&
        account &&
        last &&
        last.userId === account.userId &&
        this.now() - last.at < CLOUD_REFRESH_MIN_INTERVAL_MS
      ) {
        // Nothing was fetched, so nothing changed since the last broadcast decision.
        return Promise.resolve({ ok: true, verifiedAt: last.at, changed: false });
      }
    } catch {
      return Promise.resolve({ ok: false, reason: "network" });
    }
    if (this.inflightRefresh) return this.inflightRefresh;
    this.inflightRefresh = this.doRefresh().finally(() => {
      this.inflightRefresh = null;
    });
    return this.inflightRefresh;
  }

  private async doRefresh(): Promise<CatalogRefreshResult> {
    try {
      const account = this.deps.account();
      if (!account) return { ok: false, reason: "signed-out" };
      const fresh = await this.deps.fetchCatalog(account.token);
      const previous = (await this.deps.cache.read(account.userId)) ?? [];
      const seen = new Map(previous.map((e) => [e.assetId, e.lastSeenLocalId] as const));
      const verifiedAt = this.now();
      const changed = catalogDiffers(previous, fresh);
      // Always written: keeps lastVerifiedAt fresh even when nothing changed.
      await this.deps.cache.write(
        account.userId,
        fresh.map((e) => ({
          ...e,
          lastVerifiedAt: verifiedAt,
          lastSeenLocalId: seen.get(e.assetId) ?? null,
        })),
      );
      this.lastRefresh = { userId: account.userId, at: verifiedAt };
      return { ok: true, verifiedAt, changed };
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
    // The cheap refusals first: an edit project or a webcam file refuses whatever the bytes
    // are, so the file is not hashed for them (a long recording takes seconds to hash).
    const editSession = cloud ? await hasEditSession(this.deps.vaultDir(), id) : false;
    const webcamTrack =
      cloud && !editSession
        ? // The sidecar is read through the vault: bounded, and never a download, in a synced one.
          (await probeWebcam(this.deps.vaultDir(), id, (path) => vault.readTextBounded(path))) ===
          "present"
        : false;
    // A file still being written cannot be proven identical to the cloud copy —
    // refuse, do not reject: the policy below turns a null hash into "hash-unknown".
    const hashed =
      cloud && !editSession && !webcamTrack
        ? await vault.ensureContentHash(id).catch(() => null)
        : null;
    const decision = canRemoveLocalCopy({
      local: {
        contentSha256: hashed?.contentSha256 ?? null,
        sizeBytes: hashed?.sizeBytes ?? rec.sizeBytes,
      },
      cloud: cloud ? { contentSha256: cloud.contentSha256, sizeBytes: cloud.sizeBytes } : null,
      hasEditSession: editSession,
      hasWebcamTrack: webcamTrack,
    });
    if (!decision.allowed) return { ok: false, reason: decision.reason };
    if (vault.synced) {
      // The upload check above passed, but the file lives in the provider's folder: deleting
      // it there deletes it in the cloud and on every device, and `localRemovedAt` would claim
      // a copy is gone that the provider still holds. Show it in Finder so the user frees the
      // space with the provider's own command (spec decision 4).
      this.deps.reveal?.(rec.filePath);
      return { ok: true, revealed: true };
    }
    await vault.removeLocalCopy(id);
    return { ok: true };
  }
}
