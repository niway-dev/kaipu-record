/**
 * "Check and fix files" (NIW2-561, ADR 0033): the scanner, the orphans move, the rename
 * planner and the fix pipeline. Pure Node (no Electron), tested on temp vaults.
 *
 * The file name is the only link between a file and its record: a record belongs to the
 * media file with its stem, and nothing is paired by inode, hash or date. The scanner only
 * reads; it never calls `list()`, `describe()` or `sidecar()`, which mint identities or
 * read failures as `{}`.
 */
import type { Dirent } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import type {
  FixableFindingKind,
  ReconcileFinding,
  ReconcileFindingKind,
} from "@shared/types/library-reconcile";
import { defaultCaptureName, type CaptureKind } from "@shared/default-capture-name";
import { fsFold } from "./file-stem";
import {
  LEGACY_STEM,
  LibraryVault,
  MEDIA_EXTS,
  META_DIR,
  alignedBase,
  captureDate,
  humanizeId,
  isAligned,
  isPlainItemId,
  kindFromExt,
  readSidecarStrict,
  type CompanionPaths,
  type Sidecar,
  type SidecarRead,
} from "./library-vault";

// ── Old automatic titles (N1) ─────────────────────────────────────────────────

/** Prefixes the app used before ADR 0032 (`Captura` is the Spanish screenshot prefix). */
const AUTO_PREFIX = /^(?:Recording|Screenshot|Pasted image|Imagen pegada|Captura) — (.+)$/su;
/** AM/PM words `toLocaleString()` produces, longest first. */
const DAY_PERIODS = [
  "a. m.",
  "p. m.",
  "a.m.",
  "p.m.",
  "AM",
  "PM",
  "am",
  "pm",
  "오전",
  "오후",
  "午前",
  "午後",
  "上午",
  "下午",
];

/**
 * True for a title the app generated before ADR 0032: a known prefix, ` — `, then only
 * digits, separators and AM/PM words. Any other word makes it user-written (N12: a user
 * title that looks automatic is replaced; accepted).
 */
export function isStaleAutoTitle(title: string): boolean {
  const match = AUTO_PREFIX.exec(title);
  if (!match) return false;
  let rest = match[1]!;
  for (const period of DAY_PERIODS) rest = rest.split(period).join(" ");
  return /\d/.test(rest) && /^[\d\s/.,:-]+$/u.test(rest);
}

// ── The scan ──────────────────────────────────────────────────────────────────

/** The fixable kinds; everything else is listed and left alone. */
const FIXABLE: ReadonlySet<ReconcileFindingKind> = new Set<FixableFindingKind>([
  "stale-auto-title",
  "untitled-legacy",
  "name-mismatch",
  "missing-sidecar",
  "missing-media",
  "orphan-companion",
]);

export function isFixable(kind: ReconcileFindingKind): boolean {
  return FIXABLE.has(kind);
}

/** A finding plus what the fix needs. Paths are relative to the vault folder. */
export interface ScanFinding extends ReconcileFinding {
  /** The item's stem (live items, dead records) or the companion's owner stem. */
  stem: string;
  /** Live items: the media extension. */
  ext?: string;
  assetId?: string;
  /** Live items: the capture date (N4), epoch ms. */
  createdAt?: number;
  /** missing-media / orphan-companion: every path that moves to orphans, record last. */
  files?: string[];
}

export interface ScanInput {
  directory: string;
  /** Identities in the cached cloud catalog, or "unknown" (signed out). */
  cloud: ReadonlySet<string> | "unknown";
}

export interface VaultScan {
  findings: ScanFinding[];
}

/** `.kaipu/` entries the vault or the OS owns, never touched (M5). */
const META_ALLOWLIST = new Set(["tags.json", "reconcile", "orphans", "drag", "tmp"]);

