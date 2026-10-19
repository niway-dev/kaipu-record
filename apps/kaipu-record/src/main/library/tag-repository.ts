import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  isTagColor,
  nextTagColor,
  normalizeTagName,
  TagLimitError,
  TagNameTakenError,
  TAGS_PER_ITEM_MAX,
  tagSlug,
  type Tag,
  type TagColor,
} from "@kaipu/domain/constants";
import type { TagSummary } from "@shared/types";
import type { LibraryVault } from "./library-vault";

/**
 * The only way the app reads or writes tags (ADR 0020). The renderer reaches it
 * through IPC; which adapter runs is the provider's business. Phase 2 layers
 * cloud sync on top without changing this shape.
 */
export interface TagRepository {
  /** Live tags with how many items carry each, most used first. */
  list(): Promise<TagSummary[]>;
  create(name: string, color?: TagColor): Promise<Tag>;
  rename(id: string, name: string): Promise<Tag>;
  recolor(id: string, color: TagColor): Promise<Tag>;
  /** Tombstone the tag and take it off every item. */
  remove(id: string): Promise<void>;
  /** Replace an item's tags. Unknown or deleted ids are dropped. Returns what was stored. */
  assign(itemId: string, tagIds: readonly string[]): Promise<string[]>;
}

interface RegistryFile {
  version: 1;
  tags: Tag[];
}

/**
 * Phase 1b adapter: the registry `<vault>/.kaipu/tags.json`, and `tagIds` (plus a
 * cached `tagNames` copy for humans) in each item's sidecar. Writes to the
 * registry are serialized and atomic (temp + rename).
 */
