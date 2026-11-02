import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rmdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  FOLDER_OVERRIDE_KEYS,
  type FolderOverrideKey,
  type FolderOverridesState,
  type OverridableKey,
  type SettingsOverrides,
} from "@shared/settings-scope";
import type { AppSettings, UploadMode } from "@shared/types";
import { sanitizeExportQuality } from "@shared/types";
import { sanitizeQuality } from "@shared/recording-quality";
import { atomicWriteFile } from "../library/atomic-write";
import { isValidScreenshotCopyMode, isValidUploadMode } from "../services/settings.service";

/**
 * The two files that hold per-workspace setting overrides (ADR 0034), and the pure rules
 * around them. Nothing here touches Electron, so it is all tested against temp folders.
 */

/** `<workspace>/.kaipu/workspace/settings.json`: beside `identity.json`, never beside a sidecar. */
export const SETTINGS_FILE = join(".kaipu", "workspace", "settings.json");

/**
 * Check one override value with the validator `mergeSettings` uses for that key. Unlike the
 * merge, an invalid value is REJECTED instead of replaced by the default: an override that is
 * not valid means "inherit".
 */
export function normalizeOverride(
  key: OverridableKey,
  value: unknown,
): { ok: true; value: unknown } | { ok: false } {
  switch (key) {
    case "showBrandBadge":
      return typeof value === "boolean" ? { ok: true, value } : { ok: false };
    case "screenshotCopy":
      return isValidScreenshotCopyMode(value) ? { ok: true, value } : { ok: false };
    case "uploadMode":
      return isValidUploadMode(value) ? { ok: true, value } : { ok: false };
    case "exportQuality":
      return sanitizeExportQuality(value) === value ? { ok: true, value } : { ok: false };
    case "recordingQuality": {
      if (!value || typeof value !== "object") return { ok: false };
      const sanitized = sanitizeQuality(value);
      const given = value as Record<string, unknown>;
      const exact =
        given["resolution"] === sanitized.resolution &&
        given["fps"] === sanitized.fps &&
        given["bitrate"] === sanitized.bitrate;
      return exact ? { ok: true, value: sanitized } : { ok: false };
    }
  }
}

export type FolderOverrides = Partial<Pick<AppSettings, FolderOverrideKey>>;

export type FolderRead =
  /** No file. */
  | { kind: "absent" }
  /** The file is there and cannot be read or is not a settings file. Never overwritten. */
  | { kind: "unreadable" }
  /** `overrides` holds only the valid entries of the four folder-bound keys. */
  | { kind: "ok"; overrides: FolderOverrides; sha256: string };

