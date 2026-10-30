import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// A cross-volume move (EXDEV) whose copy then fails (ENOSPC) can't be triggered portably
// against a real disk, so the move primitives are mocked: the take's copy into the vault fails
// on its first write.
const { linkMock, unlinkMock, arrival } = vi.hoisted(() => ({
  /** A file another process moves onto the destination just before the copy fails. */
  arrival: { foreign: null as null | string },
  linkMock: vi.fn(async () => {
    throw Object.assign(new Error("EXDEV"), { code: "EXDEV" });
  }),
  unlinkMock: vi.fn(async () => {}),
}));

vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>();
  return {
    ...actual,
    link: linkMock,
    unlink: unlinkMock,
    open: async (path: string, ...rest: [string?, number?]) => {
      const handle = await actual.open(path, ...rest);
      if (!path.endsWith(".mp4") || rest[0] !== "wx") return handle;
      return Object.assign(handle, {
        write: async () => {
          if (arrival.foreign) await actual.rename(arrival.foreign, path);
          throw Object.assign(new Error("ENOSPC"), { code: "ENOSPC" });
        },
      });
    },
  };
});

import { FinalizeMoveError, RecordingWriter } from "./recording-writer";

describe("RecordingWriter — finalize move failure", () => {
  it("removes the partial destination and keeps the .part", async () => {
    const vaultDir = await mkdtemp(join(tmpdir(), "rw-vault-"));
    const tempDir = await mkdtemp(join(tmpdir(), "rw-temp-"));
    const writer = new RecordingWriter({
      vaultDir: () => vaultDir,
      tempDir,
    });
    const { tempPath } = await writer.create("s1");
    await writer.write("s1", new TextEncoder().encode("hello").buffer, 0);
    await expect(
      writer.finalize("s1", { title: "t", durationSeconds: 1, durationMs: 1000 }),
    ).rejects.toBeInstanceOf(FinalizeMoveError);
    expect(unlinkMock).toHaveBeenCalledWith(join(vaultDir, "t.mp4"));
    expect(unlinkMock).not.toHaveBeenCalledWith(tempPath);
    expect((await readFile(tempPath)).toString()).toBe("hello");
    // The reserved stem is released: no stub sidecar is left in the vault.
    expect(await readdir(join(vaultDir, ".kaipu"))).toEqual([]);
  });

  it("never removes a file that took the destination before the copy failed", async () => {
    const vaultDir = await mkdtemp(join(tmpdir(), "rw-vault-"));
    const tempDir = await mkdtemp(join(tmpdir(), "rw-temp-"));
    arrival.foreign = join(vaultDir, "foreign");
    await writeFile(arrival.foreign, "incoming");
    const writer = new RecordingWriter({ vaultDir: () => vaultDir, tempDir });
    const { tempPath } = await writer.create("s1");
    await writer.write("s1", new TextEncoder().encode("hello").buffer, 0);
    try {
      await expect(
        writer.finalize("s1", { title: "t", durationSeconds: 1, durationMs: 1000 }),
      ).rejects.toBeInstanceOf(FinalizeMoveError);
    } finally {
      arrival.foreign = null;
    }
    expect(await readFile(join(vaultDir, "t.mp4"), "utf-8")).toBe("incoming");
    expect((await readFile(tempPath)).toString()).toBe("hello");
    expect(await readdir(join(vaultDir, ".kaipu"))).toEqual([]);
  });
});
