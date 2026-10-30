import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UNREADABLE_RECORD_MARKER } from "@shared/types/library-storage";
import { LibraryVault, readSidecarStrict, UnreadableRecordError } from "./library-vault";

const canChmod = process.platform !== "win32" && process.getuid?.() !== 0;

describe("readSidecarStrict (F9)", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kaipu-strict-"));
  });
  afterEach(async () => {
    await chmod(directory, 0o755).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  });

  let n = 0;
  const read = async (content: string | null) => {
    const path = join(directory, `x${n++}.json`);
    if (content !== null) await writeFile(path, content);
    return (await readSidecarStrict(path)).status;
  };

  it("tells ok, missing, corrupt JSON and an invalid schema apart", async () => {
    expect(await read('{"title":"Demo","assetId":"a"}')).toBe("ok");
    expect(await read(null)).toBe("missing");
    expect(await read('{"title":')).toBe("corrupt-json");
    expect(await read("[]")).toBe("invalid-schema");
    expect(await read("null")).toBe("invalid-schema");
    expect(await read('{"assetId":5}')).toBe("invalid-schema");
    expect(await read('{"assetId":""}')).toBe("invalid-schema");
    expect(await read('{"title":["x"]}')).toBe("invalid-schema");
    expect(await read('{"createdAt":"yesterday"}')).toBe("invalid-schema");
  });

  it.skipIf(!canChmod)("reports a permission error as unreadable, never as missing", async () => {
    const path = join(directory, "x.json");
    await writeFile(path, "{}");
    await chmod(path, 0o000);
    expect((await readSidecarStrict(path)).status).toBe("unreadable");
  });
});

describe("LibraryVault — an unreadable record is never written (F9)", () => {
  let directory: string;
  let vault: LibraryVault;
  const CORRUPT = '{"title": "Demo", "assetId": "a-1", "tagIds": ["t1"]';

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kaipu-unreadable-"));
    vault = new LibraryVault(directory);
    await mkdir(join(directory, ".kaipu"), { recursive: true });
    await writeFile(join(directory, "Demo.mp4"), "video");
    await writeFile(join(directory, ".kaipu", "Demo.json"), CORRUPT);
    await writeFile(join(directory, ".kaipu", "Demo.jpg"), "poster");
    await writeFile(join(directory, "Shot.png"), "png");
    await writeFile(join(directory, ".kaipu", "Shot.json"), "[]");
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const sidecarBytes = (stem: string) =>
    readFile(join(directory, ".kaipu", `${stem}.json`), "utf8");

  it("lists the item read-only instead of failing the list or rewriting the record", async () => {
    const items = await vault.list();
    const demo = items.find((item) => item.id === "Demo")!;
    expect(demo.readable).toBe(false);
    expect(items.find((item) => item.id === "Shot")!.readable).toBe(false);
    expect(await sidecarBytes("Demo")).toBe(CORRUPT);
    expect(await sidecarBytes("Shot")).toBe("[]");
  });

  it("refuses every mutation and leaves the record and the media byte-identical", async () => {
    const before = await stat(join(directory, ".kaipu", "Demo.json"));
    const refusals = [
      () => vault.writeMeta("Demo", { title: "x" }),
      () => vault.backfill("Demo", { durationSeconds: 3, thumbnail: null }),
      () => vault.markOpenedInEditor("Demo"),
      () => vault.renameItem({ id: "Demo", assetId: "a-1" }, "Other"),
      () => vault.removeLocalCopy("Demo"),
      () => vault.ensureContentHash("Demo"),
      () => vault.overwriteImage("Demo", Buffer.from("x"), {}, "a-1"),
      () => vault.remove("Demo"),
    ];
    for (const refusal of refusals) {
      const error = await refusal().then(
        () => null,
        (e: unknown) => e,
      );
      expect(error, String(refusal)).toBeInstanceOf(UnreadableRecordError);
      expect((error as Error).message).toContain(UNREADABLE_RECORD_MARKER);
    }
    expect(await sidecarBytes("Demo")).toBe(CORRUPT);
    expect((await stat(join(directory, ".kaipu", "Demo.json"))).mtimeMs).toBe(before.mtimeMs);
    expect(await readFile(join(directory, "Demo.mp4"), "utf8")).toBe("video");
    expect(await readFile(join(directory, ".kaipu", "Demo.jpg"), "utf8")).toBe("poster");
  });

  it("a screenshot overwrite refuses before writing the PNG", async () => {
    // The identity is valid, but the record is not: the item is found and still refused.
    await writeFile(join(directory, ".kaipu", "Shot.json"), '{"assetId":"s-1","title":5}');
    const error = await vault
      .overwriteImage("Shot", Buffer.from("new"), { title: "x" }, "s-1")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnreadableRecordError);
    expect(String(error)).toContain(UNREADABLE_RECORD_MARKER);
    expect(await readFile(join(directory, "Shot.png"), "utf8")).toBe("png");
    expect(await sidecarBytes("Shot")).toBe('{"assetId":"s-1","title":5}');
  });

  it("an item without a sidecar still gets one (a missing record is not unreadable)", async () => {
    await writeFile(join(directory, "Legacy.mp4"), "video");
    const item = (await vault.list()).find((i) => i.id === "Legacy")!;
    expect(item.readable).not.toBe(false);
    expect(JSON.parse(await sidecarBytes("Legacy")).assetId).toBe(item.assetId);
  });
});
