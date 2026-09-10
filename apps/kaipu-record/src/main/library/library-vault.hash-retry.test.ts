import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LibraryVault } from "./library-vault";

vi.mock("./content-hash", () => ({
  sha256FileBase64: vi.fn(async (path: string) => {
    // Simulate a continuously changing file by appending a byte each call
    const content = await readFile(path);
    await writeFile(path, Buffer.concat([content, Buffer.from([1])]));
    return "mock-hash-" + Math.random().toString(36).slice(2);
  }),
}));

describe("LibraryVault — hash retry on changing file", () => {
  let directory: string;
  let vault: LibraryVault;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kaipu-vault-retry-"));
    vault = new LibraryVault(directory);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("rejects when file keeps changing after 3 attempts", async () => {
    await writeFile(join(directory, "busy.webm"), Buffer.alloc(100));
    const { sha256FileBase64 } = await import("./content-hash");
    await expect(vault.ensureContentHash("busy")).rejects.toThrow(/changed while hashing/);
    expect(sha256FileBase64).toHaveBeenCalledTimes(3);
  });
});
