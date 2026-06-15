import { basename, join } from "node:path";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import type { LocalRecording } from "@shared/types/library-storage";

const META_DIR = ".kaipu";
const VIDEO_EXT = ".webm";

interface Sidecar {
  title?: string;
  durationSeconds?: number;
  createdAt?: number;
}

/**
 * Local recordings vault. Recordings live as `<id>.webm` in `directory`, with
 * optional sidecar metadata (`.kaipu/<id>.json`) for fields the filesystem can't
 * carry (title, duration). Everything else — created date, size — is read from
 * the file. Deliberately simple: the filename *is* the id.
 *
 * Pure: no Electron. The directory is injected so it's testable against a temp
 * folder; the Electron wiring (default dir, IPC, reveal) lives in `index.ts`.
 */
export class LibraryVault {
  constructor(private readonly directory: string) {}

  filePath(id: string): string {
    return join(this.directory, `${id}${VIDEO_EXT}`);
  }

  private metaDirectory(): string {
    return join(this.directory, META_DIR);
  }

  private sidecarPath(id: string): string {
    return join(this.metaDirectory(), `${id}.json`);
  }

  async list(): Promise<LocalRecording[]> {
    await mkdir(this.directory, { recursive: true });

    let entries: string[];
    try {
      entries = await readdir(this.directory);
    } catch {
      return [];
    }

    const ids = entries.filter((f) => f.endsWith(VIDEO_EXT)).map((f) => basename(f, VIDEO_EXT));
    const described = await Promise.all(ids.map((id) => this.describe(id)));
    return described
      .filter((r): r is LocalRecording => r !== null)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  private async describe(id: string): Promise<LocalRecording | null> {
    const filePath = this.filePath(id);
    let info;
    try {
      info = await stat(filePath);
    } catch {
      return null;
    }
    const meta = await this.readSidecar(id);
    return {
      id,
      title: meta.title ?? humanizeId(id),
      filePath,
      createdAt: meta.createdAt ?? info.birthtimeMs,
      sizeBytes: info.size,
      durationSeconds: meta.durationSeconds ?? 0,
      thumbnailUrl: null,
    };
  }

  private async readSidecar(id: string): Promise<Sidecar> {
    try {
      return JSON.parse(await readFile(this.sidecarPath(id), "utf-8")) as Sidecar;
    } catch {
      return {};
    }
  }

  /** Updates the user-facing title in the sidecar without touching the video file. */
  async rename(id: string, title: string): Promise<void> {
    const meta = await this.readSidecar(id);
    await mkdir(this.metaDirectory(), { recursive: true });
    await writeFile(this.sidecarPath(id), JSON.stringify({ ...meta, title }, null, 2));
  }

  /** Removes the video plus its sidecar and thumbnail (best-effort). */
  async remove(id: string): Promise<void> {
    await Promise.allSettled([
      rm(this.filePath(id), { force: true }),
      rm(this.sidecarPath(id), { force: true }),
      rm(join(this.metaDirectory(), `${id}.jpg`), { force: true }),
    ]);
  }
}

function humanizeId(id: string): string {
  const cleaned = id.replace(/[-_]+/g, " ").trim();
  return cleaned ? cleaned.replace(/\b\w/g, (c) => c.toUpperCase()) : "Recording";
}
