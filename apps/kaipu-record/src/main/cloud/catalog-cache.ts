import { randomUUID } from "node:crypto";
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
  // Chains writes per userId so two concurrent `write()` calls for the same account
  // never race each other's temp file: each awaits the previous write before starting.
  private readonly writeChains = new Map<string, Promise<void>>();

  constructor(private readonly userDataDir: string) {}

  private accountDir(userId: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(userId))
      throw new Error(`unsafe userId for a cache path: ${userId}`);
    return join(this.userDataDir, "cloud", userId);
  }

  path(userId: string): string {
    return join(this.accountDir(userId), "catalog.json");
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
    const previous = this.writeChains.get(userId) ?? Promise.resolve();
    const result = previous.then(
      () => this.writeNow(userId, entries),
      () => this.writeNow(userId, entries),
    );
    // Store a link that never rejects, so a failed write doesn't stall the chain for
    // whatever writes this account queues next; the rejection itself still reaches
    // this call's own caller via `result`.
    this.writeChains.set(
      userId,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  }

  private async writeNow(userId: string, entries: CloudCatalogEntry[]): Promise<void> {
    const path = this.path(userId);
    await mkdir(this.accountDir(userId), { recursive: true });
    const file: CatalogFile = { version: 1, entries };
    const tmpPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tmpPath, JSON.stringify(file));
    await rename(tmpPath, path); // atomic: never a half-written catalog
  }

  async clear(userId: string): Promise<void> {
    await rm(this.accountDir(userId), { recursive: true, force: true });
  }
}
