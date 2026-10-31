import { mkdir, readFile, rmdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { isTagColor, TAG_COLORS, type TagColor } from "@kaipu/domain/constants";
import { atomicWriteFile } from "../library/atomic-write";

/**
 * `.kaipu/workspace/identity.json`: the workspace's id, name, color and initials, inside the
 * folder so they travel with it (ADR 0032). It is in a SUBFOLDER of `.kaipu/`, never beside
 * the sidecars: a sidecar is `.kaipu/<stem>.json`, so a customer's `workspace.png` already owns
 * `.kaipu/workspace.json`, and no media stem can address a folder.
 */
export const IDENTITY_DIR = join(".kaipu", "workspace");
export const IDENTITY_FILE = join(IDENTITY_DIR, "identity.json");

/** The migrated library's name (spec decision 22), and its initials. */
export const DEFAULT_WORKSPACE_NAME = "Default workspace";

const NAME_MAX_LENGTH = 64;

export interface WorkspaceIdentity {
  version: 1;
  id: string;
  name: string;
  color: TagColor;
  /** 1–2 characters; derived from the name when absent. */
  initials?: string;
  createdAt: number;
}

export type IdentityRead =
  | { kind: "ok"; identity: WorkspaceIdentity }
  /** No identity file: a folder from before workspaces, or a plain folder. */
  | { kind: "absent" }
  /** The file is there but cannot be read or is not an identity. Never overwritten. */
  | { kind: "unreadable" };

/** An id that cannot leave the folder it names: no separators, no dots-only. */
export function isSafeWorkspaceId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 64 &&
    /^[A-Za-z0-9-]+$/.test(value)
  );
}

/** First letter of the first two words, upper-cased: "Default workspace" → "DW". */
export function deriveInitials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? "")
    .join("");
  return letters.toLocaleUpperCase() || "?";
}

export function isValidInitials(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const length = Array.from(value.trim()).length;
  return length >= 1 && length <= 2;
}

/** The workspace's display name, or null when nothing usable is left. */
export function normalizeWorkspaceName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (name.length === 0 || /\p{Cc}/u.test(name)) return null;
  return name.slice(0, NAME_MAX_LENGTH);
}

/** The next palette color no registered workspace uses yet (cycles once all are taken). */
export function nextWorkspaceColor(used: readonly TagColor[]): TagColor {
  return (
    TAG_COLORS.find((color) => !used.includes(color)) ??
    TAG_COLORS[used.length % TAG_COLORS.length]!
  );
}

/**
 * Read a folder's identity. An unknown color or invalid initials fall back on read and the
 * file is NOT rewritten (spec, Data shapes).
 */
export async function readIdentity(root: string): Promise<IdentityRead> {
  let raw: string;
  try {
    raw = await readFile(join(root, IDENTITY_FILE), "utf-8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { kind: "absent" }
      : { kind: "unreadable" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "unreadable" };
  }
  if (!parsed || typeof parsed !== "object") return { kind: "unreadable" };
  const record = parsed as Record<string, unknown>;
  const name = normalizeWorkspaceName(record["name"]);
  if (record["version"] !== 1 || !isSafeWorkspaceId(record["id"]) || !name) {
    return { kind: "unreadable" };
  }
  const color = isTagColor(record["color"]) ? record["color"] : TAG_COLORS[0];
  const initials = isValidInitials(record["initials"]) ? record["initials"].trim() : undefined;
  const createdAt = typeof record["createdAt"] === "number" ? record["createdAt"] : 0;
  return {
    kind: "ok",
    identity: {
      version: 1,
      id: record["id"],
      name,
      color,
      ...(initials ? { initials } : {}),
      createdAt,
    },
  };
}

/** True when `path` is an existing directory (never creates it). */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** mkdir one level; an existing directory is fine. Never recursive, so a missing root stays missing. */
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
 * Write `identity.json` atomically (temp, fsync, rename). Only Kaipu's own folders are
 * created, and only inside an existing root: a missing root means "not connected", and
 * recreating it would turn an unplugged drive into an empty library. On failure, the
 * folders this call created are removed again, so a refused folder is left as it was.
 */
export async function writeIdentity(root: string, identity: WorkspaceIdentity): Promise<void> {
  if (!(await isDirectory(root))) {
    throw Object.assign(new Error(`workspace folder is missing: ${root}`), { code: "ENOENT" });
  }
  const meta = join(root, ".kaipu");
  const dir = join(root, IDENTITY_DIR);
  const createdMeta = await mkdirOne(meta);
  let createdDir = false;
  try {
    createdDir = await mkdirOne(dir);
    await atomicWriteFile(join(root, IDENTITY_FILE), `${JSON.stringify(identity, null, 2)}\n`);
  } catch (error) {
    if (createdDir) await rmdir(dir).catch(() => {});
    if (createdMeta) await rmdir(meta).catch(() => {});
    throw error;
  }
}
