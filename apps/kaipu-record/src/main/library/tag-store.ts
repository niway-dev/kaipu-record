import { TagSetBuilder } from "@kaipu/domain/constants";
import type { TagVocabularyEntry } from "@shared/types";
import type { LibraryVault } from "./library-vault";

/**
 * Where recording tags live. The app talks to this port only; which adapter runs
 * is the provider's business (recording-tags design, decision 4).
 */
export interface TagStore {
  get(itemId: string): Promise<readonly string[]>;
  /** Replace an item's tags. Returns the tags actually stored (normalized). */
  set(itemId: string, tags: readonly string[], updatedAt: number): Promise<readonly string[]>;
  /** Every tag in use with how many items carry it, most used first. */
  vocabulary(): Promise<readonly TagVocabularyEntry[]>;
}

/**
 * Phase 1 adapter: tags in the item's sidecar `.kaipu/<id>.json`, written through
 * `writeMeta` — a merge, so `title`, `assetId` and the hash fields are never
 * dropped. Tags are re-normalized here even though the renderer already did:
 * this is the last stop before the file system.
 */
export class SidecarTagStore implements TagStore {
  constructor(private readonly vault: () => LibraryVault) {}

  async get(itemId: string): Promise<readonly string[]> {
    const meta = await this.vault().sidecar(itemId);
    return new TagSetBuilder(Array.isArray(meta.tags) ? meta.tags : []).build();
  }

  async set(
    itemId: string,
    tags: readonly string[],
    updatedAt: number,
  ): Promise<readonly string[]> {
    const normalized = new TagSetBuilder(tags).build();
    await this.vault().writeMeta(itemId, { tags: [...normalized], tagsUpdatedAt: updatedAt });
    return normalized;
  }

  async vocabulary(): Promise<readonly TagVocabularyEntry[]> {
    return foldVocabulary((await this.vault().list()).map((item) => item.tags ?? []));
  }
}

/** Count tags across items: most used first, ties alphabetical. */
export function foldVocabulary(tagLists: Iterable<readonly string[]>): TagVocabularyEntry[] {
  const counts = new Map<string, number>();
  for (const tags of tagLists) {
    for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * Picks the tag store. Phase 1 has only the sidecar adapter; Phase 2 returns a
 * replicating store (sidecar first, then the cloud catalog) when cloud is on.
 */
export class TagStoreProvider {
  private readonly sidecar: SidecarTagStore;

  constructor(vault: () => LibraryVault) {
    this.sidecar = new SidecarTagStore(vault);
  }

  current(): TagStore {
    return this.sidecar;
  }
}
