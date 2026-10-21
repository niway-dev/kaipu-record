import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, access, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FinalizeMoveError, RecordingWriter } from "./recording-writer";

async function setup() {
  const vaultDir = await mkdtemp(join(tmpdir(), "rw-vault-"));
  const tempDir = await mkdtemp(join(tmpdir(), "rw-temp-"));
  const writer = new RecordingWriter({
    vaultDir: () => vaultDir,
    newId: () => "rec-fixed",
    now: () => 5000,
    tempDir,
  });
  return { writer, vaultDir, tempDir };
}

describe("RecordingWriter", () => {
  it("reconstructs the exact byte stream, honoring overwritten regions", async () => {
    const { writer, vaultDir } = await setup();
    await writer.create("s1");
    await writer.write("s1", new TextEncoder().encode("AAAAAAAA").buffer, 0);
    await writer.write("s1", new TextEncoder().encode("BB").buffer, 2);
    const rec = await writer.finalize("s1", { title: "T", durationSeconds: 3, durationMs: 3000 });
    const bytes = await readFile(rec.filePath, "utf-8");
    expect(bytes).toBe("AABBAAAA");
    expect(rec).toMatchObject({ id: "rec-fixed", title: "T", durationSeconds: 3 });
    expect(rec.filePath.endsWith("rec-fixed.mp4")).toBe(true);
    expect(rec.filePath.startsWith(vaultDir)).toBe(true);
  });

  it("drains fire-and-forget writes before finalize closes the file", async () => {
    const { writer } = await setup();
    await writer.create("s1");
    // Mimic the IPC path: chunks are sent without awaiting each write.
    void writer.write("s1", new TextEncoder().encode("AAAA").buffer, 0);
    void writer.write("s1", new TextEncoder().encode("BBBB").buffer, 4);
    const rec = await writer.finalize("s1", { title: "T", durationSeconds: 1, durationMs: 1000 });
    expect(await readFile(rec.filePath, "utf-8")).toBe("AAAABBBB");
  });

  it("writes a thumbnail when provided", async () => {
    const { writer, vaultDir } = await setup();
    await writer.create("s1");
    await writer.write("s1", new TextEncoder().encode("x").buffer, 0);
    await writer.finalize("s1", {
      title: "T",
      durationSeconds: 1,
      durationMs: 1000,
      thumbnail: new Uint8Array([0xff, 0xd8, 0xff]).buffer,
    });
    await expect(access(join(vaultDir, ".kaipu", "rec-fixed.jpg"))).resolves.toBeUndefined();
  });

  it("abort deletes the temp file and leaves the vault empty", async () => {
    const { writer, vaultDir, tempDir } = await setup();
    await writer.create("s1");
    await writer.write("s1", new TextEncoder().encode("x").buffer, 0);
    await writer.abort("s1");
    expect(await readdir(tempDir)).toHaveLength(0);
    const vaultFiles = (await readdir(vaultDir)).filter((f) => f.endsWith(".mp4"));
    expect(vaultFiles).toHaveLength(0);
  });

  it("throws when writing to an unknown session", async () => {
    const { writer } = await setup();
    await expect(writer.write("ghost", new ArrayBuffer(1), 0)).rejects.toThrow(/session/i);
  });

  it("persists export provenance in the sidecar and surfaces it on the recording", async () => {
    const { writer, vaultDir } = await setup();
    await writer.create("s1");
    await writer.write("s1", new TextEncoder().encode("AAAA").buffer, 0);
    const rec = await writer.finalize("s1", {
      title: "Export",
      durationSeconds: 1,
      durationMs: 1000,
      derivedFromAssetId: "22222222-2222-4222-8222-222222222222",
    });
    expect(rec.derivedFromAssetId).toBe("22222222-2222-4222-8222-222222222222");
    const sidecar = JSON.parse(await readFile(join(vaultDir, ".kaipu", "rec-fixed.json"), "utf-8"));
    expect(sidecar.derivedFromAssetId).toBe("22222222-2222-4222-8222-222222222222");
    expect(sidecar.assetId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("stat() reports the temp file size after queued writes land", async () => {
    const { writer } = await setup();
    await writer.create("s1");
    void writer.write("s1", new TextEncoder().encode("AAAA").buffer, 0);
    void writer.write("s1", new TextEncoder().encode("BB").buffer, 10);
    expect(await writer.stat("s1")).toBe(12);
    await expect(writer.stat("ghost")).rejects.toThrow(/session/i);
    await writer.abort("s1");
  });

  it("persists the export preset in the sidecar (NIW2-218)", async () => {
    const { writer, vaultDir } = await setup();
    await writer.create("s1");
    await writer.write("s1", new TextEncoder().encode("AAAA").buffer, 0);
    await writer.finalize("s1", {
      title: "Export (vertical)",
      durationSeconds: 1,
      durationMs: 1000,
      derivedFromAssetId: "22222222-2222-4222-8222-222222222222",
      exportPreset: "vertical",
      exportFingerprint: "edit:abc123",
    });
    const sidecar = JSON.parse(await readFile(join(vaultDir, ".kaipu", "rec-fixed.json"), "utf-8"));
    expect(sidecar.exportPreset).toBe("vertical");
    expect(sidecar.exportFingerprint).toBe("edit:abc123");
  });

  it("a plain recording has no provenance", async () => {
    const { writer } = await setup();
    await writer.create("s1");
    await writer.write("s1", new TextEncoder().encode("A").buffer, 0);
    const rec = await writer.finalize("s1", { title: "Rec", durationSeconds: 1, durationMs: 1000 });
    expect(rec.derivedFromAssetId).toBeNull();
    expect(rec.export).toBeNull();
  });

  it("drops a fingerprint that isn't a short token", async () => {
    const { writer, vaultDir } = await setup();
    await writer.create("s1");
    await writer.write("s1", new TextEncoder().encode("A").buffer, 0);
    await writer.finalize("s1", {
      title: "Rec",
      durationSeconds: 1,
      durationMs: 1000,
      exportPreset: "balanced",
      exportFingerprint: "x".repeat(65),
    });
    const sidecar = JSON.parse(await readFile(join(vaultDir, ".kaipu", "rec-fixed.json"), "utf-8"));
    expect(sidecar).not.toHaveProperty("exportFingerprint");
  });
});

async function setupInVault() {
  const vaultDir = await mkdtemp(join(tmpdir(), "rw-vault-"));
  const fallbackTempDir = await mkdtemp(join(tmpdir(), "rw-fallback-"));
  const writer = new RecordingWriter({
    vaultDir: () => vaultDir,
    newId: () => "rec-fixed",
    now: () => 5000,
    fallbackTempDir,
  });
  return { writer, vaultDir, fallbackTempDir };
}

/** A vault path under a regular file: mkdir on it always fails. */
async function unreachableVault(): Promise<string> {
  const blocker = join(await mkdtemp(join(tmpdir(), "rw-block-")), "file");
  await writeFile(blocker, "x");
  return join(blocker, "sub");
}

describe("RecordingWriter — staging inside the vault", () => {
  it("stages the .part inside <vault>/.kaipu/tmp when the vault is writable", async () => {
    const { writer, vaultDir } = await setupInVault();
    const { tempPath } = await writer.create("s1");
    expect(tempPath.startsWith(join(vaultDir, ".kaipu", "tmp"))).toBe(true);
    await writer.write("s1", new TextEncoder().encode("abc").buffer, 0);
    await writer.finalize("s1", { title: "t", durationSeconds: 1 });
    expect(await readdir(join(vaultDir, ".kaipu", "tmp"))).toHaveLength(0);
    expect(await readdir(vaultDir)).toContain("rec-fixed.mp4");
  });

  it("falls back to the fallback temp dir when the staging folder cannot be created", async () => {
    const { fallbackTempDir } = await setupInVault();
    const vaultPath = await unreachableVault();
    const writer = new RecordingWriter({
      vaultDir: () => vaultPath,
      newId: () => "rec-fixed",
      fallbackTempDir,
    });
    const { tempPath } = await writer.create("s1");
    expect(tempPath.startsWith(fallbackTempDir)).toBe(true);
  });
});

describe("RecordingWriter — unreachable vault at finalize", () => {
  async function stranded() {
    const vaultPath = await unreachableVault();
    const fallbackTempDir = await mkdtemp(join(tmpdir(), "rw-fallback-"));
    return new RecordingWriter({
      vaultDir: () => vaultPath,
      newId: () => "rec-fixed",
      fallbackTempDir,
    });
  }

  it("keeps the session and the .part when the destination cannot be created", async () => {
    const writer = await stranded();
    const { tempPath } = await writer.create("s1");
    await writer.write("s1", new TextEncoder().encode("hello").buffer, 0);
    await expect(writer.finalize("s1", { title: "t", durationSeconds: 1 })).rejects.toBeInstanceOf(
      FinalizeMoveError,
    );
    expect((await readFile(tempPath)).toString()).toBe("hello");
    await writer.abort("s1"); // the renderer always aborts after a failed finalize
    expect((await readFile(tempPath)).toString()).toBe("hello");
  });

  it("salvage moves a stranded take to the chosen path", async () => {
    const writer = await stranded();
    const { tempPath } = await writer.create("s1");
    await writer.write("s1", new TextEncoder().encode("hello").buffer, 0);
    await writer.finalize("s1", { title: "t", durationSeconds: 1 }).catch(() => {});
    const dest = join(await mkdtemp(join(tmpdir(), "rw-else-")), "x.mp4");
    await writer.salvage("s1", dest);
    expect((await readFile(dest)).toString()).toBe("hello");
    await expect(stat(tempPath)).rejects.toThrow();
    await expect(writer.salvage("s1", dest)).rejects.toThrow(/No stranded/);
  });
});
