import { mkdir, readdir, readFile, rmdir, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { isTagColor, TAG_COLORS, type TagColor } from "@kaipu/domain/constants";
import type {
  LocationCheck,
  WorkspaceCreateRefusal,
  WorkspaceEditRefusal,
  WorkspaceRelocateRefusal,
  WorkspaceUnavailableReason,
} from "@shared/types/workspaces";
import { newWorkspaceFolderName, validateWorkspaceName } from "@shared/workspace-name";
import { atomicWriteFile, withLock } from "../library/atomic-write";
import {
  DEFAULT_WORKSPACE_COLOR,
  DEFAULT_WORKSPACE_NAME,
  deriveInitials,
  isDirectory,
  isSafeWorkspaceId,
  isValidInitials,
  nextWorkspaceColor,
  normalizeWorkspaceName,
  readIdentity,
  removeIdentity,
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
  /**
   * The name or color here is newer than the folder's `identity.json` (edited while the folder
   * was not connected, or upgraded then): the registry wins and is written to the folder the
   * next time it is reached, instead of the folder's older file overwriting it.
   */
  pendingIdentity?: true;
  /**
   * The one-time brand-color upgrade is cached here but not yet in the folder (it was not
   * connected). Unlike `pendingIdentity` it does not own the folder: when the folder is back
   * it is written only if the folder still holds the old Default and rose; a folder that
   * changed meanwhile (on another Mac) is adopted and the upgrade is dropped.
   */
  pendingColorUpgrade?: true;
}

export interface WorkspacesKey {
  version: 1;
  activeId: string;
  /** Owns the cloud entries that carry no workspace id (spec decision 3). Explicit, never "the first entry". */
  legacyCloudOwnerId: string;
  /** Set once the one-time "New: workspaces" hint is dismissed. */
  hintDismissedAt?: number;
  /**
   * Set the first time the user assigns a cloud item to a workspace ("Assign to workspace…").
   * Until then the legacy cloud owner keeps listing the cloud items with no workspace, so
   * nothing disappears on upgrade; from then on they show only under "Unassigned cloud items".
   */
  cloudAssignedAt?: number;
  /**
   * The one-time upgrade of a "Default workspace" migrated as rose to Kaipu's brand color has
   * run. Once set it never runs again, so a color the user picks later is never taken back.
   */
  kaipuColorApplied?: true;
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
    ...(record["pendingIdentity"] === true ? { pendingIdentity: true as const } : {}),
    ...(record["pendingColorUpgrade"] === true ? { pendingColorUpgrade: true as const } : {}),
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
    ...(typeof record["cloudAssignedAt"] === "number"
      ? { cloudAssignedAt: record["cloudAssignedAt"] }
      : {}),
    ...(record["kaipuColorApplied"] === true ? { kaipuColorApplied: true as const } : {}),
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

export type CreateOutcome =
  | { ok: true; entry: WorkspaceEntry }
  | { ok: false; reason: WorkspaceCreateRefusal };

export type EditOutcome =
  | { ok: true; entry: WorkspaceEntry; savedToFolder: boolean }
  | { ok: false; reason: WorkspaceEditRefusal };

/** Whether a folder may become a workspace's new location; `workspaceName` names the other one. */
export type RelocateCheck =
  | { ok: true }
  | { ok: false; reason: WorkspaceRelocateRefusal; workspaceName?: string };

export type RelocateOutcome =
  | {
      ok: true;
      entry: WorkspaceEntry;
      /** The picked folder is the one the workspace already points at: nothing changed. */
      unchanged?: true;
    }
  | { ok: false; reason: WorkspaceRelocateRefusal; workspaceName?: string };

export type RemoveOutcome =
  | { ok: true }
  | { ok: false; reason: "active" | "last" | "unknown" | "read-only" };

/** Dropped from the "is this folder empty?" check: Finder writes it into any folder it opens. */
const IGNORED_FOLDER_ENTRIES = new Set([".DS_Store"]);

class NameTakenError extends Error {}

const LOCK = "workspaces:registry";
/** Serializes `update`, so one update's rollback never discards another's change. */
const UPDATE_LOCK = "workspaces:registry:update";

/** The identity the one-time brand-color upgrade starts from: the migrated Default, in rose. */
function isOldDefault(identity: WorkspaceIdentity): boolean {
  return identity.name === DEFAULT_WORKSPACE_NAME && identity.color === "rose";
}

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
    if (!registry.key.kaipuColorApplied) await registry.upgradeDefaultColor();
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
            color: DEFAULT_WORKSPACE_COLOR,
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
        color: DEFAULT_WORKSPACE_COLOR,
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
      // Born with the brand color: there is nothing to upgrade, now or on a later launch.
      kaipuColorApplied: true,
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
   * The one-time upgrade (part 1b): a "Default workspace" that part 1 migrated as rose takes
   * Kaipu's brand color. The marker is stored first, in the same write, so it runs once; the
   * folder's identity.json follows through `pendingColorUpgrade`, which also covers a folder
   * that is not connected right now: when it is back, the file is written only if it still
   * holds the old Default and rose. A name or color the user already changed, here or on
   * another Mac, is left as it is.
   */
  private async upgradeDefaultColor(): Promise<void> {
    const owner = this.get(this.key.legacyCloudOwnerId);
    let upgrade = owner?.name === DEFAULT_WORKSPACE_NAME && owner.color === "rose";
    if (owner && upgrade) {
      const file = await readIdentity(owner.path);
      // The folder's own file wins (renamed or recolored on another Mac): leave it as it is,
      // and a probe will refresh this Mac's cache from it.
      if (
        file.kind === "ok" &&
        (file.identity.color !== "rose" || file.identity.name !== DEFAULT_WORKSPACE_NAME)
      ) {
        upgrade = false;
      }
      if (file.kind === "unreadable") upgrade = false;
    }
    try {
      await this.update((key) => {
        key.kaipuColorApplied = true;
        if (owner && upgrade) {
          owner.color = DEFAULT_WORKSPACE_COLOR;
          owner.pendingColorUpgrade = true;
        }
      });
    } catch (error) {
      // preferences.json could not be written: retried on the next launch.
      console.error("workspaces: could not store the color upgrade", error);
      return;
    }
    if (owner && upgrade) await this.availability(owner.id);
  }

  /** The folder next to the Default workspace's, or the nearest reachable fallback. */
  private async newWorkspaceParent(): Promise<string | null> {
    const defaultEntry =
      this.get(this.key.legacyCloudOwnerId) ??
      this.key.entries.find((e) => this.isDefaultPath(e.path));
    for (const candidate of [defaultEntry?.path, this.env.defaultDirectory, this.active().path]) {
      if (!candidate) continue;
      const parent = dirname(candidate);
      if (await isDirectory(parent)) return parent;
    }
    return null;
  }

  /**
   * Where "New workspace" would put `name`'s folder, and whether it can be used: `Kaipu Record
   * — <name>` next to the Default workspace's folder. Read-only; creates nothing.
   */
  async checkNewLocation(name: string): Promise<LocationCheck> {
    const normalized = validateWorkspaceName(name, []);
    if (!normalized.ok) return { path: null, state: "parent-missing" };
    const parent = await this.newWorkspaceParent();
    if (!parent) return { path: null, state: "parent-missing" };
    const path = join(parent, newWorkspaceFolderName(normalized.name));
    try {
      if (!(await stat(path)).isDirectory()) return { path, state: "not-empty" };
      const content = (await readdir(path)).filter((n) => !IGNORED_FOLDER_ENTRIES.has(n));
      return { path, state: content.length === 0 ? "empty" : "not-empty" };
    } catch (error) {
      // Nothing there is the good case; anything else (no permission) cannot be used.
      return (error as NodeJS.ErrnoException).code === "ENOENT"
        ? { path, state: "free" }
        : { path, state: "not-empty" };
    }
  }

  /**
   * Create a workspace in a NEW folder (the owner's request, part 1b): `Kaipu Record — <name>`
   * next to the Default workspace's. Writes only Kaipu's own files; a folder that is there and
   * not empty is refused untouched. Does not switch.
   */
  async create(input: { name: string; color: string }): Promise<CreateOutcome> {
    if (this.readOnly) return { ok: false, reason: "read-only" };
    const checked = validateWorkspaceName(input.name, this.key.entries);
    if (!checked.ok) {
      return { ok: false, reason: checked.reason === "taken" ? "name-taken" : "invalid-name" };
    }
    if (!isTagColor(input.color)) return { ok: false, reason: "invalid-color" };
    const location = await this.checkNewLocation(checked.name);
    if (!location.path) return { ok: false, reason: "parent-missing" };
    if (location.state === "not-empty") return { ok: false, reason: "exists" };

    const path = location.path;
    let madeFolder = false;
    if (location.state === "free") {
      try {
        // One level, never recursive: a missing parent stays missing.
        await mkdir(path);
        madeFolder = true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        return { ok: false, reason: code === "EEXIST" ? "exists" : "not-writable" };
      }
    }
    const undo = async (): Promise<void> => {
      await removeIdentity(path);
      if (madeFolder) await rmdir(path).catch(() => {});
    };
    const identity: WorkspaceIdentity = {
      version: 1,
      id: this.env.newId(),
      name: checked.name,
      color: input.color,
      initials: deriveInitials(checked.name),
      createdAt: WorkspaceRegistry.now(this.env),
    };
    try {
      await writeIdentity(path, identity);
    } catch {
      await undo();
      return { ok: false, reason: "not-writable" };
    }
    const entry = entryFromIdentity(identity, path, identity.createdAt);
    try {
      await this.update((key) => {
        // Re-checked inside the write: two creates cannot both take one name.
        if (validateWorkspaceName(checked.name, key.entries).ok === false)
          throw new NameTakenError();
        key.entries.push(entry);
      });
    } catch (error) {
      await undo();
      return { ok: false, reason: error instanceof NameTakenError ? "name-taken" : "not-writable" };
    }
    return { ok: true, entry };
  }

  /**
   * Rename and/or recolor. The folder's `identity.json` is the authority (it travels with the
   * folder), so it is written first, atomically; the registry's cache follows. A change the
   * folder cannot take is refused whole. A workspace that is not connected is changed in the
   * registry only and carries `pendingIdentity`, so the change reaches the folder when it is
   * back instead of the folder's older file undoing it. Initials that were derived from the
   * old name follow the new one; initials the user chose stay.
   */
  async edit(id: string, patch: { name?: string; color?: string }): Promise<EditOutcome> {
    if (this.readOnly) return { ok: false, reason: "read-only" };
    const before = this.get(id);
    if (!before) return { ok: false, reason: "unknown" };
    let name = before.name;
    if (patch.name !== undefined) {
      const checked = validateWorkspaceName(patch.name, this.key.entries, id);
      if (!checked.ok) {
        return { ok: false, reason: checked.reason === "taken" ? "name-taken" : "invalid-name" };
      }
      name = checked.name;
    }
    let color = before.color;
    if (patch.color !== undefined) {
      if (!isTagColor(patch.color)) return { ok: false, reason: "invalid-color" };
      color = patch.color;
    }
    if (name === before.name && color === before.color) {
      return {
        ok: true,
        entry: before,
        savedToFolder:
          !before.pendingIdentity && !before.pendingColorUpgrade && !before.pendingInit,
      };
    }

    // A probe first: a pending entry may adopt its folder's id, and it says whether to write.
    const probe = await this.availability(id);
    const entry = this.get(probe.id);
    if (!entry) return { ok: false, reason: "unknown" };
    const derived = entry.initials === undefined || entry.initials === deriveInitials(entry.name);
    const initials = derived ? deriveInitials(name) : entry.initials;
    const previous = await readIdentity(entry.path);

    let savedToFolder = false;
    if (probe.availability.state === "available") {
      const next: WorkspaceIdentity =
        previous.kind === "ok"
          ? { ...previous.identity, name, color, ...(initials ? { initials } : {}) }
          : {
              version: 1,
              id: entry.id,
              name,
              color,
              ...(initials ? { initials } : {}),
              createdAt: entry.addedAt,
            };
      try {
        await writeIdentity(entry.path, next);
      } catch {
        return { ok: false, reason: "not-writable" };
      }
      savedToFolder = true;
    }
    try {
      await this.update((key) => {
        // Re-checked inside the write, like create: two edits cannot both take one name.
        if (!validateWorkspaceName(name, key.entries, entry.id).ok) throw new NameTakenError();
        const target = key.entries.find((e) => e.id === entry.id);
        if (!target) return;
        target.name = name;
        target.color = color;
        if (initials) target.initials = initials;
        // Still no identity.json in the folder when it was not written: the init stays pending,
        // or "Change folder…" would refuse the folder the workspace is later moved to.
        if (savedToFolder) delete target.pendingInit;
        // An edit owns the folder's identity from here, so a deferred upgrade has nothing left to decide.
        delete target.pendingColorUpgrade;
        if (savedToFolder) delete target.pendingIdentity;
        else target.pendingIdentity = true;
      });
    } catch (error) {
      // The folder must not keep a change the registry refused: the old file comes back, or,
      // when there was none, the one just written goes.
      if (savedToFolder && previous.kind === "ok") {
        await writeIdentity(entry.path, previous.identity).catch(() => {});
      } else if (savedToFolder && previous.kind === "absent") {
        await removeIdentity(entry.path);
      }
      return { ok: false, reason: error instanceof NameTakenError ? "name-taken" : "not-writable" };
    }
    return { ok: true, entry: this.get(entry.id) ?? entry, savedToFolder };
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
        if (entry.pendingIdentity && !this.readOnly) {
          // Edited while the folder was away: the registry is newer, so the file catches up.
          try {
            await writeIdentity(entry.path, {
              ...identity.identity,
              name: entry.name,
              color: entry.color,
              ...(entry.initials ? { initials: entry.initials } : {}),
            });
            await this.refresh(() => {
              delete entry.pendingIdentity;
              delete entry.pendingColorUpgrade;
            });
          } catch {
            // stays pending; the next probe tries again
          }
          return { availability: { state: "available" }, id };
        }
        if (entry.pendingColorUpgrade && !this.readOnly && isOldDefault(identity.identity)) {
          // Nobody touched the folder since the upgrade was cached: the file takes the new color.
          try {
            await writeIdentity(entry.path, { ...identity.identity, color: entry.color });
            await this.refresh(() => void delete entry.pendingColorUpgrade);
          } catch {
            // stays pending; the next probe tries again
          }
          return { availability: { state: "available" }, id };
        }
        // The folder's file wins: the entry only caches it (renamed on another Mac). That also
        // drops a deferred color upgrade when the folder changed while it was away.
        const fresh = entryFromIdentity(identity.identity, entry.path, entry.addedAt);
        const stale =
          entry.pendingInit ||
          fresh.name !== entry.name ||
          fresh.color !== entry.color ||
          fresh.initials !== entry.initials ||
          entry.pendingColorUpgrade;
        if (stale) {
          await this.refresh(() => {
            delete entry.pendingInit;
            delete entry.pendingIdentity;
            delete entry.pendingColorUpgrade;
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
        if (entry.pendingInit || entry.pendingIdentity || entry.pendingColorUpgrade) {
          await this.refresh(() => {
            delete entry.pendingInit;
            delete entry.pendingIdentity;
            delete entry.pendingColorUpgrade;
          });
        }
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

  /**
   * May `id` be pointed at `path`? Read-only: nothing is written, not even an identity file.
   * Only a folder whose `.kaipu/workspace/identity.json` carries this workspace's id qualifies.
   * An empty or plain folder is refused, never adopted: the workspace's items are not in it,
   * so every one of them would disappear from the library.
   */
  async checkRelocate(id: string, path: string): Promise<RelocateCheck> {
    if (this.readOnly) return { ok: false, reason: "read-only" };
    const entry = this.get(id);
    if (!entry) return { ok: false, reason: "unknown" };
    if (!(await isDirectory(path))) return { ok: false, reason: "not-a-folder" };
    const other = this.key.entries.find((e) => e.id !== id && samePath(e.path, path));
    if (other) return { ok: false, reason: "already-registered", workspaceName: other.name };

    const identity = await readIdentity(path);
    if (identity.kind === "unreadable") return { ok: false, reason: "unreadable" };
    if (identity.kind === "ok") {
      return identity.identity.id === id
        ? { ok: true }
        : { ok: false, reason: "different", workspaceName: identity.identity.name };
    }
    // The folder it already points at, whose identity file was deleted by hand: a probe
    // rewrites it, so this is not a move.
    if (samePath(entry.path, path)) return { ok: true };
    if (await isDirectory(join(path, ".kaipu"))) {
      // A workspace registered while its folder was away never got an identity.json, so a
      // folder with Kaipu items and none is exactly where it can now be: the probe after the
      // move writes the file under the registered id. Any other workspace has an identity to
      // match, so a folder without one is not its own.
      return entry.pendingInit ? { ok: true } : { ok: false, reason: "has-items-no-identity" };
    }
    return { ok: false, reason: "not-a-workspace" };
  }

  /**
   * "Change folder…": point `id` at the folder where it now lives (moved in Finder, put in a
   * Google Drive folder, a drive mounted elsewhere). Only the registry changes: no file is
   * moved, copied or written. Name, color and id stay. The active workspace's path is mirrored
   * into `vaultDirectory`; the caller runs that one inside the switch transaction.
   */
  async relocate(id: string, path: string): Promise<RelocateOutcome> {
    const checked = await this.checkRelocate(id, path);
    if (!checked.ok) return checked;
    try {
      await this.update(
        (key) => {
          const target = key.entries.find((e) => e.id === id);
          if (target) target.path = path;
        },
        { mirrorVault: id === this.key.activeId },
      );
    } catch {
      return { ok: false, reason: "not-writable" };
    }
    const entry = this.get(id);
    return entry ? { ok: true, entry } : { ok: false, reason: "unknown" };
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

  /** The first "Assign to workspace…": unassigned cloud items stop showing in the legacy owner. */
  async markCloudAssigned(): Promise<void> {
    if (this.readOnly || this.key.cloudAssignedAt !== undefined) return;
    await this.update((key) => {
      key.cloudAssignedAt = WorkspaceRegistry.now(this.env);
    });
  }

  /** An update a probe learned (a cached name, a finished init): never fails the probe. */
  private async refresh(mutate: (key: WorkspacesKey) => void): Promise<void> {
    try {
      // What a probe learned is true whether or not it could be written: keep it in memory.
      await this.update(mutate, { mirrorVault: false, rollback: false });
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
    options: { mirrorVault: boolean; rollback?: boolean } = { mirrorVault: false },
  ): Promise<void> {
    return withLock(UPDATE_LOCK, async () => {
      const before = structuredClone(this.key);
      mutate(this.key);
      if (this.readOnly) return;
      try {
        await this.persist(options);
      } catch (error) {
        if (options.rollback !== false) this.key = before;
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
