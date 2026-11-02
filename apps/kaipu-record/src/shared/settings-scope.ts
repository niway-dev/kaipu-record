import type { AppSettings } from "./types/ipc";

/**
 * Per-workspace setting overrides (ADR 0034). Type-only imports from the rest of `shared`:
 * this file is reachable from the preload bundle, so every constant here is a literal.
 */

/** The five keys a workspace may override. Every other key, and every shortcut, is app-wide. */
export const OVERRIDABLE_KEYS = [
  "showBrandBadge",
  "uploadMode",
  "recordingQuality",
  "exportQuality",
  "screenshotCopy",
] as const;
export type OverridableKey = (typeof OVERRIDABLE_KEYS)[number];

/**
 * The four that live in the folder (`.kaipu/workspace/settings.json`). `uploadMode` is
 * machine-bound: upload consent never arrives inside a folder.
 */
export const FOLDER_OVERRIDE_KEYS = [
  "showBrandBadge",
  "recordingQuality",
  "exportQuality",
  "screenshotCopy",
] as const;
export type FolderOverrideKey = (typeof FOLDER_OVERRIDE_KEYS)[number];

export type SettingsOverrides = Partial<Pick<AppSettings, OverridableKey>>;

export function isOverridableKey(value: unknown): value is OverridableKey {
  return typeof value === "string" && (OVERRIDABLE_KEYS as readonly string[]).includes(value);
}

/** "all" is the All workspaces level; anything else is a workspace id. */
export type SettingsScope = "all" | (string & {});

/**
 * What the Settings page knows about a workspace's `.kaipu/workspace/settings.json`.
 * - `none`: no file, or no valid entry in it.
 * - `active`: this Mac wrote it or the user confirmed it; its overrides apply.
 * - `pending`: it arrived with the folder or changed since; the All values apply until answered.
 * - `ignored`: the user answered "Ignore" for this exact file.
 * - `unreadable`: it exists and cannot be read; inactive, and nothing is written over it.
 * - `unavailable`: the workspace is not connected, so its file cannot be read or written.
 */
export type FolderOverridesState =
  | "none"
  | "active"
  | "pending"
  | "ignored"
  | "unreadable"
  | "unavailable";

/** The answer to `settings:get-scoped` (ADR 0034, decision 5). */
export interface ScopedSettings {
  scope: SettingsScope;
  /** The persisted All workspaces level. */
  all: AppSettings;
  /** The overrides that are active in this scope (`{}` for "all"). */
  overrides: SettingsOverrides;
  /** The value each row shows: `overrides` over `all` (for "all", the All level itself). */
  effective: AppSettings;
  folder: FolderOverridesState;
  /** The valid entries of a file awaiting an answer (`pending`) or ignored; else `null`. */
  pending: SettingsOverrides | null;
  /**
   * The sha256 of the file `pending` was read from. An answer names it, so "Use them"
   * confirms the file the user saw and not one a sync wrote a moment later.
   */
  folderSha256: string | null;
  /** For the "all" scope: the names of the workspaces that override each key. */
  overriddenIn: Partial<Record<OverridableKey, string[]>>;
}

export type SetOverrideResult =
  | { ok: true; settings: AppSettings }
  | {
      ok: false;
      reason:
        | "unknown-workspace"
        | "not-overridable"
        | "invalid"
        | "unavailable"
        | "pending"
        | "unreadable"
        | "failed";
    };

export type ResolvePendingResult =
  | { ok: true; settings: AppSettings }
  | { ok: false; reason: "unknown-workspace" | "nothing-pending" | "changed" | "failed" };

/** Result of copying values to every workspace. */
export type CopyToAllResult =
  | { ok: true; settings: AppSettings; keptOwn: string[] }
  | {
      ok: false;
      reason: "unknown-workspace" | "not-overridable" | "unavailable" | "unreadable" | "failed";
    };

export type ResetOverridesResult = SetOverrideResult;
