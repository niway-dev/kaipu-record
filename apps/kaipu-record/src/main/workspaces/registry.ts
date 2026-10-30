import { mkdir, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { isTagColor, TAG_COLORS, type TagColor } from "@kaipu/domain/constants";
import type { WorkspaceUnavailableReason } from "@shared/types/workspaces";
import { atomicWriteFile, withLock } from "../library/atomic-write";
import {
  DEFAULT_WORKSPACE_NAME,
  deriveInitials,
  isDirectory,
  isSafeWorkspaceId,
  isValidInitials,
  nextWorkspaceColor,
  normalizeWorkspaceName,
  readIdentity,
  writeIdentity,
  type WorkspaceIdentity,
} from "./identity";

/**
 * The workspace registry (ADR 0032): which folders this Mac knows and which one is active,
 * stored as the `workspaces` key of `userData/preferences.json`, next to the existing
 * `vaultDirectory`. Pure Node (no Electron), so it is tested against temp folders.
 *
 * Downgrade contract: `vaultDirectory` always mirrors the active path (absent when that is
 * the default folder), so an older version, which reads only that key, opens the active
 * workspace. An older version spreads the file it read on every write, so it keeps the
 * `workspaces` key; when it changed the folder, the next launch here adopts that folder.
 */

/** One registered workspace. `name`, `color` and `initials` cache the folder's identity. */
export interface WorkspaceEntry {
  id: string;
  path: string;
  name: string;
  color: TagColor;
  initials?: string;
  addedAt: number;
  /** The folder was unreachable or read-only when registered: identity.json is still to write. */
  pendingInit?: true;
}

export interface WorkspacesKey {
  version: 1;
  activeId: string;
  /** Owns the cloud entries that carry no workspace id (spec decision 3). Explicit, never "the first entry". */
  legacyCloudOwnerId: string;
  /** Set once the one-time "New: workspaces" hint is dismissed. */
  hintDismissedAt?: number;
  entries: WorkspaceEntry[];
}

type StoredPreferences = Record<string, unknown> & {
  vaultDirectory?: string;
  workspaces?: unknown;
};

export type PreferencesRead =
  | { kind: "missing" }
  | { kind: "ok"; preferences: StoredPreferences }
  | { kind: "corrupt" };

/**
 * Read preferences.json strictly. Unlike the old reader, a file that does not parse is
 * reported, never read as `{}`: writing after that would erase a custom folder for good.
 */
export async function readPreferences(file: string): Promise<PreferencesRead> {
  let raw: string;
  try {
    raw = await readFile(file, "utf-8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { kind: "missing" }
      : { kind: "corrupt" };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { kind: "corrupt" };
    return { kind: "ok", preferences: parsed as StoredPreferences };
  } catch {
    return { kind: "corrupt" };
  }
}

function parseEntry(value: unknown): WorkspaceEntry | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const name = normalizeWorkspaceName(record["name"]);
  if (!isSafeWorkspaceId(record["id"]) || typeof record["path"] !== "string" || !name) return null;
  return {
    id: record["id"],
    path: record["path"],
    name,
    color: isTagColor(record["color"]) ? record["color"] : TAG_COLORS[0],
    ...(isValidInitials(record["initials"]) ? { initials: record["initials"] } : {}),
    addedAt: typeof record["addedAt"] === "number" ? record["addedAt"] : 0,
    ...(record["pendingInit"] === true ? { pendingInit: true as const } : {}),
  };
}

/** The `workspaces` key, or null when it is not one this version can use. */
export function parseWorkspacesKey(value: unknown): WorkspacesKey | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record["version"] !== 1 || !Array.isArray(record["entries"])) return null;
  const entries = record["entries"].map(parseEntry);
  if (entries.length === 0 || entries.some((e) => e === null)) return null;
  const valid = entries as WorkspaceEntry[];
  const ids = new Set(valid.map((e) => e.id));
  if (ids.size !== valid.length) return null;
  const activeId = typeof record["activeId"] === "string" ? record["activeId"] : valid[0]!.id;
  const owner = record["legacyCloudOwnerId"];
  return {
    version: 1,
    activeId,
    legacyCloudOwnerId: typeof owner === "string" ? owner : activeId,
    ...(typeof record["hintDismissedAt"] === "number"
      ? { hintDismissedAt: record["hintDismissedAt"] }
      : {}),
    entries: valid,
  };
}

