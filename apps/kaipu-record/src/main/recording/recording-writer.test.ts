import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RecordingWriter } from "./recording-writer";

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
    });
    const sidecar = JSON.parse(await readFile(join(vaultDir, ".kaipu", "rec-fixed.json"), "utf-8"));
    expect(sidecar.exportPreset).toBe("vertical");
  });

  it("a plain recording has no provenance", async () => {
    const { writer } = await setup();
    await writer.create("s1");
    await writer.write("s1", new TextEncoder().encode("A").buffer, 0);
    const rec = await writer.finalize("s1", { title: "Rec", durationSeconds: 1, durationMs: 1000 });
    expect(rec.derivedFromAssetId).toBeNull();
  });
});
