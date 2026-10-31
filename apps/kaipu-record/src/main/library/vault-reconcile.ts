/**
 * "Check and fix files" (NIW2-561, ADR 0036): the scanner, the orphans move, the rename
 * planner and the fix pipeline. Pure Node (no Electron), tested on temp vaults.
 *
 * The file name is the only link between a file and its record: a record belongs to the
 * media file with its stem, and nothing is paired by inode, hash or date. The scanner only
 * reads; it never calls `list()`, `describe()` or `sidecar()`, which mint identities or
 * read failures as `{}`.
 */
import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { lstat, mkdir, readFile, readdir, rename } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
import type {
  FixableFindingKind,
  ReconcileFinding,
  ReconcileFindingKind,
  ReconcileReport,
} from "@shared/types/library-reconcile";
import { atomicWriteFile } from "./atomic-write";
import { placeNoReplace, type Placement } from "./safe-place";
import { defaultCaptureName, type CaptureKind } from "@shared/default-capture-name";
import { fsFold, isVaultOwnedStem } from "./file-stem";
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
  SharedCompanionError,
  type CompanionPaths,
  type RetryPolicy,
  type Sidecar,
  type SidecarRead,
} from "./library-vault";

// ── Old automatic titles (N1) ─────────────────────────────────────────────────

/** Prefixes the app used before ADR 0035 (`Captura` is the Spanish screenshot prefix). */
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
 * True for a title the app generated before ADR 0035: a known prefix, ` — `, then only
 * digits, separators and AM/PM words. Any other word makes it user-written (N12: a user
 * title that looks automatic is replaced; accepted).
 */
export function isStaleAutoTitle(title: string): boolean {
  const match = AUTO_PREFIX.exec(splitEdited(title).base);
  if (!match) return false;
  let rest = match[1]!;
  for (const period of DAY_PERIODS) rest = rest.split(period).join(" ");
  return /\d/.test(rest) && /^[\d\s/.,:-]+$/u.test(rest);
}

/** What `editedTitle` appends to an export's title, once per export of an export. */
const EDITED_SUFFIX = /(?: \((?:edited|editado)\))+$/u;

