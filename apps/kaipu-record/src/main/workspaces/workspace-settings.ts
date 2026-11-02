import {
  FOLDER_OVERRIDE_KEYS,
  isOverridableKey,
  type CopyToAllResult,
  type FolderOverrideKey,
  type FolderOverridesState,
  type OverridableKey,
  type ResetOverridesResult,
  type ResolvePendingResult,
  type ScopedSettings,
  type SetOverrideResult,
  type SettingsOverrides,
} from "@shared/settings-scope";
import type { AppSettings } from "@shared/types";
import {
  type FolderOverrides,
  type FolderRead,
  type MachineSettingsStore,
  folderState,
  normalizeOverride,
  readFolderOverrides,
  resolveEffective,
  writeFolderOverrides,
} from "./settings-overrides";

/** How long a capture waits for a folder file before it counts as unreadable (an evicted file). */
const READ_TIMEOUT_MS = 2000;

export interface WorkspaceSettingsDeps {
  machine: MachineSettingsStore;
  /** The registered workspaces (id, name, folder). */
  workspaces(): ReadonlyArray<{ id: string; name: string; path: string }>;
  activeId(): string;
  /** Whether the workspace's folder is reachable right now. */
  isAvailable(id: string): Promise<boolean>;
  /** The persisted All workspaces level. */
  getAll(): AppSettings;
  /** Write values to the All workspaces level. */
  writeAll(patch: Partial<AppSettings>): void;
  /** The active workspace's effective settings (what every snapshot carries). */
  effective(): AppSettings;
  /** The active workspace's effective settings may have changed: recompute and tell everyone. */
  changed(): void;
  now(): number;
  readTimeoutMs?: number;
}

type Changes = Partial<Record<OverridableKey, unknown>>;

/**
 * Per-workspace setting overrides (ADR 0034): the resolver's source of truth for the active
 * workspace, the writes behind `settings:set-override` / `resolve-pending`, and the scoped read
 * the Settings page uses. Folder files are read into a cache at the moments the ADR names (a
 * workspace added or activated, app start, each capture start), so the effective settings can
 * be asked for synchronously from anywhere.
 */
