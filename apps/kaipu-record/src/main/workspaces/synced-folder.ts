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

/**
 * The provider a path lives under, from the path alone. The roots that count:
 * - `~/Library/CloudStorage/*`: where macOS 12.1+ File Provider mounts every current client
 *   (Google Drive, OneDrive, Dropbox, Box, ...); the folder name says which.
 * - `~/Library/Mobile Documents/*`: iCloud's containers, `com~apple~CloudDocs` being iCloud
 *   Drive; every folder there is synced by iCloud.
 * - `~/Google Drive`, `~/OneDrive*`, `~/Dropbox*`: the home-folder roots of the clients before
 *   File Provider (Backup and Sync; the OneDrive and Dropbox installs that keep their old
 *   folder). Business accounts add a suffix ("OneDrive - Acme", "Dropbox (Personal)"), so the
 *   root is the first folder under home whose name is the provider's, alone or followed by a space.
 *
 * Not detected by path, on purpose: `~/Documents` and `~/Desktop` under iCloud's "Desktop &
 * Documents" (the path is the same whether the setting is on or off, so a path rule would turn
 * every folder in Documents into a synced one; the iCloud xattr is unverified, so no net exists
 * for it), and a provider mounted somewhere else (an external volume, a custom Drive location):
 * only Google Drive's own xattr catches those (`detectSync`). A "this folder is synced"
 * override the user can set is the way out for the rest, and is not part of this change.
 */
export function syncProviderOfPath(path: string, home: string = homedir()): SyncProvider | null {
  const cloudStorage = join(home, "Library", "CloudStorage");
  const iCloud = join(home, "Library", "Mobile Documents");
  if (path === iCloud || path.startsWith(`${iCloud}/`)) return "icloud";
  if (path.startsWith(`${cloudStorage}/`)) {
    const provider = path.slice(cloudStorage.length + 1).split("/")[0] ?? "";
    if (provider.startsWith("GoogleDrive-")) return "google-drive";
    if (provider.startsWith("OneDrive")) return "onedrive";
    return provider.length > 0 ? "cloud-provider" : null;
  }
  if (!path.startsWith(`${home}/`)) return null;
  const root = path.slice(home.length + 1).split("/")[0] ?? "";
  const named = (name: string): boolean => root === name || root.startsWith(`${name} `);
  if (named("Google Drive")) return "google-drive";
  if (named("OneDrive")) return "onedrive";
  if (named("Dropbox")) return "cloud-provider";
  return null;
}

export interface SyncDetectDeps {
  home: string;
  realpath(path: string): Promise<string>;
  /**
   * Whether `file` carries the xattr `name`; null when the read did not answer (it timed out).
   * Reading an xattr never downloads the file.
   */
  hasXattr(file: string, name: string): Promise<boolean | null>;
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

/**
 * `/usr/bin/xattr -p <name> <file>`: exits 0 only when the attribute is there, 1 when it is not
 * (or the file is missing). A process killed at the timeout did not answer: null.
 */
function hasXattrViaCli(file: string, name: string): Promise<boolean | null> {
  return new Promise((resolve) => {
    execFile("/usr/bin/xattr", ["-p", name, file], { timeout: SYNC_DETECT_TIMEOUT_MS }, (error) =>
      resolve(error?.killed ? null : !error),
    );
  });
}

export const defaultSyncDetectDeps: SyncDetectDeps = {
  home: homedir(),
  realpath: (path) => realpath(path),
  hasXattr: hasXattrViaCli,
  timeoutMs: SYNC_DETECT_TIMEOUT_MS,
};

/**
 * Detect the provider of a workspace folder. Never throws.
 *
 * A step that does not answer (the provider is stalled, which is when a Drive folder is least
 * likely to be recognized) never reads as "not synced": that answer keeps hard links and `.part`
 * files inside the folder, and it is kept until the next launch. It reads as the generic synced
 * folder instead, so the safety rules run (decision 5) and the cost of a wrong guess is a copy
 * where a link would have done. A step that answers "no" is an answer.
 */
export async function detectSync(
  path: string,
  deps: SyncDetectDeps = defaultSyncDetectDeps,
): Promise<SyncProvider | null> {
  if (process.platform !== "darwin" && deps === defaultSyncDetectDeps) return null;
  // `withTimeout` only stops waiting: a `realpath` that hangs keeps running in the thread pool.
  const resolved = await withTimeout<string | typeof NO_ANSWER>(
    deps.realpath(path).catch(() => path), // a path that cannot be resolved is the answer
    deps.timeoutMs,
    NO_ANSWER,
  );
  const known = resolved === NO_ANSWER ? path : resolved;
  const byPath = syncProviderOfPath(known, deps.home) ?? syncProviderOfPath(path, deps.home);
  if (byPath) return byPath;
  // The safety net for a folder the path rule misses (`~/Documents` under iCloud "Desktop &
  // Documents" is unverified; Drive mounted elsewhere). Only Kaipu's own small file is asked.
  const identity = join(path, ".kaipu", "workspace", "identity.json");
  const tagged = await withTimeout<boolean | null>(
    deps.hasXattr(identity, GOOGLE_DRIVE_ITEM_XATTR),
    deps.timeoutMs,
    null,
  );
  if (tagged) return "google-drive";
  if (tagged === null || resolved === NO_ANSWER) {
    console.warn(`[workspaces] could not tell whether "${path}" is synced; treating it as synced`);
    return "cloud-provider";
  }
  return null;
}

const NO_ANSWER = Symbol("no answer");