export interface RegistryEnv {
  preferencesFile: string;
  /** The platform default library folder (Videos/Kaipu Record). */
  defaultDirectory: string;
  now?: () => number;
  newId: () => string;
  /** Called after every preferences write, so the cached `vaultDirectory()` re-reads. */
  onPreferencesWritten?: () => void;
}

export type Availability =
  | { state: "available" }
  | { state: "unavailable"; reason: WorkspaceUnavailableReason };

export type AddOutcome =
  | { ok: true; entry: WorkspaceEntry; created: boolean }
  | { ok: false; reason: "not-writable" | "unreadable" | "read-only" };

export type RemoveOutcome =
  | { ok: true }
  | { ok: false; reason: "active" | "last" | "unknown" | "read-only" };

const LOCK = "workspaces:registry";
/** Serializes `update`, so one update's rollback never discards another's change. */
const UPDATE_LOCK = "workspaces:registry:update";

function samePath(a: string, b: string): boolean {
  return resolve(a) === resolve(b);
}

function entryFromIdentity(
  identity: WorkspaceIdentity,
  path: string,
  addedAt: number,
): WorkspaceEntry {
  return {
    id: identity.id,
    path,
    name: identity.name,
    color: identity.color,
    ...(identity.initials ? { initials: identity.initials } : {}),
    addedAt,
  };
}

export class WorkspaceRegistry {
  private constructor(
    private readonly env: RegistryEnv,
    private key: WorkspacesKey,
    /** preferences.json did not parse (or the first registration could not be written): write nothing. */
    readonly readOnly: boolean,
  ) {}

  private static now(env: RegistryEnv): number {
    return env.now?.() ?? Date.now();
  }

  /**
   * Load the registry, migrating a pre-workspaces install on its first launch and adopting a
   * folder an older version switched to. Additive only: it writes
   * `.kaipu/workspace/identity.json` and the `workspaces` key, and nothing else.
   */
  static async open(env: RegistryEnv): Promise<WorkspaceRegistry> {
    const read = await readPreferences(env.preferencesFile);
    if (read.kind === "corrupt") return WorkspaceRegistry.readOnlyFallback(env);
    const preferences = read.kind === "ok" ? read.preferences : {};
    const vaultPath =
      typeof preferences.vaultDirectory === "string" && preferences.vaultDirectory
        ? preferences.vaultDirectory
        : env.defaultDirectory;

    if (preferences.workspaces === undefined) {
      return WorkspaceRegistry.migrate(env, vaultPath, vaultPath === env.defaultDirectory);
    }
    const key = parseWorkspacesKey(preferences.workspaces);
    // A key this version cannot read (hand edit, a future version): leave it alone.
    if (!key) return WorkspaceRegistry.readOnlyFallback(env, vaultPath);
    const registry = new WorkspaceRegistry(env, key, false);
    await registry.reconcile(vaultPath);
    return registry;
  }

  /** The library as today, under an in-memory id; nothing is written until the next launch. */
  private static async readOnlyFallback(
    env: RegistryEnv,
    path: string = env.defaultDirectory,
  ): Promise<WorkspaceRegistry> {
    const identity = await readIdentity(path);
    const entry: WorkspaceEntry =
      identity.kind === "ok"
        ? entryFromIdentity(identity.identity, path, 0)
        : {
            id: env.newId(),
            path,
            name: DEFAULT_WORKSPACE_NAME,
            color: TAG_COLORS[0],
            initials: deriveInitials(DEFAULT_WORKSPACE_NAME),
            addedAt: 0,
          };
    return new WorkspaceRegistry(
      env,
      { version: 1, activeId: entry.id, legacyCloudOwnerId: entry.id, entries: [entry] },
      true,
    );
  }

