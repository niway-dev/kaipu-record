import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SyncProvider } from "@shared/types/workspaces";

/**
 * Which cloud provider syncs a workspace folder, if any (spec, Synced folders; decision 15).
 * Kaipu does not sync to these providers: a folder inside one is detected and labelled, and the
 * workspace then keeps its scratch files outside the folder, never hard-links its media and
 * never reads an evicted file.
 *
 * Detection is by path after `realpath`, plus Google Drive's own xattr on `identity.json` for a
 * folder the path rule misses. It never lists a directory and never reads a file's data: in
 * the spike, listing the provider root hung for minutes while `stat` and xattr reads answered.
 */

/** Google Drive for desktop tags every file it syncs with this xattr (spike, DriveFS 133). */
export const GOOGLE_DRIVE_ITEM_XATTR = "com.google.drivefs.item-id#S";

/** How long a detection step may take before it counts as "no answer". */
export const SYNC_DETECT_TIMEOUT_MS = 2_000;

/** The provider a path lives under, from the path alone. */
export function syncProviderOfPath(path: string, home: string = homedir()): SyncProvider | null {
  const cloudStorage = join(home, "Library", "CloudStorage");
  const iCloud = join(home, "Library", "Mobile Documents", "com~apple~CloudDocs");
  const under = (root: string): boolean => path === root || path.startsWith(`${root}/`);
  if (under(iCloud)) return "icloud";
  if (!path.startsWith(`${cloudStorage}/`)) return null;
  const provider = path.slice(cloudStorage.length + 1).split("/")[0] ?? "";
  if (provider.startsWith("GoogleDrive-")) return "google-drive";
  if (provider.startsWith("OneDrive")) return "onedrive";
  return provider.length > 0 ? "cloud-provider" : null;
}

export interface SyncDetectDeps {
  home: string;
  realpath(path: string): Promise<string>;
  /** Whether `file` carries the xattr `name`. Reading an xattr never downloads the file. */
  hasXattr(file: string, name: string): Promise<boolean>;
  timeoutMs: number;
}

/** `value`, or `fallback` when it does not settle in `ms` (or rejects). */
export async function withTimeout<T>(value: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([value.catch(() => fallback), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** `/usr/bin/xattr -p <name> <file>`: exits 0 only when the attribute is there. */
function hasXattrViaCli(file: string, name: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("/usr/bin/xattr", ["-p", name, file], { timeout: SYNC_DETECT_TIMEOUT_MS }, (error) =>
      resolve(!error),
    );
  });
}

export const defaultSyncDetectDeps: SyncDetectDeps = {
  home: homedir(),
  realpath: (path) => realpath(path),
  hasXattr: hasXattrViaCli,
  timeoutMs: SYNC_DETECT_TIMEOUT_MS,
};

/** Detect the provider of a workspace folder. Never throws; an unanswered step reads as "no". */
export async function detectSync(
  path: string,
  deps: SyncDetectDeps = defaultSyncDetectDeps,
): Promise<SyncProvider | null> {
  if (process.platform !== "darwin" && deps === defaultSyncDetectDeps) return null;
  const resolved = await withTimeout(deps.realpath(path), deps.timeoutMs, path);
  const byPath = syncProviderOfPath(resolved, deps.home) ?? syncProviderOfPath(path, deps.home);
  if (byPath) return byPath;
  // The safety net for a folder the path rule misses (`~/Documents` under iCloud "Desktop &
  // Documents" is unverified; Drive mounted elsewhere). Only Kaipu's own small file is asked.
  const identity = join(path, ".kaipu", "workspace", "identity.json");
  const tagged = await withTimeout(
    deps.hasXattr(identity, GOOGLE_DRIVE_ITEM_XATTR),
    deps.timeoutMs,
    false,
  );
  return tagged ? "google-drive" : null;
}