/** Companion roles a `.kaipu/` name can play, longest suffix first. */
const COMPANION_SUFFIXES: { suffix: string; role: keyof CompanionPaths }[] = [
  { suffix: ".edit.meta.json", role: "editMeta" },
  { suffix: ".edit.json", role: "editSession" },
  { suffix: ".cursor.json", role: "cursorTrack" },
  { suffix: ".json", role: "sidecar" },
  { suffix: ".jpg", role: "thumbnail" },
];

interface Interpretation {
  stem: string;
  role: keyof CompanionPaths;
}

/** Every (stem, role) a `.kaipu/` entry could be: `Demo.edit.json` is both Demo's session and Demo.edit's record. */
function interpretations(name: string, isDirectory: boolean): Interpretation[] {
  if (isDirectory) {
    return name.endsWith(".assets")
      ? [{ stem: name.slice(0, -".assets".length), role: "assetsDir" as const }].filter((i) =>
          isPlainItemId(i.stem),
        )
      : [];
  }
  return COMPANION_SUFFIXES.filter(({ suffix }) => name.endsWith(suffix))
    .map(({ suffix, role }) => ({ stem: name.slice(0, -suffix.length), role }))
    .filter((i) => isPlainItemId(i.stem));
}

/** Map with a concurrency limit, for slow network drives (F8). */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const READ_CONCURRENCY = 32;
const meta = (name: string): string => `${META_DIR}/${name}`;

interface Media {
  stem: string;
  ext: string;
  name: string;
  birthtimeMs: number;
  mtimeMs: number;
}

interface LiveItem extends Media {
  read: SidecarRead;
}

/**
 * Read the vault and report every disagreement between the folder and the library.
 * Never writes. A folder that cannot be read rejects: an unreadable folder is never read
 * as an empty one (F7).
 */