function sha256Of(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Read a folder's overrides. An unknown key, a key outside the four folder-bound ones
 * (`uploadMode` included) or an invalid value is ignored, and the file is never rewritten by
 * reading it. The hash covers the exact bytes, so any edit (sync, restore, a text editor)
 * changes it.
 */
export async function readFolderOverrides(root: string): Promise<FolderRead> {
  let bytes: Buffer;
  try {
    bytes = await readFile(join(root, SETTINGS_FILE));
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { kind: "absent" }
      : { kind: "unreadable" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf-8"));
  } catch {
    return { kind: "unreadable" };
  }
  if (!parsed || typeof parsed !== "object") return { kind: "unreadable" };
  const record = parsed as Record<string, unknown>;
  const stored = record["overrides"];
  if (record["version"] !== 1 || !stored || typeof stored !== "object" || Array.isArray(stored)) {
    return { kind: "unreadable" };
  }
  const overrides: Record<string, unknown> = {};
  for (const key of FOLDER_OVERRIDE_KEYS) {
    if (!Object.hasOwn(stored, key)) continue;
    const checked = normalizeOverride(key, (stored as Record<string, unknown>)[key]);
    if (checked.ok) overrides[key] = checked.value;
  }
  return { kind: "ok", overrides: overrides as FolderOverrides, sha256: sha256Of(bytes) };
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function mkdirOne(path: string): Promise<boolean> {
  try {
    await mkdir(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

/**
 * Write the folder's overrides atomically and return the sha256 of the written bytes, which
 * the caller records so this Mac's own edit never asks for confirmation. A missing root means
 * "not connected" and throws: recreating it would turn an unplugged drive into an empty folder.
 *
 * `beforeWrite` receives the hash of the bytes about to be written, before the file changes: a
 * caller that records the hash there can never end with a new file and a stale record (which
 * would read as "changed by sync" and switch this Mac's own overrides off). If recording throws,
 * the file is untouched.
 */
export async function writeFolderOverrides(
  root: string,
  overrides: FolderOverrides,
  beforeWrite?: (sha256: string) => Promise<void>,
): Promise<string> {
  if (!(await isDirectory(root))) {
    throw Object.assign(new Error(`workspace folder is missing: ${root}`), { code: "ENOENT" });
  }
  const text = `${JSON.stringify({ version: 1, overrides }, null, 2)}\n`;
  const sha256 = sha256Of(text);
  await beforeWrite?.(sha256);
  const meta = join(root, ".kaipu");
  const dir = dirname(join(root, SETTINGS_FILE));
  const createdMeta = await mkdirOne(meta);
  let createdDir = false;
  try {
    createdDir = await mkdirOne(dir);
    await atomicWriteFile(join(root, SETTINGS_FILE), text);
  } catch (error) {
    if (createdDir) await rmdir(dir).catch(() => {});
    if (createdMeta) await rmdir(meta).catch(() => {});
    throw error;
  }
  return sha256;
}

export interface FolderRecord {
  sha256: string;
  decision: "use" | "ignore";
  at: number;
}

/**
 * What Settings knows about a folder's file (ADR 0034, decision 8): its overrides apply only
 * while the file's hash equals the one this Mac recorded with "use".
 */
export function folderState(
  read: FolderRead,
  record: FolderRecord | undefined,
): Exclude<FolderOverridesState, "unavailable"> {
  if (read.kind === "unreadable") return "unreadable";
  if (read.kind === "absent" || Object.keys(read.overrides).length === 0) return "none";
  if (!record || record.sha256 !== read.sha256) return "pending";
  return record.decision === "use" ? "active" : "ignored";
}

/** The effective settings: an override over the All level, key by key. Nothing is copied back. */
export function resolveEffective(all: AppSettings, overrides: SettingsOverrides): AppSettings {
  return { ...all, ...overrides };
}

export interface MachineEntry {
  /** The machine-bound upload mode (consent stays on this Mac, never in a folder). */
  uploadMode?: UploadMode;
  /** The accepted or ignored `.kaipu/workspace/settings.json`. */
  folderOverrides?: FolderRecord;
}

function sanitizeEntry(value: unknown): MachineEntry {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const entry: MachineEntry = {};
  if (isValidUploadMode(raw["uploadMode"])) entry.uploadMode = raw["uploadMode"];
  const record = raw["folderOverrides"];
  if (record && typeof record === "object") {
    const { sha256, decision, at } = record as Record<string, unknown>;
    if (
      typeof sha256 === "string" &&
      (decision === "use" || decision === "ignore") &&
      typeof at === "number"
    ) {
      entry.folderOverrides = { sha256, decision, at };
    }
  }
  return entry;
}

/**
 * `userData/workspace-settings.json`: the machine-bound `uploadMode` and the record of which
 * folder file this Mac accepted, per workspace id. Held in memory (reads are synchronous, since
 * the effective settings are asked for everywhere) and written atomically on every change.
 */
export class MachineSettingsStore {
  private entries = new Map<string, MachineEntry>();
  private tail: Promise<unknown> = Promise.resolve();
  private corrupt = false;
  /** The file exists and could not be read (not "absent"): it must not be written over. */
  private unreadable = false;

  private constructor(private readonly file: string) {}

  static async open(file: string): Promise<MachineSettingsStore> {
    const store = new MachineSettingsStore(file);
    await store.load();
    return store;
  }

  /** Read the file into memory. Only a missing file is "empty"; any other failure keeps it untouched. */
  private async load(): Promise<void> {
    let text: string;
    try {
      text = await readFile(this.file, "utf-8");
    } catch (error) {
      this.entries = new Map();
      this.corrupt = false;
      this.unreadable = (error as NodeJS.ErrnoException).code !== "ENOENT";
      return;
    }
    this.unreadable = false;
    this.corrupt = false;
    this.entries = new Map();
    try {
      const parsed = JSON.parse(text) as { workspaces?: unknown };
      const workspaces = parsed?.workspaces;
      if (workspaces && typeof workspaces === "object") {
        for (const [id, value] of Object.entries(workspaces)) {
          const entry = sanitizeEntry(value);
          if (Object.keys(entry).length > 0) this.entries.set(id, entry);
        }
      }
    } catch {
      // Unusable: start empty, and keep the file aside before the first write over it.
      this.corrupt = true;
    }
  }

  get(id: string): MachineEntry {
    return this.entries.get(id) ?? {};
  }

  /** Apply `change` to one workspace's entry and write the file. Updates run one at a time. */
  update(id: string, change: (entry: MachineEntry) => MachineEntry): Promise<void> {
    const run = this.tail.then(async () => {
      // A file that could not be read last time is tried again: the failure may have passed. If
      // it still cannot be read, nothing is written, so the other workspaces' records survive.
      if (this.unreadable) {
        await this.load();
        if (this.unreadable)
          throw new Error(`cannot update unreadable settings file: ${this.file}`);
      }
      const next = change({ ...this.get(id) });
      const previous = this.entries.get(id);
      if (Object.keys(next).length === 0) this.entries.delete(id);
      else this.entries.set(id, next);
      try {
        await this.write();
      } catch (error) {
        // The file did not change, so memory must not either.
        if (previous) this.entries.set(id, previous);
        else this.entries.delete(id);
        throw error;
      }
    });
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async write(): Promise<void> {
    if (this.corrupt) {
      await rename(this.file, `${this.file}.corrupt-${randomUUID().slice(0, 8)}`).catch(() => {});
      this.corrupt = false;
    }
    const workspaces: Record<string, MachineEntry> = {};
    for (const [id, entry] of this.entries) workspaces[id] = entry;
    await atomicWriteFile(this.file, `${JSON.stringify({ version: 1, workspaces }, null, 2)}\n`);
  }
}
