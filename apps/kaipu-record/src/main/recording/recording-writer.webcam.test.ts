import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RecordingFinalizeMeta } from "@shared/types/ipc";

// A real temp dir, except that a chunk reading "FAIL" makes its positional write reject: a
// disk-write failure cannot be triggered portably otherwise (see the write-failure test).
vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      const write = handle.write.bind(handle) as (...a: unknown[]) => Promise<unknown>;
      return Object.assign(handle, {
        write: (buffer: Buffer, ...rest: unknown[]) =>
          buffer.toString() === "FAIL"
            ? Promise.reject(new Error("ENOSPC: no space left on device"))
            : write(buffer, ...rest),
      });
    },
  };
});

import { FinalizeMoveError, RecordingWriter } from "./recording-writer";

async function setup(options: { vault?: () => string } = {}) {
  const vaultDir = await mkdtemp(join(tmpdir(), "rw-vault-"));
  const tempDir = await mkdtemp(join(tmpdir(), "rw-temp-"));
  const writer = new RecordingWriter({
    vaultDir: options.vault ?? (() => vaultDir),
    now: () => 5000,
    tempDir,
  });
  return { writer, vaultDir, tempDir };
}

const bytes = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer;

const webcamMeta = {
  startOffsetMs: 21.5,
  offsetQuality: "exact",
  width: 1280,
  height: 720,
  fps: 30,
} as const;

// The take's file name follows its title (ADR 0035): "rec-fixed" lands as `rec-fixed.mp4`.
const meta = (over: Partial<RecordingFinalizeMeta> = {}): RecordingFinalizeMeta => ({
  title: "rec-fixed",
  durationSeconds: 1,
  durationMs: 1000,
  ...over,
});

/** Staging names without their random tail: `kaipu-rec-s1-1a2b3c4d.mp4.part` → `kaipu-rec-s1.mp4.part`. */
const untailed = (names: string[]): string[] =>
  names.map((name) => name.replace(/-[0-9a-f]{8}(?=\.)/, "")).sort();

/** A take with both sessions open and a byte in each. */
async function pair(writer: RecordingWriter): Promise<void> {
  await writer.create("s1");
  await writer.create("s1", "webcam");
  await writer.write("s1", bytes("SCREEN"), 0);
  await writer.write("s1", bytes("WEBCAM"), 0, "webcam");
}

const readSidecar = async (vaultDir: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(join(vaultDir, ".kaipu", "rec-fixed.json"), "utf-8"));