export async function scanVault(input: ScanInput): Promise<VaultScan> {
  const { directory } = input;
  const vault = new LibraryVault(directory);
  const findings: ScanFinding[] = [];

  // 1. The vault root: media candidates, and stems whose companions are protected.
  const rootEntries = await readdir(directory, { withFileTypes: true });
  const candidates: Media[] = [];
  /** fsFold(stem) of present-but-ignored media: symlinks, empty files, uppercase extensions. */
  const protectedFolds = new Set<string>();
  await mapLimit(rootEntries, READ_CONCURRENCY, async (entry) => {
    const name = entry.name;
    if (name.startsWith(".")) return; // F1
    const ext = extname(name);
    const stem = name.slice(0, name.length - ext.length);
    if (!isPlainItemId(stem)) return;
    if (MEDIA_EXTS.includes(ext)) {
      if (entry.isSymbolicLink()) {
        protectedFolds.add(fsFold(stem)); // F3
        return;
      }
      if (!entry.isFile()) return;
      const info = await lstat(join(directory, name));
      if (info.size === 0) {
        protectedFolds.add(fsFold(stem)); // F5
        return;
      }
      candidates.push({ stem, ext, name, birthtimeMs: info.birthtimeMs, mtimeMs: info.mtimeMs });
    } else if (
      MEDIA_EXTS.includes(ext.toLowerCase()) &&
      (entry.isFile() || entry.isSymbolicLink())
    ) {
      protectedFolds.add(fsFold(stem)); // F4
      findings.push({ kind: "not-recognized", fixable: false, path: name, stem });
    }
  });

  // 2. Two media files on one stem (under any case fold): listed, companions protected.
  const byFold = new Map<string, Media[]>();
  for (const media of candidates) {
    const key = fsFold(media.stem);
    byFold.set(key, [...(byFold.get(key) ?? []), media]);
  }
  const single: Media[] = [];
  for (const [key, group] of byFold) {
    if (group.length === 1) {
      single.push(group[0]!);
      continue;
    }
    protectedFolds.add(key);
    for (const media of group) {
      findings.push({ kind: "stem-conflict", fixable: false, path: media.name, stem: media.stem });
    }
  }

  // 3. Each live item's record, read strictly.
  const live: LiveItem[] = await mapLimit(single, READ_CONCURRENCY, async (media) => ({
    ...media,
    read: await readSidecarStrict(vault.sidecarPath(media.stem)),
  }));
  const liveFolds = new Set(live.map((item) => fsFold(item.stem)));

  // Shared companion paths (M7): any potential path two live items both own.
  const owners = new Map<string, Set<string>>();
  for (const item of live) {
    const paths = [
      ...MEDIA_EXTS.map((ext) => join(directory, `${item.stem}${ext}`)),
      ...Object.values(vault.companionPaths(item.stem)),
    ];
    for (const path of paths) {
      const key = fsFold(path);
      owners.set(key, (owners.get(key) ?? new Set()).add(item.stem));
    }
  }
  const shared = new Set<string>();
  for (const stems of owners.values()) {
    if (stems.size > 1) for (const stem of stems) shared.add(stem);
  }

  const identities = new Map<string, string[]>();
  for (const item of live) {
    if (item.read.status === "ok" && item.read.sidecar.assetId) {
      const id = item.read.sidecar.assetId;
      identities.set(id, [...(identities.get(id) ?? []), item.stem]);
    }
  }
  const liveAssetIds = new Set(identities.keys());

  for (const item of live) {
    const kind = kindFromExt(item.ext);
    const base = { stem: item.stem, ext: item.ext, path: item.name };
    if (shared.has(item.stem)) {
      findings.push({ ...base, kind: "shared-companion", fixable: false });
      continue;
    }
    const { read } = item;
    if (read.status !== "ok" && read.status !== "missing") {
      findings.push({
        ...base,
        kind: "unreadable-record",
        fixable: false,
        path: meta(`${item.stem}.json`),
      });
      continue;
    }
    const record: Sidecar = read.status === "ok" ? read.sidecar : {};
    const createdAt = captureDate(record, item.stem, item);
    const withDate = { ...base, createdAt, assetId: record.assetId };
    if (read.status === "missing") {
      // A file with no record becomes a new item under its disk name; a legacy writer
      // stem reads as its default name, as an untitled legacy item does.
      const newTitle = LEGACY_STEM.test(item.stem) ? humanizeId(item.stem) : item.stem;
      findings.push({ ...withDate, kind: "missing-sidecar", fixable: true, newTitle });
      continue;
    }
    if (record.assetId && (identities.get(record.assetId)?.length ?? 0) > 1) {
      findings.push({
        ...withDate,
        kind: "duplicate-identity",
        fixable: false,
        title: record.title,
      });
      continue;
    }
    const date = new Date(createdAt);
    const title =
      typeof record.title === "string" && record.title.trim() ? record.title : undefined;
    const rename = (newTitle: string): Pick<ScanFinding, "newTitle" | "newName"> => ({
      newTitle,
      newName: `${alignedBase(newTitle, kind, date)}${item.ext}`,
    });
    if (title === undefined) {
      if (LEGACY_STEM.test(item.stem)) {
        findings.push({
          ...withDate,
          kind: "untitled-legacy",
          fixable: true,
          ...rename(humanizeId(item.stem)),
        });
      } else if (!isAligned(item.stem, humanizeId(item.stem), kind, date)) {
        findings.push({
          ...withDate,
          kind: "name-mismatch",
          fixable: true,
          ...rename(humanizeId(item.stem)),
        });
      }
      continue;
    }
    if (isStaleAutoTitle(title)) {
      const newTitle = defaultCaptureName(kind as CaptureKind, date);
      findings.push({
        ...withDate,
        kind: "stale-auto-title",
        fixable: true,
        title,
        ...rename(newTitle),
      });
    } else if (!isAligned(item.stem, title, kind, date)) {
      findings.push({ ...withDate, kind: "name-mismatch", fixable: true, title, ...rename(title) });
    }
  }

  // 4. `.kaipu/`: dead records and companions without an owner.
  let metaEntries: Dirent[] = [];
  try {
    metaEntries = await readdir(join(directory, META_DIR), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const isOwned = (stems: string[]): boolean =>
    stems.some((stem) => liveFolds.has(fsFold(stem)) || protectedFolds.has(fsFold(stem)));

  interface Entry {
    name: string;
    found: Interpretation[];
  }
  const ownerless: Entry[] = [];
  for (const entry of metaEntries) {
    const name = entry.name;
    if (name.startsWith(".") || META_ALLOWLIST.has(name)) continue;
    if (name.endsWith(".tmp") || name.endsWith(".part")) continue; // M5, F5
    const found = interpretations(name, entry.isDirectory());
    if (found.length === 0) continue; // an unknown name: never touched
    if (!entry.isDirectory() && !entry.isFile()) continue;
    if (isOwned(found.map((i) => i.stem))) continue;
    ownerless.push({ name, found });
  }

  // A plain `<stem>.json` is a record; a companion-shaped one (`.edit.json`, `.cursor.json`,
  // `.edit.meta.json`) is a companion first, since those stems are reserved (ADR 0032).
  const isRecordName = (entry: Entry): boolean =>
    entry.found.length === 1 && entry.found[0]!.role === "sidecar";
  const records = ownerless.filter(isRecordName);
  const reads = await mapLimit(records, READ_CONCURRENCY, (entry) =>
    readSidecarStrict(join(directory, META_DIR, entry.name)),
  );

  /** Stems whose companions stay where they are (cloud-only, unreadable records). */
  const keptFolds = new Set<string>();
  /** Stems whose bundle moves to orphans, with their findings. */
  const bundles = new Map<string, ScanFinding>();
  records.forEach((entry, index) => {
    const stem = entry.found[0]!.stem;
    const read = reads[index]!;
    const path = meta(entry.name);
    if (read.status === "missing") return; // gone since the readdir
    if (read.status !== "ok") {
      keptFolds.add(fsFold(stem));
      findings.push({ kind: "unreadable-record", fixable: false, path, stem });
      return;
    }
    const record = read.sidecar;
    if (typeof record.localRemovedAt === "number") {
      keptFolds.add(fsFold(stem)); // M1: never touched
      return;
    }
    const title = typeof record.title === "string" ? record.title : undefined;
    const assetId = record.assetId;
    // Remnants of a committed rename first, so a crash mid-rename never turns its
    // remnant into a cloud-only record that keeps the name taken.
    const remnant = assetId !== undefined && liveAssetIds.has(assetId);
    if (!remnant && assetId && input.cloud !== "unknown" && input.cloud.has(assetId)) {
      keptFolds.add(fsFold(stem)); // M2: its companions stay with it
      findings.push({
        kind: "missing-media",
        fixable: true,
        path,
        stem,
        title,
        assetId,
        action: "cloud-only",
      });
      return;
    }
    const finding: ScanFinding = {
      kind: "missing-media",
      fixable: true,
      path,
      stem,
      title,
      assetId,
      action: "to-orphans",
      files: [],
    };
    bundles.set(fsFold(stem), finding);
    findings.push(finding);
  });

  const companions = new Map<string, ScanFinding>();
  for (const entry of ownerless) {
    if (isRecordName(entry)) continue;
    const folds = entry.found.map((i) => fsFold(i.stem));
    if (folds.some((fold) => keptFolds.has(fold))) continue;
    const bundle = folds.map((fold) => bundles.get(fold)).find(Boolean);
    if (bundle) {
      bundle.files!.push(meta(entry.name));
      continue;
    }
    // Grouped by the stem it most likely belongs to (the companion role, not the record).
    const owner = entry.found[0]!.stem;
    const key = fsFold(owner);
    let finding = companions.get(key);
    if (!finding) {
      finding = {
        kind: "orphan-companion",
        fixable: true,
        path: meta(entry.name),
        stem: owner,
        action: "to-orphans",
        files: [],
      };
      companions.set(key, finding);
      findings.push(finding);
    }
    finding.files!.push(meta(entry.name));
  }
  // The record moves last: a crash mid-move leaves a record with fewer companions, never
  // companions without their record.
  for (const finding of bundles.values()) finding.files!.push(finding.path);

  findings.sort((a, b) => a.path.localeCompare(b.path));
  return { findings };
}
