import { basename, join } from "node:path";
import { access, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import type { LocalRecording } from "@shared/types/library-storage";

const META_DIR = ".kaipu";
/** Known video containers, in preference order — `.mp4` is what we now write. */
const VIDEO_EXTS = [".mp4", ".webm"] as const;
const IMAGE_EXTS = [".png"] as const;
const ALL_EXTS = [...VIDEO_EXTS, ...IMAGE_EXTS] as const;

interface Sidecar {
  title?: string;
  durationSeconds?: number;
  createdAt?: number;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Local recordings vault. A recording lives as `<id><ext>` (ext ∈ VIDEO_EXTS)
 * with optional sidecar metadata (`.kaipu/<id>.json`) and thumbnail
 * (`.kaipu/<id>.jpg`). The filename *is* the id. Pure: no Electron — the
 * directory is injected so it's testable against a temp folder.
 */
export class LibraryVault {
  constructor(private readonly directory: string) {}

  /** Resolve an id to its real file; if none exists yet, default to `.mp4`. */
  async filePath(id: string): Promise<string> {
    for (const ext of ALL_EXTS) {
      const candidate = join(this.directory, `${id}${ext}`);
      if (await exists(candidate)) return candidate;
    }
    return join(this.directory, `${id}${VIDEO_EXTS[0]}`);
  }

  private metaDirectory(): string {
    return join(this.directory, META_DIR);
  }

  private sidecarPath(id: string): string {
    return join(this.metaDirectory(), `${id}.json`);
  }

  private thumbnailPath(id: string): string {
    return join(this.metaDirectory(), `${id}.jpg`);
  }

  async list(): Promise<LocalRecording[]> {
    await mkdir(this.directory, { recursive: true });
    let entries: string[];
    try {
      entries = await readdir(this.directory);
    } catch {
      return [];
    }
    const ids = entries
      .filter((f) => ALL_EXTS.some((ext) => f.endsWith(ext)))
      .map((f) => basename(f, ALL_EXTS.find((ext) => f.endsWith(ext))!));
    const described = await Promise.all(ids.map((id) => this.describe(id)));
    return described
      .filter((r): r is LocalRecording => r !== null)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async describe(id: string): Promise<LocalRecording | null> {
    const filePath = await this.filePath(id);
    let info;
    try {
      info = await stat(filePath);
    } catch {
      return null;
    }
    const isImage = IMAGE_EXTS.some((ext) => filePath.endsWith(ext));
    const meta = await this.readSidecar(id);
    return {
      id,
      kind: isImage ? "screenshot" : "recording",
      title: meta.title ?? humanizeId(id),
      filePath,
      createdAt: meta.createdAt ?? info.birthtimeMs,
      sizeBytes: info.size,
      durationSeconds: meta.durationSeconds ?? 0,
      thumbnailUrl: isImage
        ? `kaipu-media://screenshot/${id}`
        : (await exists(this.thumbnailPath(id))) ? `kaipu-media://thumb/${id}` : null,
    };
  }

  private async readSidecar(id: string): Promise<Sidecar> {
    try {
      return JSON.parse(await readFile(this.sidecarPath(id), "utf-8")) as Sidecar;
    } catch {
      return {};
    }
  }

  /** Merge fields into the sidecar (used by rename and by finalize). */
  async writeMeta(id: string, meta: Sidecar): Promise<void> {
    const current = await this.readSidecar(id);
    await mkdir(this.metaDirectory(), { recursive: true });
    await writeFile(this.sidecarPath(id), JSON.stringify({ ...current, ...meta }, null, 2));
  }

  async writeThumbnail(id: string, jpg: Buffer): Promise<void> {
    await mkdir(this.metaDirectory(), { recursive: true });
    await writeFile(this.thumbnailPath(id), jpg);
  }

  /** Writes a screenshot PNG as `<id>.png` in the vault root. */
  async writeImage(id: string, png: Buffer): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await writeFile(join(this.directory, `${id}.png`), png);
  }

  /** Updates the user-facing title without touching the video file. */
  async rename(id: string, title: string): Promise<void> {
    await this.writeMeta(id, { title });
  }

  /** Removes the video plus its sidecar and thumbnail (best-effort). */
  async remove(id: string): Promise<void> {
    await Promise.allSettled([
      rm(await this.filePath(id), { force: true }),
      rm(this.sidecarPath(id), { force: true }),
      rm(this.thumbnailPath(id), { force: true }),
    ]);
  }
}

function humanizeId(id: string): string {
  const cleaned = id.replace(/[-_]+/g, " ").trim();
  return cleaned ? cleaned.replace(/\b\w/g, (c) => c.toUpperCase()) : "Recording";
}