describe("RecordingWriter — the webcam session", () => {
  it("stages the webcam beside the screen as kaipu-rec-<id>-<tail>.webcam.mp4.part", async () => {
    const { writer, tempDir } = await setup();
    const screen = await writer.create("s1");
    const webcam = await writer.create("s1", "webcam");
    expect(screen.tempPath).toMatch(/kaipu-rec-s1-[0-9a-f]{8}\.mp4\.part$/);
    expect(webcam.tempPath).toBe(screen.tempPath.replace(/\.mp4\.part$/, ".webcam.mp4.part"));
    expect(untailed(await readdir(tempDir))).toEqual([
      "kaipu-rec-s1.mp4.part",
      "kaipu-rec-s1.webcam.mp4.part",
    ]);
  });

  it("refuses a webcam session without an open screen session, and a second one", async () => {
    const { writer } = await setup();
    await expect(writer.create("s1", "webcam")).rejects.toThrow(/to add a webcam to/);
    await writer.create("s1");
    await writer.create("s1", "webcam");
    await expect(writer.create("s1", "webcam")).rejects.toThrow(/already has a webcam/);
  });

  it("writes and stats each kind in its own file", async () => {
    const { writer } = await setup();
    await pair(writer);
    expect(await writer.stat("s1")).toBe(6);
    await writer.write("s1", bytes("++"), 6, "webcam");
    expect(await writer.stat("s1", "webcam")).toBe(8);
  });

  it("finalize places the webcam in .kaipu/<id>.webcam.mp4 and records it on the sidecar", async () => {
    const { writer, vaultDir, tempDir } = await setup();
    await pair(writer);
    const rec = await writer.finalize("s1", meta({ webcam: webcamMeta }));
    expect(await readFile(rec.filePath, "utf-8")).toBe("SCREEN");
    expect(await readFile(join(vaultDir, ".kaipu", "rec-fixed.webcam.mp4"), "utf-8")).toBe(
      "WEBCAM",
    );
    expect((await readSidecar(vaultDir)).webcam).toEqual(webcamMeta);
    expect(await readdir(tempDir)).toHaveLength(0);
    expect(writer.ids()).toEqual([]);
  });

  it("discards the webcam part when finalize carries no webcam meta (the webcam failed)", async () => {
    const { writer, vaultDir, tempDir } = await setup();
    await pair(writer);
    await writer.finalize("s1", meta({ webcam: null }));
    expect(await readdir(tempDir)).toHaveLength(0);
    expect(await readdir(join(vaultDir, ".kaipu"))).not.toContain("rec-fixed.webcam.mp4");
    expect(await readSidecar(vaultDir)).not.toHaveProperty("webcam");
  });

  it("drops a meta that cannot place the file, keeping the recording", async () => {
    const { writer, vaultDir } = await setup();
    await pair(writer);
    const rec = await writer.finalize(
      "s1",
      meta({ webcam: { ...webcamMeta, startOffsetMs: Number.NaN } }),
    );
    expect(rec.id).toBe("rec-fixed");
    expect(await readSidecar(vaultDir)).not.toHaveProperty("webcam");
  });

  it("a webcam write failure never fails the take: the recording saves without the webcam", async () => {
    const { writer, vaultDir } = await setup();
    await pair(writer);
    await expect(writer.write("s1", bytes("FAIL"), 0, "webcam")).rejects.toThrow(/ENOSPC/);
    expect(writer.hasFailed("s1")).toBe(false);
    expect(writer.hasFailed("s1", "webcam")).toBe(true);
    const rec = await writer.finalize("s1", meta({ webcam: webcamMeta }));
    expect(await readFile(rec.filePath, "utf-8")).toBe("SCREEN");
    expect(await readSidecar(vaultDir)).not.toHaveProperty("webcam");
  });

  it("finalize without a webcam session ignores a webcam meta", async () => {
    const { writer, vaultDir } = await setup();
    await writer.create("s1");
    await writer.write("s1", bytes("SCREEN"), 0);
    await writer.finalize("s1", meta({ webcam: webcamMeta }));
    expect(await readSidecar(vaultDir)).not.toHaveProperty("webcam");
  });

  it("a failed screen write discards the webcam too", async () => {
    const { writer, tempDir } = await setup();
    await pair(writer);
    await expect(writer.write("s1", bytes("FAIL"), 0)).rejects.toThrow(/ENOSPC/);
    await expect(writer.finalize("s1", meta({ webcam: webcamMeta }))).rejects.toThrow();
    expect(await readdir(tempDir)).toHaveLength(0);
    expect(writer.ids()).toEqual([]);
  });

  it("abort discards both parts of the take", async () => {
    const { writer, tempDir } = await setup();
    await pair(writer);
    await writer.abort("s1");
    expect(await readdir(tempDir)).toHaveLength(0);
    expect(writer.ids()).toEqual([]);
  });

  it("ids lists a take once, whatever its kinds", async () => {
    const { writer } = await setup();
    await pair(writer);
    expect(writer.ids()).toEqual(["s1"]);
  });

  it("releaseAll closes both handles and keeps both parts on disk", async () => {
    const { writer, tempDir } = await setup();
    await pair(writer);
    await writer.releaseAll();
    expect(untailed(await readdir(tempDir))).toEqual([
      "kaipu-rec-s1.mp4.part",
      "kaipu-rec-s1.webcam.mp4.part",
    ]);
    expect(writer.ids()).toEqual([]);
  });

  it("a vault that cannot be reached strands the pair, and salvage moves both side by side", async () => {
    const blocker = join(await mkdtemp(join(tmpdir(), "rw-block-")), "file");
    await writeFile(blocker, "not a directory");
    const { writer, tempDir } = await setup({ vault: () => join(blocker, "vault") });
    await pair(writer);
    await expect(writer.finalize("s1", meta({ webcam: webcamMeta }))).rejects.toBeInstanceOf(
      FinalizeMoveError,
    );
    // The renderer aborts after a failed finalize: a stranded pair is kept.
    await writer.abort("s1");
    expect(await readdir(tempDir)).toHaveLength(2);

    // Salvage is offered before the abort in the hub; here, on a fresh stranded pair.
    const second = await setup({ vault: () => join(blocker, "vault") });
    await pair(second.writer);
    await expect(second.writer.finalize("s1", meta())).rejects.toBeInstanceOf(FinalizeMoveError);
    const out = await mkdtemp(join(tmpdir(), "rw-out-"));
    await second.writer.salvage("s1", join(out, "take.mp4"));
    expect(await readFile(join(out, "take.mp4"), "utf-8")).toBe("SCREEN");
    expect(await readFile(join(out, "take.webcam.mp4"), "utf-8")).toBe("WEBCAM");
    expect(second.writer.ids()).toEqual([]);
  });

  it("a metadata failure takes both files back out of the vault, still salvageable", async () => {
    const { writer, vaultDir, tempDir } = await setup();
    await pair(writer);
    const { LibraryVault } = await import("../library/library-vault");
    const spy = vi
      .spyOn(LibraryVault.prototype, "writeMeta")
      .mockRejectedValueOnce(new Error("disk full"));
    await expect(writer.finalize("s1", meta({ webcam: webcamMeta }))).rejects.toBeInstanceOf(
      FinalizeMoveError,
    );
    spy.mockRestore();
    expect(untailed(await readdir(tempDir))).toEqual([
      "kaipu-rec-s1.mp4.part",
      "kaipu-rec-s1.webcam.mp4.part",
    ]);
    expect(await readdir(vaultDir)).not.toContain("rec-fixed.mp4");
    const kaipu = await readdir(join(vaultDir, ".kaipu")).catch(() => []);
    expect(kaipu).not.toContain("rec-fixed.webcam.mp4");
  });
});
