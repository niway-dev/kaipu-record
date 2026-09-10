import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256FileBase64 } from "./content-hash";

describe("sha256FileBase64", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kaipu-hash-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("matches the known digest of an empty file and of 'abc'", async () => {
    await writeFile(join(dir, "empty"), "");
    await writeFile(join(dir, "abc"), "abc");
    expect(await sha256FileBase64(join(dir, "empty"))).toBe(
      "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
    );
    expect(await sha256FileBase64(join(dir, "abc"))).toBe(
      "ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=",
    );
  });

  it("streams: hashes a multi-megabyte file without loading it whole (same digest as one-shot)", async () => {
    const big = Buffer.alloc(3 * 1024 * 1024, 1);
    await writeFile(join(dir, "big"), big);
    const { createHash } = await import("node:crypto");
    expect(await sha256FileBase64(join(dir, "big"))).toBe(
      createHash("sha256").update(big).digest("base64"),
    );
  });
});