  /** First launch after the upgrade: the current library becomes "Default workspace". */
  private static async migrate(
    env: RegistryEnv,
    path: string,
    isDefault: boolean,
  ): Promise<WorkspaceRegistry> {
    const now = WorkspaceRegistry.now(env);
    // Today's behaviour: the default folder is created on first use.
    if (isDefault) await mkdir(path, { recursive: true }).catch(() => {});
    const existing = await readIdentity(path);
    let entry: WorkspaceEntry;
    if (existing.kind === "ok") {
      // A rerun after a crash between the two writes: reuse the id, never mint a second.
      entry = entryFromIdentity(existing.identity, path, now);
    } else {
      const identity: WorkspaceIdentity = {
        version: 1,
        id: env.newId(),
        name: DEFAULT_WORKSPACE_NAME,
        color: TAG_COLORS[0],
        initials: deriveInitials(DEFAULT_WORKSPACE_NAME),
        createdAt: now,
      };
      entry = entryFromIdentity(identity, path, now);
      if (existing.kind === "absent") {
        try {
          await writeIdentity(path, identity);
        } catch {
          // Unplugged or read-only: registered anyway, initialized on the first reach.
          entry.pendingInit = true;
        }
      } else {
        // An identity.json we cannot read is never overwritten.
        entry.pendingInit = true;
      }
    }
    const key: WorkspacesKey = {
      version: 1,
      activeId: entry.id,
      legacyCloudOwnerId: entry.id,
      entries: [entry],
    };
    const registry = new WorkspaceRegistry(env, key, false);
    try {
      await registry.persist({ mirrorVault: false });
    } catch {
      // The registry could not be stored: run as today and retry on the next launch.
      return new WorkspaceRegistry(env, key, true);
    }
    return registry;
  }

  /**
   * `vaultDirectory` no longer matches the active entry: an older version changed the folder
   * while downgraded. Adopt that folder (by its identity id, else its path, else as a new
   * entry) and make it active, so the change is not ignored after the re-upgrade.
   */
  private async reconcile(vaultPath: string): Promise<void> {
    const active = this.key.entries.find((e) => e.id === this.key.activeId);
    if (active && samePath(active.path, vaultPath)) return;
    const identity = await readIdentity(vaultPath);
    let target: WorkspaceEntry | undefined;
    if (identity.kind === "ok") {
      target = this.key.entries.find((e) => e.id === identity.identity.id);
      if (target) target.path = vaultPath;
    }
    target ??= this.key.entries.find((e) => samePath(e.path, vaultPath));
    if (!target) {
      target = await this.register(vaultPath, identity);
      if (!target) return; // the folder is gone too: keep the registry's own active entry
    }
    this.key.activeId = target.id;
    try {
      await this.persist({ mirrorVault: true });
    } catch (error) {
      // The app still opens that folder (vaultDirectory already names it); the registry
      // catches up on the next write or launch.
      console.error("workspaces: could not store the adopted folder", error);
    }
  }

  /** Make an entry for a folder the registry does not know. Null when it cannot be reached. */
  private async register(
    path: string,
    identity: Awaited<ReturnType<typeof readIdentity>>,
  ): Promise<WorkspaceEntry | undefined> {
    const now = WorkspaceRegistry.now(this.env);
    if (identity.kind === "ok") {
      const entry = entryFromIdentity(identity.identity, path, now);
      this.key.entries.push(entry);
      return entry;
    }
    if (identity.kind === "unreadable" || !(await isDirectory(path))) return undefined;
    const name = normalizeWorkspaceName(basename(path)) ?? DEFAULT_WORKSPACE_NAME;
    const minted: WorkspaceIdentity = {
      version: 1,
      id: this.env.newId(),
      name,
      color: nextWorkspaceColor(this.key.entries.map((e) => e.color)),
      initials: deriveInitials(name),
      createdAt: now,
    };
    const entry = entryFromIdentity(minted, path, now);
    try {
      await writeIdentity(path, minted);
    } catch {
      entry.pendingInit = true;
    }
    this.key.entries.push(entry);
    return entry;
  }

  get state(): Readonly<WorkspacesKey> {
    return this.key;
  }

  entries(): readonly WorkspaceEntry[] {
    return this.key.entries;
  }

  get(id: string): WorkspaceEntry | undefined {
    return this.key.entries.find((e) => e.id === id);
  }

  active(): WorkspaceEntry {
    return this.get(this.key.activeId) ?? this.key.entries[0]!;
  }