export class VaultTagRepository implements TagRepository {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly vault: () => LibraryVault,
    private readonly deviceId: () => string,
    private readonly now: () => number = Date.now,
  ) {}

  private registryPath(): string {
    return join(this.vault().directory, ".kaipu", "tags.json");
  }

  /** Run `fn` after every earlier registry operation, so two writes never interleave. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async read(): Promise<Tag[]> {
    try {
      const parsed = JSON.parse(await readFile(this.registryPath(), "utf-8")) as RegistryFile;
      return parsed.version === 1 && Array.isArray(parsed.tags) ? parsed.tags : [];
    } catch {
      return this.importLegacy();
    }
  }

  private async write(tags: Tag[]): Promise<void> {
    const target = this.registryPath();
    await mkdir(join(this.vault().directory, ".kaipu"), { recursive: true });
    const file: RegistryFile = { version: 1, tags };
    await writeFile(`${target}.tmp`, JSON.stringify(file, null, 2), "utf-8");
    await rename(`${target}.tmp`, target);
  }

  /**
   * No registry yet: turn the Phase 1 plain-string tags (`tags: string[]` in
   * sidecars, never released) into entities once, and point the items at them.
   */
  private async importLegacy(): Promise<Tag[]> {
    const items = await this.vault().list();
    const tags: Tag[] = [];
    const bySlug = new Map<string, Tag>();
    for (const item of items) {
      const legacy = (await this.vault().sidecar(item.id)).tags;
      if (!Array.isArray(legacy) || legacy.length === 0) continue;
      const ids: string[] = [];
      for (const raw of legacy) {
        const name = typeof raw === "string" ? normalizeTagName(raw) : null;
        if (name === null) continue;
        let tag = bySlug.get(tagSlug(name));
        if (!tag) {
          tag = this.mint(name, nextTagColor(tags.map((t) => t.color)));
          tags.push(tag);
          bySlug.set(tag.slug, tag);
        }
        if (!ids.includes(tag.id)) ids.push(tag.id);
      }
      await this.vault().writeMeta(item.id, {
        tags: undefined,
        tagIds: ids,
        tagNames: ids.map((id) => tags.find((t) => t.id === id)!.name),
      });
    }
    if (tags.length > 0) await this.write(tags);
    return tags;
  }

  private mint(name: string, color: TagColor): Tag {
    const at = this.now();
    return {
      id: uuidv7(at),
      name,
      slug: tagSlug(name),
      color,
      createdAt: at,
      updatedAt: at,
      createdOn: this.deviceId(),
      updatedOn: this.deviceId(),
      deletedAt: null,
    };
  }

  private validName(raw: string): string {
    const name = normalizeTagName(raw);
    if (name === null) throw new Error("tags: not a valid tag name");
    return name;
  }

  private assertFree(tags: Tag[], name: string, self?: string): void {
    const slug = tagSlug(name);
    const clash = tags.find((t) => t.deletedAt === null && t.slug === slug && t.id !== self);
    if (clash) throw new TagNameTakenError(clash.id);
  }

  private live(tags: Tag[], id: string): Tag {
    const tag = tags.find((t) => t.id === id && t.deletedAt === null);
    if (!tag) throw new Error(`tags: no tag ${id}`);
    return tag;
  }

  async list(): Promise<TagSummary[]> {
    const tags = (await this.serial(() => this.read())).filter((t) => t.deletedAt === null);
    const counts = new Map<string, number>();
    for (const item of await this.vault().list()) {
      for (const id of item.tagIds ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return tags
      .map(({ id, name, slug, color }) => ({ id, name, slug, color, count: counts.get(id) ?? 0 }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  create(rawName: string, color?: TagColor): Promise<Tag> {
    return this.serial(async () => {
      const name = this.validName(rawName);
      const tags = await this.read();
      this.assertFree(tags, name);
      const live = tags.filter((t) => t.deletedAt === null);
      const tag = this.mint(
        name,
        isTagColor(color) ? color : nextTagColor(live.map((t) => t.color)),
      );
      await this.write([...tags, tag]);
      return tag;
    });
  }

  rename(id: string, rawName: string): Promise<Tag> {
    return this.serial(async () => {
      const name = this.validName(rawName);
      const tags = await this.read();
      const tag = this.live(tags, id);
      this.assertFree(tags, name, id);
      Object.assign(tag, { name, slug: tagSlug(name) }, this.touched());
      await this.write(tags);
      return tag;
    });
  }

  recolor(id: string, color: TagColor): Promise<Tag> {
    return this.serial(async () => {
      if (!isTagColor(color)) throw new Error("tags: not a palette color");
      const tags = await this.read();
      const tag = this.live(tags, id);
      Object.assign(tag, { color }, this.touched());
      await this.write(tags);
      return tag;
    });
  }

  async remove(id: string): Promise<void> {
    await this.serial(async () => {
      const tags = await this.read();
      const tag = this.live(tags, id);
      Object.assign(tag, { deletedAt: this.now() }, this.touched());
      await this.write(tags);
    });
    const vault = this.vault();
    for (const item of await vault.list()) {
      if (!item.tagIds?.includes(id)) continue;
      await this.assign(
        item.id,
        item.tagIds.filter((t) => t !== id),
      );
    }
  }

  async assign(itemId: string, tagIds: readonly string[]): Promise<string[]> {
    const vault = this.vault();
    // The id comes from the renderer: only an item that exists right now gets a
    // sidecar. Otherwise a deleted or unknown id would leave an orphan sidecar.
    if (!(await vault.hasMedia(itemId))) throw new Error(`tags: no library item "${itemId}"`);
    const live = new Map(
      (await this.serial(() => this.read()))
        .filter((t) => t.deletedAt === null)
        .map((t) => [t.id, t]),
    );
    const ids = [...new Set(tagIds)].filter((id) => live.has(id));
    if (ids.length > TAGS_PER_ITEM_MAX) throw new TagLimitError();
    await vault.writeMeta(itemId, {
      tagIds: ids,
      tagNames: ids.map((id) => live.get(id)!.name),
      tagsUpdatedAt: this.now(),
    });
    return ids;
  }

  private touched(): Pick<Tag, "updatedAt" | "updatedOn"> {
    return { updatedAt: this.now(), updatedOn: this.deviceId() };
  }
}

/**
 * A UUID v7: 48 bits of milliseconds, then random bits. Sorts by creation time
 * and can be minted offline on any device without colliding.
 */
export function uuidv7(ms: number = Date.now()): string {
  const bytes = randomBytes(16);
  const time = BigInt(ms);
  for (let i = 0; i < 6; i++) bytes[i] = Number((time >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** This machine's id, minted once and kept in `userData/device-id`. */
export async function loadDeviceId(userDataDir: string): Promise<string> {
  const path = join(userDataDir, "device-id");
  try {
    const id = (await readFile(path, "utf-8")).trim();
    if (id) return id;
  } catch {
    // first run on this machine
  }
  const id = `d-${uuidv7()}`;
  await mkdir(userDataDir, { recursive: true });
  await writeFile(path, id, "utf-8");
  return id;
}
