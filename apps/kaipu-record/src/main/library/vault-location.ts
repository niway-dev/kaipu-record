import { app } from "electron";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { VaultDirectory } from "@shared/types";

const VAULT_FOLDER = "Kaipu Record";

interface StoredPreferences {
  vaultDirectory?: string;
}

/** Tiny JSON-file preferences store in userData (no electron-store dependency). */
function preferencesFile(): string {
  return join(app.getPath("userData"), "preferences.json");
}

/**
 * Parsed preferences, remembered per file path. Main is the only writer (the workspace
 * registry, which calls `forgetCachedPreferences` after every write), so `vaultDirectory()`
 * touches disk once per write. Keyed by path so a different userData dir (tests) never sees
 * another dir's value. A file that does not parse reads as `{}` here, the default folder, as
 * before workspaces; the registry refuses to write over it.
 */
let cached: { file: string; preferences: StoredPreferences } | null = null;

function readFromDisk(): StoredPreferences {
  try {
    return JSON.parse(readFileSync(preferencesFile(), "utf-8")) as StoredPreferences;
  } catch {
    return {};
  }
}

function read(): StoredPreferences {
  const file = preferencesFile();
  if (cached?.file !== file) cached = { file, preferences: readFromDisk() };
  return cached.preferences;
}

/**
 * Drop the cached file: the workspace registry just wrote it (`vaultDirectory` mirrors the
 * active workspace's path, ADR 0032), so the next `vaultDirectory()` re-reads.
 */
export function forgetCachedPreferences(): void {
  cached = null;
}

/** Platform default: Videos folder + "Kaipu Record". */
export function defaultVaultDirectory(): string {
  try {
    return join(app.getPath("videos"), VAULT_FOLDER);
  } catch {
    return join(homedir(), "Videos", VAULT_FOLDER);
  }
}

/**
 * The active workspace's folder, flagged custom when it is not the default one. Read from
 * `vaultDirectory`, which the registry keeps equal to the active path on every switch (the
 * same key an older version reads).
 */
export function vaultDirectory(): VaultDirectory {
  const stored = read().vaultDirectory;
  return stored
    ? { path: stored, isCustom: true }
    : { path: defaultVaultDirectory(), isCustom: false };
}
