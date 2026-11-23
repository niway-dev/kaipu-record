import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecognizedWord, TextRecognizer } from "@kaipu/domain/schemas";
import { withItemLock } from "../library/item-lock";
import { LibraryVault } from "../library/library-vault";
import { readTextCache, recognizeScreenshotText, saveTextCache } from "./screenshot-text";

const word = (text: string, x = 0): RecognizedWord => ({
  text,
  rect: { x, y: 0, w: 10, h: 10 },
  line: 0,
  confidence: 0.9,
});
const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const bytes = (s: string): ArrayBuffer => new Uint8Array(Buffer.from(s)).buffer as ArrayBuffer;

let directory: string;
let vault: LibraryVault;

function fakeRecognizer(result: RecognizedWord[] | "unavailable" = [word("hello")]) {
  const recognize = vi.fn(async () => result);
  return { recognizer: { recognize } satisfies TextRecognizer, recognize };
}

/** A flat screenshot whose PNG on disk holds `content`: the bytes a request must carry to be cached. */
async function seedItem(id = "Shot", content = "a"): Promise<string> {
  await writeFile(join(directory, `${id}.png`), content);
  return id;
}
/** Gives the item a stored canvas document and these assets on disk (`.kaipu/<id>.assets/`). */
async function seedCanvas(id: string, assets: Record<string, string>): Promise<void> {
  const paths = vault.companionPaths(id);
  await mkdir(paths.assetsDir, { recursive: true });
  await writeFile(paths.canvasDoc, "{}");
  for (const [assetId, content] of Object.entries(assets)) {
    await writeFile(join(paths.assetsDir, `${assetId}.png`), content);
  }
}
const cachePath = (id: string): string => vault.companionPaths(id).textCache;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "kaipu-text-"));
  vault = new LibraryVault(directory);
  await vault.reserve({ kind: "screenshot", title: "Shot", createdAt: 1 });
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("recognizeScreenshotText", () => {
  it("caches a recognition and answers the next request from the cache", async () => {
    const id = await seedItem("Shot", "pixels");
    const { recognizer, recognize } = fakeRecognizer();
    const request = { id, assetId: "base", png: bytes("pixels") };
    expect(await recognizeScreenshotText({ vault, recognizer }, request)).toEqual({
      status: "ready",
      words: [word("hello")],
    });
    expect(await recognizeScreenshotText({ vault, recognizer }, request)).toEqual({
      status: "ready",
      words: [word("hello")],
    });
    expect(recognize).toHaveBeenCalledTimes(1);
    const file = JSON.parse(await readFile(cachePath(id), "utf-8"));
    expect(file).toEqual({
      schemaVersion: 1,
      assets: { base: { sha256: sha(Buffer.from("pixels")), words: [word("hello")] } },
    });
  });

  it("recognizes again when the bytes changed, keeping other assets", async () => {
    const id = await seedItem();
    await seedCanvas(id, { base: "a", extra: "x" });
    const { recognizer, recognize } = fakeRecognizer();
    await recognizeScreenshotText({ vault, recognizer }, { id, assetId: "base", png: bytes("a") });
    await recognizeScreenshotText({ vault, recognizer }, { id, assetId: "extra", png: bytes("x") });
    await seedCanvas(id, { base: "b" });
    await recognizeScreenshotText({ vault, recognizer }, { id, assetId: "base", png: bytes("b") });
    expect(recognize).toHaveBeenCalledTimes(3);
    const cache = await readTextCache(vault, id);
    expect(Object.keys(cache).sort()).toEqual(["base", "extra"]);
    expect(cache.base!.sha256).toBe(sha(Buffer.from("b")));
  });

  it("treats an invalid cache file as a miss", async () => {
    const id = await seedItem();
    await writeFile(cachePath(id), "{not json");
    const { recognizer, recognize } = fakeRecognizer();
    const result = await recognizeScreenshotText(
      { vault, recognizer },
      { id, assetId: "base", png: bytes("a") },
    );
    expect(result.status).toBe("ready");
    expect(recognize).toHaveBeenCalledTimes(1);
    // The fresh result replaced the corrupt file.
    expect(Object.keys(await readTextCache(vault, id))).toEqual(["base"]);
  });

  it("drops cache entries that fail the schema", async () => {
    const id = await seedItem();
    await writeFile(
      cachePath(id),
      JSON.stringify({
        schemaVersion: 1,
        assets: {
          base: { sha256: "nothex", words: [] },
          other: { sha256: sha(Buffer.from("o")), words: [{ text: "", rect: {} }] },
          "bad id!": { sha256: sha(Buffer.from("o")), words: [] },
        },
      }),
    );
    expect(await readTextCache(vault, id)).toEqual({});
  });

  it("never writes a cache for a null id", async () => {
    const { recognizer } = fakeRecognizer();
    const result = await recognizeScreenshotText(
      { vault, recognizer },
      { id: null, assetId: "base", png: bytes("a") },
    );
    expect(result.status).toBe("ready");
    await expect(readFile(cachePath("Shot"))).rejects.toThrow();
  });

  it("does not cache an unavailable result", async () => {
    const id = await seedItem();
    const { recognizer } = fakeRecognizer("unavailable");
    expect(
      await recognizeScreenshotText(
        { vault, recognizer },
        { id, assetId: "base", png: bytes("a") },
      ),
    ).toEqual({ status: "unavailable" });
    await expect(readFile(cachePath(id))).rejects.toThrow();
  });

  it("answers unavailable for an invalid request and when the recognizer throws", async () => {
    const id = await seedItem();
    const { recognizer, recognize } = fakeRecognizer();
    const bad = [
      { id, assetId: "../x", png: bytes("a") },
      { id: "a/b", assetId: "base", png: bytes("a") },
      { id, assetId: "base", png: "nope" as unknown as ArrayBuffer },
      { id, assetId: "base", png: new ArrayBuffer(0) },
    ];
    for (const request of bad) {
      expect(await recognizeScreenshotText({ vault, recognizer }, request)).toEqual({
        status: "unavailable",
      });
    }
    expect(recognize).not.toHaveBeenCalled();
    const throwing: TextRecognizer = {
      recognize: async () => {
        throw new Error("boom");
      },
    };
    expect(
      await recognizeScreenshotText(
        { vault, recognizer: throwing },
        { id, assetId: "base", png: bytes("a") },
      ),
    ).toEqual({ status: "unavailable" });
  });

  it("runs one recognizer call for identical concurrent requests", async () => {
    const id = await seedItem();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const recognize = vi.fn(async () => {
      await gate;
      return [word("hello")];
    });
    const request = { id, assetId: "base", png: bytes("a") };
    const a = recognizeScreenshotText({ vault, recognizer: { recognize } }, request);
    const b = recognizeScreenshotText({ vault, recognizer: { recognize } }, request);
    await new Promise((r) => setTimeout(r, 20));
    release();
    expect(await a).toEqual(await b);
    expect(recognize).toHaveBeenCalledTimes(1);
  });

  it("does not write when a save happened while it was recognizing", async () => {
    const id = await seedItem();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const recognizer: TextRecognizer = {
      recognize: async () => {
        await gate;
        return [word("secret")];
      },
    };
    const pending = recognizeScreenshotText(
      { vault, recognizer },
      { id, assetId: "base", png: bytes("a") },
    );
    await new Promise((r) => setTimeout(r, 20));
    // A save without a text payload: the file is removed and the generation moves on.
    await saveTextCache(vault, id, undefined, undefined);
    release();
    expect((await pending).status).toBe("ready");
    await expect(readFile(cachePath(id))).rejects.toThrow();
  });

  it("caches a canvas asset whose bytes match the asset on disk", async () => {
    const id = await seedItem();
    await seedCanvas(id, { base: "redacted" });
    const { recognizer } = fakeRecognizer([word("ok")]);
    await recognizeScreenshotText(
      { vault, recognizer },
      { id, assetId: "base", png: bytes("redacted") },
    );
    expect(await readTextCache(vault, id)).toEqual({
      base: { sha256: sha(Buffer.from("redacted")), words: [word("ok")] },
    });
  });

  it("does not cache words of an older image over a newer redacted asset", async () => {
    // Window A saved a redaction (asset on disk is "redacted", cache rewritten without the
    // word); window B still holds the unredacted bytes and asks for recognition afterwards.
    const id = await seedItem();
    await seedCanvas(id, { base: "redacted" });
    await saveTextCache(
      vault,
      id,
      { assets: [{ assetId: "base", words: [word("ok", 20)] }] },
      { docJson: "{}", assets: [{ assetId: "base", png: bytes("redacted") }] },
    );
    const { recognizer } = fakeRecognizer([word("secret")]);
    const result = await recognizeScreenshotText(
      { vault, recognizer },
      { id, assetId: "base", png: bytes("unredacted") },
    );
    // The caller still gets its words; nothing reaches the file.
    expect(result).toEqual({ status: "ready", words: [word("secret")] });
    expect(await readTextCache(vault, id)).toEqual({
      base: { sha256: sha(Buffer.from("redacted")), words: [word("ok", 20)] },
    });
  });

  it("does not cache an asset that has no file on disk", async () => {
    const id = await seedItem();
    await seedCanvas(id, { base: "a" });
    const { recognizer } = fakeRecognizer();
    await recognizeScreenshotText({ vault, recognizer }, { id, assetId: "extra", png: bytes("x") });
    await expect(readFile(cachePath(id))).rejects.toThrow();
  });

  it("does not use the flat PNG for base once a canvas document exists", async () => {
    const id = await seedItem("Shot", "flat");
    await writeFile(vault.companionPaths(id).canvasDoc, "{}");
    const { recognizer } = fakeRecognizer();
    await recognizeScreenshotText(
      { vault, recognizer },
      { id, assetId: "base", png: bytes("flat") },
    );
    await expect(readFile(cachePath(id))).rejects.toThrow();
  });

  it("does not cache a non-canvas item whose PNG changed since the request's bytes", async () => {
    const id = await seedItem("Shot", "new");
    const { recognizer } = fakeRecognizer();
    await recognizeScreenshotText(
      { vault, recognizer },
      { id, assetId: "base", png: bytes("old") },
    );
    await expect(readFile(cachePath(id))).rejects.toThrow();
  });

  it("waits for the item lock, so a delete in progress never sees its cache recreated", async () => {
    const id = await seedItem();
    const { recognizer } = fakeRecognizer();
    // Stands for a delete, rename or move: they all hold this lock for their whole run.
    let finishDelete!: () => void;
    const deleteMayFinish = new Promise<void>((resolve) => (finishDelete = resolve));
    let holding!: () => void;
    const lockHeld = new Promise<void>((resolve) => (holding = resolve));
    const deleting = withItemLock(vault.workspaceId ?? directory, id, async () => {
      holding();
      await deleteMayFinish;
      await vault.remove(id);
    });
    await lockHeld;
    const recognizing = recognizeScreenshotText(
      { vault, recognizer },
      { id, assetId: "base", png: bytes("a") },
    );
    // The recognizer has long finished; the matching, existing item is still not written.
    await new Promise((r) => setTimeout(r, 50));
    await expect(readFile(cachePath(id))).rejects.toThrow();
    finishDelete();
    await deleting;
    expect((await recognizing).status).toBe("ready");
    await expect(readFile(join(directory, `${id}.png`))).rejects.toThrow();
    await expect(readFile(cachePath(id))).rejects.toThrow();
  });

  it("does not write under an id whose media is gone", async () => {
    const id = "Missing";
    const { recognizer } = fakeRecognizer();
    await recognizeScreenshotText({ vault, recognizer }, { id, assetId: "base", png: bytes("a") });
    await expect(readFile(cachePath(id))).rejects.toThrow();
  });
});

