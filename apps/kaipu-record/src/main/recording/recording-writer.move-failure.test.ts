import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// Cross-volume rename failure (EXDEV) followed by a failed copy (ENOSPC) can't be
// triggered portably against a real disk, so the move primitives are mocked.
// Only the take's move fails: the vault's atomic sidecar writes rename too.
const { renameMock, linkMock, copyFileMock, unlinkMock, realRename } = vi.hoisted(() => {
  const realRename = { fn: null as null | ((from: string, to: string) => Promise<void>) };
  return {
    realRename,
    renameMock: vi.fn(async (from: string, to: string) => {
      if (from.endsWith(".mp4.part")) throw Object.assign(new Error("EXDEV"), { code: "EXDEV" });
      return realRename.fn!(from, to);
    }),
    linkMock: vi.fn(async () => {
      throw Object.assign(new Error("EXDEV"), { code: "EXDEV" });
    }),
    copyFileMock: vi.fn(async () => {
      throw Object.assign(new Error("ENOSPC"), { code: "ENOSPC" });
    }),
    unlinkMock: vi.fn(async () => {}),
  };
});

vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>();
  realRename.fn = actual.rename;
  return {
    ...actual,
    rename: renameMock,
    link: linkMock,
    copyFile: copyFileMock,
    unlink: unlinkMock,
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
});
