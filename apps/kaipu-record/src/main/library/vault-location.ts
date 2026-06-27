import { app } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
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

function read(): StoredPreferences {
  try {
    return JSON.parse(readFileSync(preferencesFile(), "utf-8")) as StoredPreferences;
  } catch {
    return {};
  }
}

function write(preferences: StoredPreferences): void {
  writeFileSync(preferencesFile(), JSON.stringify(preferences, null, 2));
}

/** Platform default: Videos folder + "Kaipu Record". */
export function defaultVaultDirectory(): string {
  try {
    return join(app.getPath("videos"), VAULT_FOLDER);
  } catch {
    return join(homedir(), "Videos", VAULT_FOLDER);
  }
}

/** The configured recordings folder, flagged custom when the user picked one. */
export function vaultDirectory(): VaultDirectory {
  const stored = read().vaultDirectory;
  return stored
    ? { path: stored, isCustom: true }
    : { path: defaultVaultDirectory(), isCustom: false };
}

export function setVaultDirectory(directory: string): void {
  write({ ...read(), vaultDirectory: directory });
}

export function resetVaultDirectory(): void {
  const preferences = read();
  delete preferences.vaultDirectory;
  write(preferences);
}