describe("recognizeScreenshotText in a synced workspace", () => {
  it("never reads an evicted text cache: it is a miss and the file is left as it was", async () => {
    const id = await seedItem("Shot", "pixels");
    const text = cachePath(id);
    await writeFile(
      text,
      JSON.stringify({
        schemaVersion: 1,
        assets: { base: { sha256: sha(Buffer.from("pixels")), words: [word("cached")] } },
      }),
    );
    const synced = new LibraryVault(
      directory,
      undefined,
      { readText: () => Promise.reject(new Error("a read downloads it")) },
      async (paths) => new Set(paths.filter((path) => path === text)),
    );
    expect(await readTextCache(synced, id)).toEqual({});
  });

  it("never reads an evicted PNG to check the cache: the words come back, nothing is cached", async () => {
    const id = await seedItem("Shot", "pixels");
    const evicted = new Set([join(directory, `${id}.png`)]);
    const synced = new LibraryVault(directory, undefined, undefined, async () => evicted);
    const { recognizer, recognize } = fakeRecognizer();

    const result = await recognizeScreenshotText(
      { vault: synced, recognizer },
      { id, assetId: "base", png: bytes("pixels") },
    );

    expect(result).toEqual({ status: "ready", words: [word("hello")] });
    expect(recognize).toHaveBeenCalledTimes(1);
    // The PNG on disk could not be compared without downloading it, so no cache was written.
    await expect(readFile(cachePath(id), "utf-8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("never reads an evicted canvas asset to check the cache either", async () => {
    const id = await seedItem("Shot", "flat");
    await seedCanvas(id, { base: "pixels" });
    const asset = join(vault.companionPaths(id).assetsDir, "base.png");
    const synced = new LibraryVault(
      directory,
      undefined,
      undefined,
      async (paths) => new Set(paths.filter((path) => path === asset)),
    );
    const { recognizer } = fakeRecognizer();

    const result = await recognizeScreenshotText(
      { vault: synced, recognizer },
      { id, assetId: "base", png: bytes("pixels") },
    );

    expect(result).toEqual({ status: "ready", words: [word("hello")] });
    // Hashing the asset would have downloaded it; without a hash nothing is cached.
    await expect(readFile(cachePath(id), "utf-8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("saveTextCache", () => {
  const canvas = (assets: Record<string, string>) => ({
    docJson: "{}",
    assets: Object.entries(assets).map(([assetId, text]) => ({ assetId, png: bytes(text) })),
  });
  const storedCanvas = async (id: string) => {
    await writeFile(vault.companionPaths(id).canvasDoc, "{}");
  };

  it("writes only assets with a matching canvas asset, hashed from its bytes", async () => {
    const id = await seedItem();
    await storedCanvas(id);
    await saveTextCache(
      vault,
      id,
      {
        assets: [
          { assetId: "base", words: [word("kept")] },
          { assetId: "ghost", words: [word("no asset")] },
          { assetId: "bad id!", words: [] },
          { assetId: "extra", words: [{ text: "" } as unknown as RecognizedWord] },
        ],
      },
      canvas({ base: "flat-pixels", extra: "x" }),
    );
    expect(await readTextCache(vault, id)).toEqual({
      base: { sha256: sha(Buffer.from("flat-pixels")), words: [word("kept")] },
    });
  });

  it("replaces an older cache, so a hidden word cannot survive", async () => {
    const id = await seedItem();
    await storedCanvas(id);
    await saveTextCache(
      vault,
      id,
      { assets: [{ assetId: "base", words: [word("secret"), word("ok", 20)] }] },
      canvas({ base: "a" }),
    );
    await saveTextCache(
      vault,
      id,
      { assets: [{ assetId: "base", words: [word("ok", 20)] }] },
      canvas({ base: "b" }),
    );
    expect((await readTextCache(vault, id)).base!.words).toEqual([word("ok", 20)]);
  });

  it("deletes the file without a text payload, without a canvas, or when no canvas was stored", async () => {
    const id = await seedItem();
    await storedCanvas(id);
    const payload = { assets: [{ assetId: "base", words: [word("a")] }] };
    const write = async () => {
      await saveTextCache(vault, id, payload, canvas({ base: "a" }));
      expect(Object.keys(await readTextCache(vault, id))).toEqual(["base"]);
    };
    await write();
    await saveTextCache(vault, id, undefined, canvas({ base: "a" }));
    await expect(readFile(cachePath(id))).rejects.toThrow();
    await write();
    await saveTextCache(vault, id, payload, undefined);
    await expect(readFile(cachePath(id))).rejects.toThrow();
    await write();
    await rm(vault.companionPaths(id).canvasDoc);
    await saveTextCache(vault, id, payload, canvas({ base: "a" }));
    await expect(readFile(cachePath(id))).rejects.toThrow();
  });
});
