import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CloudCatalogEntry } from "@shared/types/library-item";

interface CatalogFile {
  version: 1;
  entries: CloudCatalogEntry[];
}

/**
 * Per-account snapshot of the cloud catalog: `userData/cloud/<userId>/catalog.json`.
 * Lives outside the vault on purpose — it must survive a disconnected drive and a
 * changed vault folder, and it must never be visible to another account.
 */
export class CatalogCache {
  constructor(private readonly userDataDir: string) {}

  path(userId: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(userId))
      throw new Error(`unsafe userId for a cache path: ${userId}`);
    return join(this.userDataDir, "cloud", userId, "catalog.json");
  }

  async read(userId: string): Promise<CloudCatalogEntry[] | null> {
    try {
      const parsed = JSON.parse(await readFile(this.path(userId), "utf-8")) as CatalogFile;
      return parsed.version === 1 && Array.isArray(parsed.entries) ? parsed.entries : null;
    } catch {
      return null;
    }
  }

  async write(userId: string, entries: CloudCatalogEntry[]): Promise<void> {
    const path = this.path(userId);
    await mkdir(join(this.userDataDir, "cloud", userId), { recursive: true });
    const file: CatalogFile = { version: 1, entries };
    await writeFile(`${path}.tmp`, JSON.stringify(file));
    await rename(`${path}.tmp`, path); // atomic: never a half-written catalog
  }

  async clear(userId: string): Promise<void> {
    await rm(join(this.userDataDir, "cloud", userId), { recursive: true, force: true });
  }
}