export class WorkspaceSettings {
  private readonly reads = new Map<string, FolderRead>();
  /** The last read that actually saw the file (present or absent): what an unplugged drive held. */
  private readonly lastSeen = new Map<string, FolderRead>();
  /** The last write of each workspace: read → write → record must not interleave with itself. */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: WorkspaceSettingsDeps) {}

  /**
   * Bumped before and after every write of a workspace's folder file, so a read that began before
   * the write ended may hold the old bytes. Together with `writing` (a write in flight) and
   * `refreshTickets` (the refresh that started last wins) it keeps a slow or overlapping refresh
   * from putting an older read, with the old sha256, over what this Mac just recorded.
   */
  private readonly writeEpochs = new Map<string, number>();
  private readonly writing = new Map<string, number>();
  private readonly refreshTickets = new Map<string, number>();
  private readonly refreshApplied = new Map<string, number>();
  /**
   * The overrides as they were when a write began. While the write runs the new hash is already
   * recorded and the file still holds the old bytes; reading the cache against that record would
   * switch this Mac's own overrides off for a moment, so the answer is held until it ends.
   */
  private readonly frozen = new Map<string, SettingsOverrides>();

  /**
   * A fresh read taken on the write path (an answer, or the read an edit starts from) is newer
   * than any refresh already in flight: bumping the epoch makes those drop what they read.
   */
  private fence(id: string): void {
    this.writeEpochs.set(id, (this.writeEpochs.get(id) ?? 0) + 1);
  }

  private beginWrite(id: string): void {
    this.frozen.set(id, this.computeOverrides(id));
    this.writing.set(id, (this.writing.get(id) ?? 0) + 1);
    this.writeEpochs.set(id, (this.writeEpochs.get(id) ?? 0) + 1);
  }

  private endWrite(id: string): void {
    this.frozen.delete(id);
    this.writing.set(id, Math.max(0, (this.writing.get(id) ?? 1) - 1));
    this.writeEpochs.set(id, (this.writeEpochs.get(id) ?? 0) + 1);
  }

  private remember(id: string, read: FolderRead): void {
    this.reads.set(id, read);
    if (read.kind !== "unreadable") this.lastSeen.set(id, read);
  }

  /** Run `job` after every earlier write of the same workspace; a failure does not block the next. */
  private serialize<T>(id: string, job: () => Promise<T>): Promise<T> {
    const run = (this.queues.get(id) ?? Promise.resolve()).then(job);
    const tail = run.catch(() => undefined);
    this.queues.set(id, tail);
    void tail.then(() => {
      if (this.queues.get(id) === tail) this.queues.delete(id);
    });
    return run;
  }

  private known(id: string): { id: string; name: string; path: string } | undefined {
    return this.deps.workspaces().find((ws) => ws.id === id);
  }

  private async read(path: string): Promise<FolderRead> {
    const timeout = this.deps.readTimeoutMs ?? READ_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        readFolderOverrides(path),
        new Promise<FolderRead>((resolve) => {
          timer = setTimeout(() => resolve({ kind: "unreadable" }), timeout);
        }),
      ]);
    } catch {
      return { kind: "unreadable" };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Read a workspace's folder file into the cache. A workspace that is not connected has no
   * readable file. When the active workspace's overrides change because of it (a sync wrote
   * the file), everyone is told.
   */
  async refresh(id: string): Promise<void> {
    const ws = this.known(id);
    if (!ws) return;
    const before = JSON.stringify(this.overridesOf(id));
    const epoch = this.writeEpochs.get(id) ?? 0;
    const ticket = (this.refreshTickets.get(id) ?? 0) + 1;
    this.refreshTickets.set(id, ticket);
    const read = await this.probe(id, ws.path);
    // A write is under way, or ended while this file was read: the read may predate it, and the
    // write has the newer say. A refresh that started after this one has too.
    if ((this.writing.get(id) ?? 0) > 0 || (this.writeEpochs.get(id) ?? 0) !== epoch) return;
    if (ticket < (this.refreshApplied.get(id) ?? 0)) return;
    this.refreshApplied.set(id, ticket);
    this.remember(id, read);
    if (id === this.deps.activeId() && before !== JSON.stringify(this.overridesOf(id))) {
      this.deps.changed();
    }
  }

  /**
   * The folder file as it reads now. The WHOLE probe is bounded (is the folder reachable, then
   * the read): a capture waits on this, and an unreachable or evicted folder must not hold the
   * overlay back. A probe that runs out of time counts as an unreadable file.
   */
  private async probe(id: string, path: string): Promise<FolderRead> {
    const timeout = this.deps.readTimeoutMs ?? READ_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async (): Promise<FolderRead> =>
          (await this.deps.isAvailable(id)) ? await this.read(path) : { kind: "unreadable" })(),
        new Promise<FolderRead>((resolve) => {
          timer = setTimeout(() => resolve({ kind: "unreadable" }), timeout);
        }),
      ]);
    } catch {
      return { kind: "unreadable" };
    } finally {
      clearTimeout(timer);
    }
  }

  private stateOf(id: string): Exclude<FolderOverridesState, "unavailable"> {
    const read = this.reads.get(id) ?? { kind: "absent" as const };
    return folderState(read, this.deps.machine.get(id).folderOverrides);
  }

  /** The overrides that apply in a workspace: its confirmed folder file plus its machine-bound mode. */
  private overridesOf(id: string): SettingsOverrides {
    const held = this.frozen.get(id);
    if (held) return held;
    return this.computeOverrides(id);
  }

  private computeOverrides(id: string): SettingsOverrides {
    const overrides: SettingsOverrides = {};
    const read = this.reads.get(id);
    if (this.stateOf(id) === "active" && read?.kind === "ok")
      Object.assign(overrides, read.overrides);
    const uploadMode = this.deps.machine.get(id).uploadMode;
    if (uploadMode) overrides.uploadMode = uploadMode;
    return overrides;
  }

  /** The active workspace's overrides, answered from the cache. */
  activeOverrides(): SettingsOverrides {
    return this.overridesOf(this.deps.activeId());
  }

  async getScoped(scope: string): Promise<ScopedSettings> {
    const all = this.deps.getAll();
    if (scope === "all") {
      const overriddenIn: Partial<Record<OverridableKey, string[]>> = {};
      for (const ws of this.deps.workspaces()) {
        await this.refresh(ws.id);
        for (const key of Object.keys(this.overridesOf(ws.id)) as OverridableKey[]) {
          (overriddenIn[key] ??= []).push(ws.name);
        }
      }
      return {
        scope,
        all,
        overrides: {},
        effective: all,
        folder: "none",
        pending: null,
        folderSha256: null,
        overriddenIn,
      };
    }
    if (!this.known(scope)) {
      return {
        scope,
        all,
        overrides: {},
        effective: all,
        folder: "unavailable",
        pending: null,
        folderSha256: null,
        overriddenIn: {},
      };
    }
    const available = await this.deps.isAvailable(scope);
    await this.refresh(scope);
    const overrides = this.overridesOf(scope);
    const read = this.reads.get(scope);
    const state = available ? this.stateOf(scope) : "unavailable";
    const waiting = (state === "pending" || state === "ignored") && read?.kind === "ok";
    return {
      scope,
      all,
      overrides,
      effective: resolveEffective(all, overrides),
      folder: state,
      pending: waiting ? read.overrides : null,
      folderSha256: waiting ? read.sha256 : null,
      overriddenIn: {},
    };
  }

  /**
   * Apply a set of changes to one workspace (`null` removes a key). Folder keys go to the
   * folder file in a single write, `uploadMode` to the machine file. Nothing is written when
   * nothing would change.
   */
  private apply(id: string, changes: Changes): Promise<SetOverrideResult> {
    return this.serialize(id, () => this.applyNow(id, changes));
  }

  private async applyNow(id: string, changes: Changes): Promise<SetOverrideResult> {
    const ws = this.known(id);
    if (!ws) return { ok: false, reason: "unknown-workspace" };
    const checked: Changes = {};
    for (const [key, value] of Object.entries(changes)) {
      if (!isOverridableKey(key)) return { ok: false, reason: "not-overridable" };
      if (value === null) {
        checked[key] = null;
        continue;
      }
      const normalized = normalizeOverride(key, value);
      if (!normalized.ok) return { ok: false, reason: "invalid" };
      checked[key] = normalized.value;
    }
    if (!(await this.deps.isAvailable(id))) return { ok: false, reason: "unavailable" };

    const folderKeys = Object.keys(checked).filter((key): key is FolderOverrideKey =>
      (FOLDER_OVERRIDE_KEYS as readonly string[]).includes(key),
    );
    try {
      // The machine-bound key does not depend on the folder file, so a pending or unreadable
      // file never keeps it from changing.
      if ("uploadMode" in checked) {
        const next = checked["uploadMode"];
        await this.deps.machine.update(id, (entry) => {
          const { uploadMode: _drop, ...rest } = entry;
          void _drop;
          return next === null ? rest : { ...rest, uploadMode: next as AppSettings["uploadMode"] };
        });
      }
      if (folderKeys.length > 0) {
        const refused = await this.applyFolder(ws, folderKeys, checked);
        if (refused) {
          this.deps.changed();
          return { ok: false, reason: refused };
        }
      }
    } catch (error) {
      console.error("[workspace-settings] write failed", error);
      this.deps.changed();
      return { ok: false, reason: "failed" };
    }
    this.deps.changed();
    return { ok: true, settings: this.deps.effective() };
  }

  private async applyFolder(
    ws: { id: string; path: string },
    keys: FolderOverrideKey[],
    changes: Changes,
  ): Promise<"pending" | "unreadable" | null> {
    // Always from the disk: the cache may predate a sync.
    const read = await this.read(ws.path);
    this.remember(ws.id, read);
    this.fence(ws.id);
    const state = folderState(read, this.deps.machine.get(ws.id).folderOverrides);
    if (state === "unreadable") return "unreadable";
    // The user has not seen these values: writing now would activate them by the back door.
    if (state === "pending") return "pending";
    // An ignored file is replaced by the keys this Mac now writes (spec, decision 26).
    const base: FolderOverrides = state === "active" && read.kind === "ok" ? read.overrides : {};
    const next: Record<string, unknown> = { ...base };
    for (const key of keys) {
      if (changes[key] === null) delete next[key];
      else next[key] = changes[key];
    }
    const unchanged =
      JSON.stringify(next) === JSON.stringify(base) &&
      (state === "active" || Object.keys(next).length === 0);
    if (unchanged) return null;
    const previous = this.deps.machine.get(ws.id).folderOverrides;
    let sha256: string;
    this.beginWrite(ws.id);
    try {
      // The new hash is recorded BEFORE the file changes (see `writeFolderOverrides`), so this
      // Mac's own edit is never mistaken for a change made by a sync.
      sha256 = await writeFolderOverrides(ws.path, next as FolderOverrides, (hash) =>
        this.deps.machine.update(ws.id, (entry) => ({
          ...entry,
          folderOverrides: { sha256: hash, decision: "use", at: this.deps.now() },
        })),
      );
    } catch (error) {
      // The file did not change: put the record of the file that is still there back.
      await this.deps.machine
        .update(ws.id, ({ folderOverrides: _drop, ...rest }) => {
          void _drop;
          return previous ? { ...rest, folderOverrides: previous } : rest;
        })
        .catch(() => undefined);
      this.endWrite(ws.id);
      throw error;
    }
    this.remember(ws.id, { kind: "ok", overrides: next as FolderOverrides, sha256 });
    this.endWrite(ws.id);
    return null;
  }

  setOverride(id: string, key: OverridableKey, value: unknown | null): Promise<SetOverrideResult> {
    if (!isOverridableKey(key)) return Promise.resolve({ ok: false, reason: "not-overridable" });
    return this.apply(id, { [key]: value });
  }

  resetOverrides(id: string, keys: readonly OverridableKey[]): Promise<ResetOverridesResult> {
    const changes: Changes = {};
    for (const key of keys) changes[key] = null;
    return this.apply(id, changes);
  }

  /**
   * "Use them" / "Ignore" for a folder file (ADR 0034, decision 8). `sha256` names the file the
   * user saw: a file that changed since is not confirmed by an answer meant for the old one.
   */
  resolvePending(
    id: string,
    decision: "use" | "ignore",
    sha256: string,
  ): Promise<ResolvePendingResult> {
    return this.serialize(id, () => this.resolvePendingNow(id, decision, sha256));
  }

  private async resolvePendingNow(
    id: string,
    decision: "use" | "ignore",
    sha256: string,
  ): Promise<ResolvePendingResult> {
    const ws = this.known(id);
    if (!ws) return { ok: false, reason: "unknown-workspace" };
    if (!(await this.deps.isAvailable(id))) return { ok: false, reason: "nothing-pending" };
    const read = await this.read(ws.path);
    this.remember(id, read);
    this.fence(id);
    const state = folderState(read, this.deps.machine.get(id).folderOverrides);
    if (read.kind !== "ok" || state === "none" || state === "unreadable") {
      this.deps.changed();
      return { ok: false, reason: "nothing-pending" };
    }
    if (read.sha256 !== sha256) {
      this.deps.changed();
      return { ok: false, reason: "changed" };
    }
    try {
      await this.deps.machine.update(id, (entry) => ({
        ...entry,
        folderOverrides: { sha256: read.sha256, decision, at: this.deps.now() },
      }));
    } catch (error) {
      console.error("[workspace-settings] recording the answer failed", error);
      return { ok: false, reason: "failed" };
    }
    this.deps.changed();
    return { ok: true, settings: this.deps.effective() };
  }

  /**
   * Whether a workspace whose override could not be cleared may still hold one of `keys`: its
   * machine-bound upload mode, the valid entries of its last read file, or, with no read at all,
   * the honest "cannot rule it out".
   */
  private mayHoldOwn(id: string, keys: readonly OverridableKey[]): boolean {
    if (keys.includes("uploadMode") && this.deps.machine.get(id).uploadMode) return true;
    const read = this.lastSeen.get(id);
    // Never seen: nothing rules it out.
    if (!read) return true;
    if (read.kind === "absent") return false;
    return read.kind === "ok" && keys.some((key) => key in read.overrides);
  }

  /**
   * "Copy to all workspaces": the value `id` shows becomes the All level's, and every workspace
   * drops its own override of the key, so all of them inherit it and cannot drift apart later.
   * A workspace whose override cannot be cleared (not connected, unreadable file, an answer
   * still pending) keeps it and is named in `keptOwn`, because "all" must not quietly mean
   * "all that were connected".
   */
  async copyToAll(id: string, keys: readonly OverridableKey[]): Promise<CopyToAllResult> {
    if (!this.known(id)) return { ok: false, reason: "unknown-workspace" };
    if (!keys.every(isOverridableKey)) return { ok: false, reason: "not-overridable" };
    // A workspace that is not connected cannot say what it shows: nothing is copied from it.
    if (!(await this.deps.isAvailable(id))) return { ok: false, reason: "unavailable" };
    const wanted = [...new Set(keys)];
    await this.refresh(id);
    // A file that cannot be read cannot say what the workspace shows: refuse before any write.
    // (`uploadMode` is machine-bound, so an unreadable folder file does not stop it.)
    if (wanted.some((key) => key !== "uploadMode") && this.reads.get(id)?.kind === "unreadable") {
      return { ok: false, reason: "unreadable" };
    }
    const shown = resolveEffective(this.deps.getAll(), this.overridesOf(id));
    const patch: Record<string, unknown> = {};
    for (const key of wanted) patch[key] = shown[key];
    try {
      this.deps.writeAll(patch as Partial<AppSettings>);
    } catch (error) {
      console.error("[workspace-settings] writing the All level failed", error);
      return { ok: false, reason: "failed" };
    }
    const keptOwn: string[] = [];
    for (const ws of this.deps.workspaces()) {
      const result = await this.resetOverrides(ws.id, wanted);
      if (result.ok) continue;
      // Named only when it really keeps a value of its own for one of the copied keys.
      if (this.mayHoldOwn(ws.id, wanted)) keptOwn.push(ws.name);
    }
    this.deps.changed();
    return { ok: true, settings: this.deps.effective(), keptOwn };
  }
}