  isDefaultPath(path: string): boolean {
    return samePath(path, this.env.defaultDirectory);
  }

  /**
   * Is the folder there, with this entry's identity? Never creates the root. A pending entry
   * whose folder is back gets its identity written now, or adopts the one it finds there.
   * Resolves the entry's id afterwards (it changes only when a pending entry adopts one).
   */
  async availability(id: string): Promise<{ availability: Availability; id: string }> {
    const entry = this.get(id);
    if (!entry) return { availability: { state: "unavailable", reason: "missing" }, id };
    if (!(await isDirectory(entry.path))) {
      return { availability: { state: "unavailable", reason: "missing" }, id };
    }
    const identity = await readIdentity(entry.path);
    if (identity.kind === "unreadable") {
      return { availability: { state: "unavailable", reason: "unreadable" }, id };
    }
    if (identity.kind === "ok") {
      if (identity.identity.id === entry.id) {
        // The folder's file wins: the entry only caches it (renamed on another Mac).
        const fresh = entryFromIdentity(identity.identity, entry.path, entry.addedAt);
        const stale =
          entry.pendingInit ||
          fresh.name !== entry.name ||
          fresh.color !== entry.color ||
          fresh.initials !== entry.initials;
        if (stale) {
          await this.refresh(() => {
            delete entry.pendingInit;
            delete entry.initials;
            Object.assign(entry, fresh);
          });
        }
        return { availability: { state: "available" }, id };
      }
      if (entry.pendingInit && !this.get(identity.identity.id)) {
        // Registered while unreachable, and an identity arrived meanwhile: that id wins.
        const adopted = identity.identity.id;
        await this.refresh((key) => {
          if (key.activeId === entry.id) key.activeId = adopted;
          if (key.legacyCloudOwnerId === entry.id) key.legacyCloudOwnerId = adopted;
          Object.assign(entry, entryFromIdentity(identity.identity, entry.path, entry.addedAt));
          delete entry.pendingInit;
        });
        return { availability: { state: "available" }, id: adopted };
      }
      return { availability: { state: "unavailable", reason: "different" }, id };
    }
    // No identity file (pending, or deleted by hand): Kaipu's own file, rewritten under the
    // registered id. A read-only folder stays usable, as before workspaces.
    if (!this.readOnly) {
      try {
        await writeIdentity(entry.path, {
          version: 1,
          id: entry.id,
          name: entry.name,
          color: entry.color,
          ...(entry.initials ? { initials: entry.initials } : {}),
          createdAt: entry.addedAt,
        });
        if (entry.pendingInit) await this.refresh(() => void delete entry.pendingInit);
      } catch {
        // stays pending
      }
    }
    return { availability: { state: "available" }, id };
  }

  /**
   * Add an existing folder. Creates only Kaipu's own files (`.kaipu/workspace/identity.json`)
   * and never touches the user's content. A folder with an identity is adopted: an id this
   * Mac knows at an unreachable path is a relocation, at a reachable one it is a copy, which
   * gets a new id. Does not switch.
   */
  async add(path: string): Promise<AddOutcome> {
    if (this.readOnly) return { ok: false, reason: "read-only" };
    const known = this.key.entries.find((e) => samePath(e.path, path));
    if (known) return { ok: true, entry: known, created: false };
    if (!(await isDirectory(path))) return { ok: false, reason: "not-writable" };
    const now = WorkspaceRegistry.now(this.env);
    const identity = await readIdentity(path);
    if (identity.kind === "unreadable") return { ok: false, reason: "unreadable" };

    if (identity.kind === "ok") {
      const registered = this.get(identity.identity.id);
      if (registered) {
        const { availability } = await this.availability(registered.id);
        if (availability.state === "unavailable") {
          // The same folder at a new path (a renamed drive, a moved folder): relocate.
          await this.update(() => {
            Object.assign(
              registered,
              entryFromIdentity(identity.identity, path, registered.addedAt),
            );
            delete registered.pendingInit;
          });
          return { ok: true, entry: registered, created: false };
        }
        // A copy of a registered folder: same name, new id, so the two never share one.
        const copy: WorkspaceIdentity = {
          ...identity.identity,
          id: this.env.newId(),
          createdAt: now,
        };
        try {
          await writeIdentity(path, copy);
        } catch {
          return { ok: false, reason: "not-writable" };
        }
        const entry = entryFromIdentity(copy, path, now);
        await this.update((key) => void key.entries.push(entry));
        return { ok: true, entry, created: true };
      }
      const entry = entryFromIdentity(identity.identity, path, now);
      await this.update((key) => void key.entries.push(entry));
      return { ok: true, entry, created: true };
    }

    const name = normalizeWorkspaceName(basename(path)) ?? DEFAULT_WORKSPACE_NAME;
    const minted: WorkspaceIdentity = {
      version: 1,
      id: this.env.newId(),
      name,
      color: nextWorkspaceColor(this.key.entries.map((e) => e.color)),
      initials: deriveInitials(name),
      createdAt: now,
    };
    try {
      await writeIdentity(path, minted);
    } catch {
      return { ok: false, reason: "not-writable" };
    }
    const entry = entryFromIdentity(minted, path, now);
    await this.update((key) => void key.entries.push(entry));
    return { ok: true, entry, created: true };
  }

