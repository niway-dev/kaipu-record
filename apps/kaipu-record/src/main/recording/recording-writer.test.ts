import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  access,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LibraryVault } from "../library/library-vault";
import { FinalizeMoveError, RecordingWriter } from "./recording-writer";
import { recoverStrandedRecordings } from "./stranded-recordings";

afterEach(() => vi.restoreAllMocks());

async function setup() {
  const vaultDir = await mkdtemp(join(tmpdir(), "rw-vault-"));
  const tempDir = await mkdtemp(join(tmpdir(), "rw-temp-"));
  const writer = new RecordingWriter({
    vaultDir: () => vaultDir,
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
    expect(rec).toMatchObject({ id: "T", title: "T", durationSeconds: 3 });
    expect(rec.filePath.endsWith("T.mp4")).toBe(true);
    expect(rec.filePath.startsWith(vaultDir)).toBe(true);
  });

  it("persists the capture metadata next to the duration, and none when it is absent", async () => {
    const { writer, vaultDir } = await setup();
    await writer.create("s1");
    await writer.write("s1", new TextEncoder().encode("x").buffer, 0);
    const rec = await writer.finalize("s1", {
      title: "T",
      durationSeconds: 2,
      durationMs: 2000,
      capture: { mode: "window", width: 800, height: 600, ratio: null },
    });
    expect(rec.capture).toEqual({
      mode: "window",
      width: 800,
      height: 600,
      ratio: null,
    });
    const sidecar = JSON.parse(await readFile(join(vaultDir, ".kaipu", "T.json"), "utf-8"));
    expect(sidecar).toMatchObject({
      durationSeconds: 2,
      capture: { mode: "window", width: 800, height: 600, ratio: null },
    });
  });

  it("writes no capture field for a finalize without one (editor exports)", async () => {
    const { writer, vaultDir } = await setup();
    await writer.create("s1");
    await writer.write("s1", new TextEncoder().encode("x").buffer, 0);
    const rec = await writer.finalize("s1", {
      title: "T",
      durationSeconds: 1,
      durationMs: 1000,
    });
    expect(rec.capture).toBeNull();
    const sidecar = JSON.parse(await readFile(join(vaultDir, ".kaipu", "T.json"), "utf-8"));
    expect(sidecar).not.toHaveProperty("capture");
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
    await expect(access(join(vaultDir, ".kaipu", "T.jpg"))).resolves.toBeUndefined();
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

  it("releaseAll closes the open sessions but keeps their partial files, and forgets them", async () => {
    const { writer, tempDir } = await setup();
    await writer.create("s1");
    await writer.write("s1", new TextEncoder().encode("partial").buffer, 0);
    await writer.releaseAll();
    // The take's renderer died: the partial .part stays on disk, the session is gone.
    expect(await readdir(tempDir)).toHaveLength(1);
    await expect(writer.stat("s1")).rejects.toThrow(/session/i);
    await expect(
      writer.finalize("s1", { title: "T", durationSeconds: 1, durationMs: 1000 }),
    ).rejects.toThrow(/session/i);
  });

  it("release closes one session but keeps its partial for the stranded-take sweep", async () => {
    const vaultDir = await mkdtemp(join(tmpdir(), "rw-vault-"));
    const writer = new RecordingWriter({ vaultDir: () => vaultDir });
    const { tempPath } = await writer.create("s1");
    await writer.create("s2");
    await writer.write("s1", new TextEncoder().encode("partial").buffer, 0);

    // Its page reloaded mid-take: that is not a discard, the bytes are the only copy.
    await writer.release("s1");
    expect(await readFile(tempPath, "utf-8")).toBe("partial");
    expect(writer.ids()).toEqual(["s2"]);

    const swept = await recoverStrandedRecordings({
      vaultDir,
      fallbackTempDir: await mkdtemp(join(tmpdir(), "rw-fallback-")),
      title: "Recovered",
      now: () => Date.now() + 10 * 60_000,
    });
    expect(swept.recovered).toHaveLength(1);
    expect(
      await readFile(await new LibraryVault(vaultDir).filePath(swept.recovered[0]!), "utf-8"),
    ).toBe("partial");
  });

  it("ids lists the open sessions until they end", async () => {
    const { writer } = await setup();
    await writer.create("s1");
    await writer.create("s2");
    expect(writer.ids()).toEqual(["s1", "s2"]);
    await writer.abort("s1");
    expect(writer.ids()).toEqual(["s2"]);
    await writer.releaseAll();
    expect(writer.ids()).toEqual([]);
  });

  it("releaseAll keeps a stranded take so it can still be salvaged", async () => {
    const vaultPath = await unreachableVault();
    const fallbackTempDir = await mkdtemp(join(tmpdir(), "rw-fallback-"));
    const writer = new RecordingWriter({
      vaultDir: () => vaultPath,
      fallbackTempDir,
    });
    await writer.create("s1");
    await writer.write("s1", new TextEncoder().encode("hello").buffer, 0);
    await expect(
      writer.finalize("s1", { title: "T", durationSeconds: 1, durationMs: 1000 }),
    ).rejects.toBeInstanceOf(FinalizeMoveError);
    await writer.releaseAll();
    const dest = join(await mkdtemp(join(tmpdir(), "rw-else-")), "x.mp4");
    await writer.salvage("s1", dest);
    expect(await readFile(dest, "utf-8")).toBe("hello");
  });

  it("a metadata failure after the move takes the media back out of the vault, still salvageable", async () => {
    const { writer, vaultDir, tempDir } = await setup();
    const { tempPath } = await writer.create("s1");
    await writer.write("s1", new TextEncoder().encode("take").buffer, 0);
    // The sidecar cannot be written: the move already happened.
    vi.spyOn(LibraryVault.prototype, "writeMeta").mockRejectedValueOnce(new Error("disk full"));

    await expect(
      writer.finalize("s1", { title: "T", durationSeconds: 1, durationMs: 1000 }),
    ).rejects.toBeInstanceOf(FinalizeMoveError);
    // No orphan .mp4 (nor its reserved stub) in the vault, and the take is back in staging.
    expect((await readdir(vaultDir)).filter((f) => f.endsWith(".mp4"))).toHaveLength(0);
    expect(await readdir(join(vaultDir, ".kaipu"))).toEqual([]);
    expect(await readFile(tempPath, "utf-8")).toBe("take");
    const dest = join(tempDir, "rescued.mp4");
    await writer.salvage("s1", dest);
    expect(await readFile(dest, "utf-8")).toBe("take");
  });

  it("a metadata failure whose take-back also fails keeps the media in the vault and offers no salvage", async () => {
    const vaultDir = await mkdtemp(join(tmpdir(), "rw-vault-"));
    const tempDir = await mkdtemp(join(tmpdir(), "rw-temp-"));
    const writer = new RecordingWriter({ vaultDir: () => vaultDir, now: () => 5000, tempDir });
    // The sidecar write runs once the media is in the vault: from then on staging refuses
    // the move back, and the write itself fails.
    vi.spyOn(LibraryVault.prototype, "writeMeta").mockImplementationOnce(async () => {
      chmodSync(tempDir, 0o500);
      throw new Error("disk full");
    });
    try {
      await writer.create("s1");
      await writer.write("s1", new TextEncoder().encode("take").buffer, 0);

      const finalized = writer.finalize("s1", { title: "T", durationSeconds: 1, durationMs: 1000 });

      // The staging file is gone, so a salvage offer would fail: the error must not make one.
      await expect(finalized).rejects.toThrow();
      await expect(finalized).rejects.not.toBeInstanceOf(FinalizeMoveError);
      // The only copy stays where it is, and the library lists it without its sidecar.
      expect(await readFile(join(vaultDir, "T.mp4"), "utf-8")).toBe("take");
    } finally {
      chmodSync(tempDir, 0o700);
    }
  });

  it("a metadata failure never moves out or removes a file that replaced the take meanwhile", async () => {
    const { writer, vaultDir } = await setup();
    const { tempPath } = await writer.create("s1");
    await writer.write("s1", new TextEncoder().encode("take").buffer, 0);
    vi.spyOn(LibraryVault.prototype, "writeMeta").mockImplementationOnce(async () => {
      await writeFile(join(vaultDir, "foreign"), "incoming");
      await rename(join(vaultDir, "foreign"), join(vaultDir, "T.mp4"));
      throw new Error("disk full");
    });
    await expect(
      writer.finalize("s1", { title: "T", durationSeconds: 1, durationMs: 1000 }),
    ).rejects.toThrow();
    expect(await readFile(join(vaultDir, "T.mp4"), "utf-8")).toBe("incoming");
    await expect(access(tempPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("names the take after its title, and a second take with the same title ' (2)'", async () => {
    const { writer, vaultDir } = await setup();
    for (const session of ["s1", "s2"]) {
      await writer.create(session);
      await writer.write(session, new TextEncoder().encode(session).buffer, 0);
    }
    const title = "Kaipu Recording 2026-10-29 at 13.51.00";
    const first = await writer.finalize("s1", { title, durationSeconds: 1, durationMs: 1000 });
    const second = await writer.finalize("s2", { title, durationSeconds: 1, durationMs: 1000 });
    expect([first.id, second.id]).toEqual([title, `${title} (2)`]);
    expect(await readFile(join(vaultDir, `${title}.mp4`), "utf-8")).toBe("s1");
    expect(await readFile(join(vaultDir, `${title} (2).mp4`), "utf-8")).toBe("s2");
  });

  it("refuses a second create under an open id and keeps the first session's bytes", async () => {
    const { writer } = await setup();
    const { tempPath } = await writer.create("s1");
    await writer.write("s1", new TextEncoder().encode("only copy").buffer, 0);
    await expect(writer.create("s1")).rejects.toThrow(/already open/);
    expect(await readFile(tempPath, "utf-8")).toBe("only copy");
    const rec = await writer.finalize("s1", { title: "T", durationSeconds: 1, durationMs: 1000 });
    expect(await readFile(rec.filePath, "utf-8")).toBe("only copy");
  });

  it("gives every session its own staging file, so a released partial is never truncated", async () => {
    const { writer } = await setup();
    const first = await writer.create("s1");
    await writer.write("s1", new TextEncoder().encode("only copy").buffer, 0);
    await writer.release("s1");
    const second = await writer.create("s1");
    expect(second.tempPath).not.toBe(first.tempPath);
    expect(await readFile(first.tempPath, "utf-8")).toBe("only copy");
    // A cleanup bound to the first session never touches the second one.
    await writer.abort("s1", first.tempPath);
    await writer.write("s1", new TextEncoder().encode("new").buffer, 0);
    expect(await readFile(second.tempPath, "utf-8")).toBe("new");
    expect(await readFile(first.tempPath, "utf-8")).toBe("only copy");
  });

  it("never replaces a file already at the destination it allocated", async () => {
    const { writer, vaultDir } = await setup();
    await writer.create("s1");
    await writer.write("s1", new TextEncoder().encode("new take").buffer, 0);
    // Something lands on the stem between the reservation and the move.
    const reserve = LibraryVault.prototype.reserve;
    vi.spyOn(LibraryVault.prototype, "reserve").mockImplementationOnce(
      async function (this: LibraryVault, input) {
        const reservation = await reserve.call(this, input);
        await writeFile(join(vaultDir, `${reservation.id}.mp4`), "other recording");
        return reservation;
      },
    );
    await expect(
      writer.finalize("s1", { title: "T", durationSeconds: 1, durationMs: 1000 }),
    ).rejects.toBeInstanceOf(FinalizeMoveError);
    expect(await readFile(join(vaultDir, "T.mp4"), "utf-8")).toBe("other recording");
  });

  it("discardExport deletes a stranded partial, only for the session bound to its staging file", async () => {
    const { writer, tempDir } = await setup();
    const { tempPath } = await writer.create("e1");
    await writer.write("e1", new TextEncoder().encode("export").buffer, 0);
    vi.spyOn(LibraryVault.prototype, "reserve").mockRejectedValueOnce(new Error("no stem"));
    await expect(
      writer.finalize("e1", { title: "T", durationSeconds: 1, durationMs: 1000 }),
    ).rejects.toBeInstanceOf(FinalizeMoveError);

    await writer.discardExport("e1", join(tempDir, "another.mp4.part"));
    expect(await readFile(tempPath, "utf-8")).toBe("export");
    await writer.discardExport("e1", tempPath);
    await expect(access(tempPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(writer.ids()).toEqual([]);
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
    const sidecar = JSON.parse(await readFile(join(vaultDir, ".kaipu", "Export.json"), "utf-8"));
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
    const sidecar = JSON.parse(
      await readFile(join(vaultDir, ".kaipu", "Export (vertical).json"), "utf-8"),
    );
    expect(sidecar.exportPreset).toBe("vertical");
    expect(sidecar.exportFingerprint).toBe("edit:abc123");
  });

  it("persists where a copy for a destination is going, and only a known one", async () => {
    const { writer, vaultDir } = await setup();
    await writer.create("s1");
    await writer.write("s1", new TextEncoder().encode("A").buffer, 0);
    const rec = await writer.finalize("s1", {
      title: "Take (for email)",
      durationSeconds: 1,
      durationMs: 1000,
      exportPreset: "balanced",
      exportFingerprint: "whole#q30",
      exportDestination: "email",
    });
    const sidecar = JSON.parse(await readFile(join(vaultDir, ".kaipu", "rec-fixed.json"), "utf-8"));
    expect(sidecar.exportDestination).toBe("email");
    expect(rec.export?.destination).toBe("email");
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
    const sidecar = JSON.parse(await readFile(join(vaultDir, ".kaipu", "Rec.json"), "utf-8"));
    expect(sidecar).not.toHaveProperty("exportFingerprint");
  });
});

async function setupInVault() {
  const vaultDir = await mkdtemp(join(tmpdir(), "rw-vault-"));
  const fallbackTempDir = await mkdtemp(join(tmpdir(), "rw-fallback-"));
  const writer = new RecordingWriter({
    vaultDir: () => vaultDir,
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
    await writer.finalize("s1", { title: "t", durationSeconds: 1, durationMs: 1000 });
    expect(await readdir(join(vaultDir, ".kaipu", "tmp"))).toHaveLength(0);
    expect(await readdir(vaultDir)).toContain("t.mp4");
  });

  it("falls back to the fallback temp dir when the staging folder cannot be created", async () => {
    const { fallbackTempDir } = await setupInVault();
    const vaultPath = await unreachableVault();
    const writer = new RecordingWriter({
      vaultDir: () => vaultPath,
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
      fallbackTempDir,
    });
  }

  it("keeps the session and the .part when the destination cannot be created", async () => {
    const writer = await stranded();
    const { tempPath } = await writer.create("s1");
    await writer.write("s1", new TextEncoder().encode("hello").buffer, 0);
    await expect(
      writer.finalize("s1", { title: "t", durationSeconds: 1, durationMs: 1000 }),
    ).rejects.toBeInstanceOf(FinalizeMoveError);
    expect((await readFile(tempPath)).toString()).toBe("hello");
    await writer.abort("s1"); // the renderer always aborts after a failed finalize
    expect((await readFile(tempPath)).toString()).toBe("hello");
  });

  it("salvage moves a stranded take to the chosen path", async () => {
    const writer = await stranded();
    const { tempPath } = await writer.create("s1");
    await writer.write("s1", new TextEncoder().encode("hello").buffer, 0);
    await writer
      .finalize("s1", { title: "t", durationSeconds: 1, durationMs: 1000 })
      .catch(() => {});
    const dest = join(await mkdtemp(join(tmpdir(), "rw-else-")), "x.mp4");
    await writer.salvage("s1", dest);
    expect((await readFile(dest)).toString()).toBe("hello");
    await expect(stat(tempPath)).rejects.toThrow();
    await expect(writer.salvage("s1", dest)).rejects.toThrow(/No stranded/);
  });
});

describe("RecordingWriter — a take stays in the workspace it started in", () => {
  it("finalizes into the folder bound at create, even when the active folder changed since", async () => {
    const first = await mkdtemp(join(tmpdir(), "rw-ws-a-"));
    const second = await mkdtemp(join(tmpdir(), "rw-ws-b-"));
    let active = first;
    const writer = new RecordingWriter({ vaultDir: () => active });

    await writer.create("s1");
    expect(writer.directoryOf("s1")).toBe(first);
    active = second;
    await writer.write("s1", new TextEncoder().encode("abc").buffer, 0);
    const recording = await writer.finalize("s1", {
      title: "t",
      durationSeconds: 1,
      durationMs: 1000,
    });

    expect(recording.filePath.startsWith(first)).toBe(true);
    expect(await readdir(second)).toEqual([]);
  });

  it("refuses the take when the workspace is not connected, and stages nothing", async () => {
    const fallbackTempDir = await mkdtemp(join(tmpdir(), "rw-fallback-"));
    const writer = new RecordingWriter({
      vaultDir: async () => {
        throw new Error("Work isn't connected");
      },
      fallbackTempDir,
    });

    await expect(writer.create("s1")).rejects.toThrow("Work isn't connected");
    expect(await readdir(fallbackTempDir)).toEqual([]);
    expect(writer.ids()).toEqual([]);
  });

  it("does not recreate a bound folder that vanished mid-take: the take stays salvageable", async () => {
    const parent = await mkdtemp(join(tmpdir(), "rw-gone-"));
    const vaultDir = join(parent, "Kaipu");
    await mkdir(vaultDir);
    const fallbackTempDir = await mkdtemp(join(tmpdir(), "rw-fallback-"));
    const writer = new RecordingWriter({
      vaultDir: () => vaultDir,
      tempDir: fallbackTempDir,
    });
    await writer.create("s1");
    await writer.write("s1", new TextEncoder().encode("hello").buffer, 0);
    await rm(vaultDir, { recursive: true });

    await expect(
      writer.finalize("s1", { title: "t", durationSeconds: 1, durationMs: 1000 }),
    ).rejects.toBeInstanceOf(FinalizeMoveError);
    await expect(readdir(vaultDir)).rejects.toThrow();
  });
});
