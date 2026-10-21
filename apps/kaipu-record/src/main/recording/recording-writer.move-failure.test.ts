import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// Cross-volume rename failure (EXDEV) followed by a failed copy (ENOSPC) can't be
// triggered portably against a real disk, so the move primitives are mocked.
const { renameMock, copyFileMock, unlinkMock } = vi.hoisted(() => ({
  renameMock: vi.fn(async () => {
    throw Object.assign(new Error("EXDEV"), { code: "EXDEV" });
  }),
  copyFileMock: vi.fn(async () => {
    throw Object.assign(new Error("ENOSPC"), { code: "ENOSPC" });
  }),
  unlinkMock: vi.fn(async () => {}),
}));

vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>();
  return { ...actual, rename: renameMock, copyFile: copyFileMock, unlink: unlinkMock };
});

import { FinalizeMoveError, RecordingWriter } from "./recording-writer";

describe("RecordingWriter — finalize move failure", () => {
  it("removes the partial destination and keeps the .part", async () => {
    const vaultDir = await mkdtemp(join(tmpdir(), "rw-vault-"));
    const tempDir = await mkdtemp(join(tmpdir(), "rw-temp-"));
    const writer = new RecordingWriter({
      vaultDir: () => vaultDir,
      newId: () => "rec-fixed",
      tempDir,
    });
    const { tempPath } = await writer.create("s1");
    await writer.write("s1", new TextEncoder().encode("hello").buffer, 0);
    await expect(writer.finalize("s1", { title: "t", durationSeconds: 1 })).rejects.toBeInstanceOf(
      FinalizeMoveError,
    );
    expect(unlinkMock).toHaveBeenCalledWith(join(vaultDir, "rec-fixed.mp4"));
    expect(unlinkMock).not.toHaveBeenCalledWith(tempPath);
    expect((await readFile(tempPath)).toString()).toBe("hello");
  });
});