  /** Remove from list: unregister only. Nothing on disk changes, so re-adding restores it. */
  async remove(id: string): Promise<RemoveOutcome> {
    if (this.readOnly) return { ok: false, reason: "read-only" };
    if (!this.get(id)) return { ok: false, reason: "unknown" };
    if (id === this.key.activeId) return { ok: false, reason: "active" };
    // Defence in depth: the active id always names an entry, so a lone entry is the active
    // one and was refused above. This guard only matters if that invariant ever breaks.
    if (this.key.entries.length <= 1) return { ok: false, reason: "last" };
    await this.update((key) => {
      key.entries = key.entries.filter((e) => e.id !== id);
    });
    return { ok: true };
  }

  /** Persist the active id, and mirror its path into `vaultDirectory` for older versions. */
  async setActive(id: string): Promise<void> {
    if (this.readOnly) throw new Error("workspaces: preferences are read-only this session");
    if (!this.get(id)) throw new Error(`workspaces: unknown workspace ${id}`);
    await this.update(
      (key) => {
        key.activeId = id;
      },
      { mirrorVault: true },
    );
  }

  async dismissHint(): Promise<void> {
    if (this.readOnly || this.key.hintDismissedAt !== undefined) return;
    await this.update((key) => {
      key.hintDismissedAt = WorkspaceRegistry.now(this.env);
    });
  }

  /** An update a probe learned (a cached name, a finished init): never fails the probe. */
  private async refresh(mutate: (key: WorkspacesKey) => void): Promise<void> {
    try {
      await this.update(mutate);
    } catch (error) {
      console.error("workspaces: could not store a registry update", error);
    }
  }

  /**
   * Apply a change and write it. A failed write puts the registry back as it was, so a
   * rejected add or remove leaves nothing behind in the list.
   */
  private update(
    mutate: (key: WorkspacesKey) => void,
    options: { mirrorVault: boolean } = { mirrorVault: false },
  ): Promise<void> {
    return withLock(UPDATE_LOCK, async () => {
      const before = structuredClone(this.key);
      mutate(this.key);
      if (this.readOnly) return;
      try {
        await this.persist(options);
      } catch (error) {
        this.key = before;
        throw error;
      }
    });
  }

  /**
   * Write the `workspaces` key (and, on a switch, the mirrored `vaultDirectory`) into the
   * file as it is on disk now, keeping every other key. Atomic: temp, fsync, rename.
   */
  private persist(options: { mirrorVault: boolean }): Promise<void> {
    return withLock(LOCK, async () => {
      const read = await readPreferences(this.env.preferencesFile);
      if (read.kind === "corrupt") throw new Error("workspaces: preferences.json does not parse");
      const preferences: StoredPreferences = read.kind === "ok" ? { ...read.preferences } : {};
      preferences.workspaces = this.key;
      if (options.mirrorVault) {
        const active = this.active();
        if (this.isDefaultPath(active.path)) delete preferences.vaultDirectory;
        else preferences.vaultDirectory = active.path;
      }
      await atomicWriteFile(this.env.preferencesFile, JSON.stringify(preferences, null, 2));
      this.env.onPreferencesWritten?.();
    });
  }
}