/** `Recording — 9/14/2026 (edited)` → base `Recording — 9/14/2026`, suffix ` (edited)`. */
function splitEdited(title: string): { base: string; suffix: string } {
  const match = EDITED_SUFFIX.exec(title);
  return match
    ? { base: title.slice(0, match.index), suffix: match[0] }
    : { base: title, suffix: "" };
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
  /** Present media the scan does not treat as an item: symlinks, empty files, uppercase extensions. */
  const ignored: { stem: string; name: string; unrecognized: boolean }[] = [];
  /** fsFold(stem) of present-but-ignored media and other protected stems. */
  const protectedFolds = new Set<string>();
  /** Every stem with something media-shaped in the root, live or not: the owners (M7). */
  const present: string[] = [];
  await mapLimit(rootEntries, READ_CONCURRENCY, async (entry) => {
    const name = entry.name;
    if (name.startsWith(".")) return; // F1
    const ext = extname(name);
    const stem = name.slice(0, name.length - ext.length);
    if (!isPlainItemId(stem)) return;
    if (MEDIA_EXTS.includes(ext.toLowerCase())) present.push(stem);
    if (MEDIA_EXTS.includes(ext.toLowerCase()) && isVaultOwnedStem(stem)) {
      // `tags.mp4`: its record path is the tag registry, which the vault owns. Listed
      // before any read, so nothing adopts, retitles or renames through it.
      protectedFolds.add(fsFold(stem));
      findings.push({ kind: "shared-companion", fixable: false, path: name, stem });
      return;
    }
    if (MEDIA_EXTS.includes(ext)) {
      if (entry.isSymbolicLink()) {
        ignored.push({ stem, name, unrecognized: false }); // F3
        return;
      }
      if (!entry.isFile()) return;
      const info = await lstat(join(directory, name));
      if (info.size === 0) {
        ignored.push({ stem, name, unrecognized: false }); // F5
        return;
      }
      candidates.push({ stem, ext, name, birthtimeMs: info.birthtimeMs, mtimeMs: info.mtimeMs });
    } else if (
      MEDIA_EXTS.includes(ext.toLowerCase()) &&
      (entry.isFile() || entry.isSymbolicLink())
    ) {
      ignored.push({ stem, name, unrecognized: true }); // F4
    }
  });
  for (const media of ignored) protectedFolds.add(fsFold(media.stem));

  // 2. Two media files on one stem (under any case fold), counting the ignored ones: every
  // one of them is listed, and none is adopted, retitled or renamed. `Demo.mp4` next to
  // `Demo.PNG` must not carry the companions both of them own to a new name.
  const byFold = new Map<string, { stem: string; name: string; media?: Media }[]>();
  const inventory = [
    ...candidates.map((media) => ({ stem: media.stem, name: media.name, media })),
    ...ignored,
  ];
  for (const entry of inventory) {
    const key = fsFold(entry.stem);
    byFold.set(key, [...(byFold.get(key) ?? []), entry]);
  }
  const single: Media[] = [];
  for (const [key, group] of byFold) {
    if (group.length === 1) {
      if (group[0]!.media) single.push(group[0]!.media);
      continue;
    }
    protectedFolds.add(key);
    for (const entry of group) {
      findings.push({ kind: "stem-conflict", fixable: false, path: entry.name, stem: entry.stem });
    }
  }
  for (const media of ignored) {
    if (media.unrecognized && byFold.get(fsFold(media.stem))!.length === 1) {
      findings.push({ kind: "not-recognized", fixable: false, path: media.name, stem: media.stem });
    }
  }

  // 3. Each live item's record, read strictly.
  const live: LiveItem[] = await mapLimit(single, READ_CONCURRENCY, async (media) => ({
    ...media,
    read: await readSidecarStrict(vault.sidecarPath(media.stem)),
  }));
  const liveFolds = new Set(live.map((item) => fsFold(item.stem)));

  // Shared companion paths (M7): any potential path two present stems both own. Every
  // owner counts, not only live items: a stem conflict, a symlink, an empty file, an
  // uppercase extension or a vault-owned stem still owns its companions, so a live item
  // sharing one gets no title rewrite, no adoption and no rename. Stems that fold alike
  // are one owner (a stem conflict lists those).
  const owners = new Map<string, Set<string>>();
  for (const stem of present) {
    const paths = [
      ...MEDIA_EXTS.map((ext) => join(directory, `${stem}${ext}`)),
      ...Object.values(vault.companionPaths(stem)),
    ];
    for (const path of paths) {
      const key = fsFold(path);
      owners.set(key, (owners.get(key) ?? new Set()).add(fsFold(stem)));
    }
  }
  /** fsFold(stem) of every owner that shares a path with another owner. */
  const shared = new Set<string>();
  for (const folds of owners.values()) {
    if (folds.size > 1) for (const fold of folds) shared.add(fold);
  }

  const identities = new Map<string, string[]>();
  for (const item of live) {
    if (item.read.status === "ok" && item.read.sidecar.assetId) {
      const id = item.read.sidecar.assetId;
      identities.set(id, [...(identities.get(id) ?? []), item.stem]);
    }
  }
  const liveAssetIds = new Set(identities.keys());

  /**
   * The title each live, readable item ends up with: an old automatic title takes the
   * default name. An export of one is named after its source's (`… (edited)`), as the
   * editor names exports, so source and export still read as a pair.
   */
  const finalTitles = new Map<string, string>();
  for (const item of live) {
    if (item.read.status !== "ok" || !item.read.sidecar.assetId) continue;
    const record = item.read.sidecar;
    const title = typeof record.title === "string" ? record.title : "";
    if (!title.trim() || splitEdited(title).suffix) continue;
    const date = new Date(captureDate(record, item.stem, item));
    finalTitles.set(
      record.assetId!,
      isStaleAutoTitle(title)
        ? defaultCaptureName(kindFromExt(item.ext) as CaptureKind, date)
        : title,
    );
  }

  for (const item of live) {
    const kind = kindFromExt(item.ext);
    const base = { stem: item.stem, ext: item.ext, path: item.name };
    if (shared.has(fsFold(item.stem))) {
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
      const { suffix } = splitEdited(title);
      const source = record.derivedFromAssetId
        ? finalTitles.get(record.derivedFromAssetId)
        : undefined;
      const newTitle = (source ?? defaultCaptureName(kind as CaptureKind, date)) + suffix;
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
  // `.edit.meta.json`) is a companion first, since those stems are reserved (ADR 0035).
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

  // 5. Orphan runs whose manifest cannot be read: Fix all refuses to act until they are fixed.
  for (const path of (await readOrphanRuns(directory)).unreadable) {
    findings.push({ kind: "unreadable-orphan-run", fixable: false, path, stem: "" });
  }

  findings.sort((a, b) => a.path.localeCompare(b.path));
  return { findings };
}

// ── The orphans folder (M3, M4, M6) ───────────────────────────────────────────

const ORPHANS_DIR = "orphans";
const RECONCILE_DIR = "reconcile";

interface ManifestFile {
  /** Vault-relative original path (`.kaipu/Gone.json`). */
  from: string;
  /** Path inside the run folder (`Gone.json`): the layout under `.kaipu/` is kept. */
  to: string;
  state?: "moved" | "conflict" | "missing" | "failed";
}

interface ManifestEntry {
  kind: ReconcileFindingKind;
  stem: string;
  title?: string;
  assetId?: string;
  status: "pending" | "complete";
  files: ManifestFile[];
}

interface Manifest {
  version: 1;
  runId: string;
  createdAt?: number;
  entries: ManifestEntry[];
}

/**
 * Whether a path is there. Only ENOENT (or ENOTDIR) means absent: any other error (EIO,
 * EACCES, a dropped network drive) is `unknown`, never read as absence, because absence
 * leads to a move onto that path.
 */
export async function pathState(path: string): Promise<"present" | "absent" | "unknown"> {
  try {
    await lstat(path);
    return "present";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? "absent" : "unknown";
  }
}

/**
 * One run's orphans folder, `.kaipu/orphans/<timestamp>-<uuid>/`, created exclusively on
 * the first move. Each bundle's manifest entry is written before its first file moves and
 * marked complete after the last; a destination is never overwritten.
 */
class OrphanRun {
  private folder: string | null = null;
  private manifest: Manifest | null = null;

  constructor(
    private readonly directory: string,
    private readonly now: () => number,
  ) {}

  /** Vault-relative path of the run folder, or null when nothing moved. */
  get relativeDir(): string | null {
    return this.folder ? `${META_DIR}/${ORPHANS_DIR}/${basename(this.folder)}` : null;
  }

  private async open(): Promise<{ folder: string; manifest: Manifest }> {
    if (this.folder && this.manifest) return { folder: this.folder, manifest: this.manifest };
    const parent = join(this.directory, META_DIR, ORPHANS_DIR);
    await mkdir(parent, { recursive: true });
    const runId = `${new Date(this.now()).toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
    const folder = join(parent, runId);
    await mkdir(folder); // exclusive on the leaf: two runs never share a folder (M6)
    this.folder = folder;
    this.manifest = { version: 1, runId, createdAt: this.now(), entries: [] };
    return { folder, manifest: this.manifest };
  }

  /** Move a bundle; resolves how many files moved. Throws only when the manifest cannot be written. */
  async move(finding: ScanFinding): Promise<{ moved: number; problems: string[] }> {
    const { folder, manifest } = await this.open();
    const entry: ManifestEntry = {
      kind: finding.kind,
      stem: finding.stem,
      title: finding.title,
      assetId: finding.assetId,
      status: "pending",
      files: (finding.files ?? []).map((from) => ({ from, to: from.slice(META_DIR.length + 1) })),
    };
    manifest.entries.push(entry);
    await writeManifest(folder, manifest);
    const { moved, problems } = await moveFiles(this.directory, folder, entry);
    // A file that did not move keeps the entry pending: the next run finishes this bundle
    // here, instead of classifying the leftover again into another one.
    if (isEntryComplete(entry)) entry.status = "complete";
    await writeManifest(folder, manifest);
    return { moved, problems };
  }
}

/** Every file of the entry is settled (moved, missing or in conflict); none still to retry. */
function isEntryComplete(entry: ManifestEntry): boolean {
  return entry.files.every((file) => file.state !== undefined && file.state !== "failed");
}

async function writeManifest(folder: string, manifest: Manifest): Promise<void> {
  await atomicWriteFile(join(folder, "manifest.json"), JSON.stringify(manifest, null, 2));
}

/**
 * Move an entry's files that have not moved yet. A destination that exists means that move
 * happened: it is kept, and a source present again at the old path (a new capture that
 * reused the free stem) is not taken (`conflict`). A path that cannot be checked leaves
 * both files where they are (`failed`): the entry stays pending for the next run.
 */
async function moveFiles(
  directory: string,
  folder: string,
  entry: ManifestEntry,
): Promise<{ moved: number; problems: string[] }> {
  let moved = 0;
  const problems: string[] = [];
  for (const file of entry.files) {
    if (file.state === "moved" || file.state === "conflict") continue;
    const from = join(directory, file.from);
    const to = join(folder, file.to);
    const [source, destination] = await Promise.all([pathState(from), pathState(to)]);
    if (source === "unknown" || destination === "unknown") {
      file.state = "failed";
      problems.push(file.from);
      continue;
    }
    if (destination === "present") {
      file.state = source === "present" ? "conflict" : "moved";
      if (source === "present") problems.push(file.from);
      continue;
    }
    if (source === "absent") {
      file.state = "missing";
      continue;
    }
    try {
      await mkdir(dirname(to), { recursive: true });
      if ((await moveIntoRun(from, to)) === "taken") {
        // Arrived since the check: kept, and the source stays (as for a present destination).
        file.state = "conflict";
        problems.push(file.from);
        continue;
      }
      file.state = "moved";
      moved += 1;
    } catch {
      file.state = "failed";
      problems.push(file.from);
    }
  }
  return { moved, problems };
}

/**
 * Move one orphan path into the run folder without replacing anything there: a file through
 * `safe-place` (a source that cannot be removed undoes the move). A folder (`.assets`) or a
 * symlink is renamed as itself (a link or copy would follow it); the destination was checked
 * absent in this run's own folder, which no other process names.
 */
async function moveIntoRun(from: string, to: string): Promise<Placement> {
  if (!(await lstat(from)).isFile()) {
    await rename(from, to);
    return "placed";
  }
  return placeNoReplace(from, to, { stuck: "rollback" });
}

/** A run folder's manifest that passes the schema the replay relies on. */
function isManifest(value: unknown): value is Manifest {
  const manifest = value as Manifest | null;
  return (
    typeof manifest === "object" &&
    manifest !== null &&
    manifest.version === 1 &&
    Array.isArray(manifest.entries) &&
    manifest.entries.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof entry.stem === "string" &&
        (entry.status === "pending" || entry.status === "complete") &&
        Array.isArray(entry.files) &&
        entry.files.every(
          (file) =>
            typeof file === "object" &&
            file !== null &&
            typeof file.from === "string" &&
            typeof file.to === "string",
        ),
    )
  );
}

/**
 * Every orphan run's manifest, read strictly. A run folder without a manifest (a run that
 * crashed before its first move) and a stray file are no runs. A manifest that exists but
 * cannot be read or validated is `unreadable` (vault-relative path): that run's remaining
 * files are unknown, so nothing may be classified around them.
 */
async function readOrphanRuns(
  directory: string,
): Promise<{ runs: { folder: string; manifest: Manifest }[]; unreadable: string[] }> {
  const parent = join(directory, META_DIR, ORPHANS_DIR);
  let names: string[];
  try {
    names = await readdir(parent);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { runs: [], unreadable: [] };
    throw error;
  }
  const runs: { folder: string; manifest: Manifest }[] = [];
  const unreadable: string[] = [];
  for (const run of names.sort()) {
    const folder = join(parent, run);
    let raw: string;
    try {
      raw = await readFile(join(folder, "manifest.json"), "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") continue;
      unreadable.push(`${META_DIR}/${ORPHANS_DIR}/${run}/manifest.json`);
      continue;
    }
    let manifest: unknown;
    try {
      manifest = JSON.parse(raw);
    } catch {
      manifest = null;
    }
    if (isManifest(manifest)) runs.push({ folder, manifest });
    else unreadable.push(`${META_DIR}/${ORPHANS_DIR}/${run}/manifest.json`);
  }
  return { runs, unreadable };
}

/**
 * Complete every pending manifest entry a crashed run left, into that run's own folder.
 * Runs before classification, so a half-moved bundle is never classified again. `held`
 * lists the files of entries still pending afterwards: they belong to that entry, and only
 * its replay moves them (the caller keeps them out of a fresh classification). When any
 * run's manifest is `unreadable`, nothing is replayed and the caller must not act at all.
 */
export async function resumeOrphanManifests(directory: string): Promise<{
  moved: number;
  conflicts: string[];
  failed: string[];
  held: string[];
  unreadable: string[];
}> {
  const { runs, unreadable } = await readOrphanRuns(directory);
  let moved = 0;
  const conflicts: string[] = [];
  const failed: string[] = [];
  const held: string[] = [];
  if (unreadable.length > 0) return { moved, conflicts, failed, held, unreadable };
  for (const { folder, manifest } of runs) {
    const pending = manifest.entries.filter((entry) => entry.status === "pending");
    if (pending.length === 0) continue;
    for (const entry of pending) {
      const result = await moveFiles(directory, folder, entry);
      moved += result.moved;
      for (const path of result.problems) {
        const state = entry.files.find((f) => f.from === path)?.state;
        (state === "conflict" ? conflicts : failed).push(path);
      }
      if (isEntryComplete(entry)) entry.status = "complete";
      // A file in conflict is a new owner's (a capture reused the free path): not held.
      else for (const file of entry.files) if (file.state !== "conflict") held.push(file.from);
    }
    await writeManifest(folder, manifest);
  }
  return { moved, conflicts, failed, held, unreadable };
}

// ── The fix pipeline ──────────────────────────────────────────────────────────

export interface FixOptions {
  cloud: ReadonlySet<string> | "unknown";
  /** The item is open in the video editor: its file keeps its name (C2). */
  isEditing?: (id: string, assetId: string) => boolean;
  /** An export may be streaming a file (never true in maintenance mode; kept for safety). */
  isBusy?: () => boolean;
  retry?: RetryPolicy;
  now?: () => number;
  onProgress?: (done: number, total: number) => void;
}

interface Planned {
  finding: ScanFinding;
  title: string;
  base: string;
}

/**
 * "Fix all" (ADR 0036). The caller holds maintenance mode. Each action is safe on its own,
 * so there is no journal: a crash leaves something the next run sees and finishes.
 *
 * 1. Pending orphan manifests are completed.
 * 2. Scan: dead records and ownerless companions to orphans (or cloud-only), adoption,
 *    title rewrites.
 * 3. Scan again and rename from that inventory, in planner order (N10).
 * 4. Scan again: anything fixable left is reported, never retried in a loop.
 */
export async function fixVault(directory: string, options: FixOptions): Promise<ReconcileReport> {
  const now = options.now ?? Date.now;
  const vault = new LibraryVault(directory);
  const orphans = new OrphanRun(directory, now);
  const report: ReconcileReport = {
    counts: {},
    fixed: 0,
    movedToOrphans: 0,
    kept: [],
    failed: [],
    remaining: [],
    orphansDir: null,
    logPath: null,
  };
  const fail = (path: string, error: unknown): void => {
    report.failed.push({ path, error: error instanceof Error ? error.message : String(error) });
  };

  const resumed = await resumeOrphanManifests(directory);
  if (resumed.unreadable.length > 0) {
    // Fail closed: that run's files are unknown, so any move, adoption or rename could split
    // its bundle or take one of its files. Listed until someone repairs or removes it.
    const scan = (await scanVault({ directory, cloud: options.cloud })).findings;
    for (const finding of scan) {
      report.counts[finding.kind] = (report.counts[finding.kind] ?? 0) + 1;
    }
    for (const path of resumed.unreadable) {
      fail(path, "orphan run manifest unreadable: the run needs attention, nothing was fixed");
    }
    report.remaining = scan.map(publicFinding);
    report.logPath = await writeRunLog(directory, now, report);
    return report;
  }
  report.movedToOrphans += resumed.moved;
  for (const path of [...resumed.conflicts, ...resumed.failed])
    fail(path, "orphan move left in place");
  // A file an unfinished orphan bundle still holds waits for that bundle's replay: classified
  // afresh, it would land in this run's folder and split the bundle in two.
  // Every mutation checks the item's whole path set (its media, every companion of its stem,
  // and for a rename those of its new stem too), not only the finding's own path.
  const held = new Set(resumed.held.map(fsFold));
  const stemPaths = (stem: string): string[] => [
    ...MEDIA_EXTS.map((ext) => `${stem}${ext}`),
    ...Object.values(vault.companionPaths(stem)).map((path) => relative(directory, path)),
  ];
  const heldBy = (finding: ScanFinding, ...stems: string[]): string | undefined =>
    [finding.path, ...(finding.files ?? []), ...[finding.stem, ...stems].flatMap(stemPaths)].find(
      (path) => held.has(fsFold(path)),
    );
  const failHeld = (finding: ScanFinding, path: string): void => {
    if (!report.failed.some((f) => f.path === finding.path)) {
      fail(finding.path, `pending orphan move: ${path} waits for its original bundle`);
    }
  };

  // 2. The first actions.
  const first = (await scanVault({ directory, cloud: options.cloud })).findings;
  for (const finding of first) report.counts[finding.kind] = (report.counts[finding.kind] ?? 0) + 1;
  const actions = first.filter((f) => f.fixable && f.kind !== "name-mismatch");
  let done = 0;
  let total = first.filter((f) => f.fixable).length;
  const step = (): void => options.onProgress?.(++done, Math.max(total, done));
  options.onProgress?.(0, total);

  const order: ReconcileFindingKind[] = [
    "missing-media",
    "orphan-companion",
    "missing-sidecar",
    "stale-auto-title",
    "untitled-legacy",
  ];
  actions.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  for (const finding of actions) {
    const pending = heldBy(finding);
    if (pending !== undefined) {
      failHeld(finding, pending);
      step();
      continue;
    }
    try {
      if (finding.kind === "missing-media" && finding.action === "cloud-only") {
        await vault.writeMeta(finding.stem, { localRemovedAt: now() });
        report.fixed += 1;
      } else if (finding.kind === "missing-media" || finding.kind === "orphan-companion") {
        const { moved, problems } = await orphans.move(finding);
        report.movedToOrphans += moved;
        for (const path of problems) fail(path, "could not be moved to the orphans folder");
      } else if (finding.kind === "missing-sidecar") {
        if (
          await vault.adoptMedia(finding.stem, {
            title: finding.newTitle!,
            createdAt: finding.createdAt!,
          })
        ) {
          report.fixed += 1;
        }
      } else {
        // stale-auto-title, untitled-legacy: the title first; the rename below aligns it.
        await vault.writeMeta(finding.stem, { title: finding.newTitle! });
        report.fixed += 1;
      }
    } catch (error) {
      fail(finding.path, error);
    }
    step();
  }

  // 3. Renames, planned from a fresh inventory: an adopted `Ａ.mp4` is titled `Ａ`, whose
  // stem is `A`; a retitled item now differs from its stem.
  const second = (await scanVault({ directory, cloud: options.cloud })).findings;
  // Items already counted in step 2 (retitled or adopted) are not counted again.
  const retitled = new Set(
    actions
      .filter((f) => ["stale-auto-title", "untitled-legacy", "missing-sidecar"].includes(f.kind))
      .map((f) => f.stem),
  );
  const renames = second.filter((f) => f.kind === "name-mismatch");
  total = done + renames.length;
  const plan: Planned[] = renames.map((finding) => ({
    finding,
    title: finding.newTitle!,
    base: alignedBase(finding.newTitle!, kindFromExt(finding.ext!), new Date(finding.createdAt!)),
  }));
  const free: Planned[] = [];
  for (const item of plan) {
    const pending = heldBy(item.finding, item.base);
    if (pending === undefined) {
      free.push(item);
      continue;
    }
    failHeld(item.finding, pending);
    step();
  }
  await runPlan(vault, free, options, report, (finding, renamed) => {
    // A retitled item was counted when its title was written.
    if (renamed && !retitled.has(finding.stem)) report.fixed += 1;
    step();
  });

  // 4. What is left.
  const third = (await scanVault({ directory, cloud: options.cloud })).findings;
  report.remaining = third.map(publicFinding);
  const explained = new Set([
    ...report.kept.map((k) => k.path),
    ...report.failed.map((f) => f.path),
  ]);
  for (const finding of third) {
    if (!finding.fixable || explained.has(finding.path)) continue;
    console.error("[reconcile] still fixable after Fix all", finding.kind, finding.path);
    fail(finding.path, `still ${finding.kind} after the fix`);
  }
  report.orphansDir = orphans.relativeDir;
  report.logPath = await writeRunLog(directory, now, report);
  return report;
}

/** The renderer's view of a finding (no internal fields). */
export function publicFinding(finding: ScanFinding): ReconcileFinding {
  const { kind, fixable, path, title, newTitle, newName, action } = finding;
  return { kind, fixable, path, title, newTitle, newName, action };
}

/**
 * The planner (N10): move every item whose base is free, repeat until nothing moves (each
 * move frees a name), then let the items that still wait take the first free suffix —
 * those waiting on a name nobody pending holds first, else the first in order (a cycle).
 * Order: capture date, then stem (N6). Only `renameItem`, never a temporary name.
 */
async function runPlan(
  vault: LibraryVault,
  plan: Planned[],
  options: FixOptions,
  report: ReconcileReport,
  onRenamed: (finding: ScanFinding, renamed: boolean) => void,
): Promise<void> {
  const pending = [...plan].sort(
    (a, b) =>
      a.finding.createdAt! - b.finding.createdAt! || a.finding.stem.localeCompare(b.finding.stem),
  );
  const rename = async (item: Planned): Promise<void> => {
    pending.splice(pending.indexOf(item), 1);
    const { finding } = item;
    let renamed = false;
    try {
      // Reconcile mints an identity only on items it is fixing (I2).
      const assetId = finding.assetId ?? (await vault.describe(finding.stem))?.assetId;
      if (!assetId) throw new Error("the item is gone");
      const result = await vault.renameItem({ id: finding.stem, assetId }, item.title, {
        allowLeftover: false,
        refuseSharedCompanions: true,
        isEditing: options.isEditing,
        isBusy: options.isBusy,
        retry: options.retry,
      });
      if (result.file === "kept-old-name") {
        report.kept.push({ path: finding.path, reason: result.reason ?? "io" });
      } else {
        renamed = true;
      }
    } catch (error) {
      if (error instanceof SharedCompanionError) {
        report.kept.push({ path: finding.path, reason: "shared" });
      } else {
        report.failed.push({
          path: finding.path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    onRenamed(finding, renamed);
  };

  while (pending.length > 0) {
    let moved = false;
    // A copy: `rename` removes items from `pending` while this loop runs.
    for (const item of pending.slice()) {
      const self = fsFold(item.base) === fsFold(item.finding.stem);
      // A name that cannot be checked is not free; `rename` reports it at the end.
      if (self || (await vault.isStemFree(item.base).catch(() => false))) {
        await rename(item);
        moved = true;
      }
    }
    if (moved) continue;
    const waitingOn = new Set(pending.map((item) => fsFold(item.finding.stem)));
    const blocked = pending.filter((item) => !waitingOn.has(fsFold(item.base)));
    for (const item of blocked.length > 0 ? blocked : [pending[0]!]) await rename(item);
  }
}

/** `.kaipu/reconcile/<timestamp>-<id>.json`, best effort. */
async function writeRunLog(
  directory: string,
  now: () => number,
  report: ReconcileReport,
): Promise<string | null> {
  try {
    const folder = join(directory, META_DIR, RECONCILE_DIR);
    await mkdir(folder, { recursive: true });
    const name = `${new Date(now()).toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.json`;
    await atomicWriteFile(join(folder, name), JSON.stringify(report, null, 2));
    return `${META_DIR}/${RECONCILE_DIR}/${name}`;
  } catch (error) {
    console.error("[reconcile] could not write the run log", error);
    return null;
  }
}
