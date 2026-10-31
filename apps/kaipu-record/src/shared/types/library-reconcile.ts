/**
 * "Check and fix files" (NIW2-561, ADR 0036): what the scan finds and what Fix all did.
 * Pure types — safe to import from main, preload and renderer.
 */

/** Findings Fix all acts on. */
export type FixableFindingKind =
  | "stale-auto-title"
  | "untitled-legacy"
  | "name-mismatch"
  | "missing-sidecar"
  | "missing-media"
  | "orphan-companion";

/** Findings listed for the user and never touched. */
export type ListedFindingKind =
  | "stem-conflict"
  | "shared-companion"
  | "duplicate-identity"
  | "unreadable-record"
  | "not-recognized"
  /** An orphans run whose manifest cannot be read or validated: Fix all does nothing until it is resolved. */
  | "unreadable-orphan-run";

export type ReconcileFindingKind = FixableFindingKind | ListedFindingKind;

export interface ReconcileFinding {
  kind: ReconcileFindingKind;
  /** Whether Fix all acts on it. */
  fixable: boolean;
  /** The file it is about, relative to the vault folder (`Demo.mp4`, `.kaipu/Demo.json`). */
  path: string;
  /** The item's title as stored, when there is one. */
  title?: string;
  /** For renames: the title it will carry after the fix. */
  newTitle?: string;
  /** For renames: the file name it will get (before any ` (2)` a collision may add). */
  newName?: string;
  /** missing-media: what happens to the record. */
  action?: "to-orphans" | "cloud-only";
}

export type ReconcileScanResult =
  | {
      status: "ok";
      findings: ReconcileFinding[];
      fixableCount: number;
      /** Stable key of the listed (unfixable) findings, so a dismissal holds until it changes. */
      listedSignature: string;
    }
  /** Nothing was scanned: a recording or export is using the vault. */
  | { status: "busy"; activity: "recording" | "export" }
  /** Files are being fixed right now. */
  | { status: "maintenance" }
  /** The folder could not be read; nothing counts as missing (F7). */
  | { status: "error"; message: string };

export type ReconcileKeptReason = "locked" | "busy" | "editing" | "taken" | "io" | "shared";

export interface ReconcileReport {
  /** Findings per kind in the first scan. */
  counts: Partial<Record<ReconcileFindingKind, number>>;
  /** Items renamed, retitled, adopted or made cloud-only. */
  fixed: number;
  /** Records and companions moved to the orphans folder. */
  movedToOrphans: number;
  /** Fixable, but left as they were this time (a locked file, an item open in the editor). */
  kept: { path: string; reason: ReconcileKeptReason }[];
  failed: { path: string; error: string }[];
  /** What the final scan still finds (listed findings, plus anything kept or failed). */
  remaining: ReconcileFinding[];
  /** The run's orphans folder, relative to the vault, when anything was moved there. */
  orphansDir: string | null;
  /** The run log, relative to the vault. */
  logPath: string | null;
}

export type ReconcileFixResult =
  | { status: "done"; report: ReconcileReport }
  | { status: "busy"; activity: "recording" | "export" }
  | { status: "cancelled" }
  | { status: "already-running" }
  | { status: "error"; message: string };

/** Sent while Fix all waits for the vault to be idle, then while it works. */
export type ReconcileProgress =
  | { phase: "waiting"; waitingFor: string[] }
  | { phase: "fixing"; done: number; total: number };
