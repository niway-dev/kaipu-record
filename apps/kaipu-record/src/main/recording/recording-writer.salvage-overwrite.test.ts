import { mkdtemp, readFile, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// Force the cross-volume path: rename always fails with EXDEV, so the move falls back to a real copy.
vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: vi.fn(async () => {
      throw Object.assign(new Error("EXDEV"), { code: "EXDEV" });
    }),
  };
});

import { FinalizeMoveError, RecordingWriter } from "./recording-writer";

describe("RecordingWriter.salvage — overwrite confirmed in the save dialog", () => {
  it("replaces an existing file even when rename falls back to copy", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "rw-temp-"));
    const picked = join(await mkdtemp(join(tmpdir(), "rw-picked-")), "mine.mp4");
    await writeFile(picked, "old take");
    const writer = new RecordingWriter({
      // A vault path under a regular file cannot be created, so finalize strands the take.
      vaultDir: () => join(picked, "not-a-dir"),
      tempDir,
    });
    const { tempPath } = await writer.create("s1");
    await writer.write("s1", new TextEncoder().encode("new take").buffer, 0);
    await expect(
      writer.finalize("s1", { title: "t", durationSeconds: 1, durationMs: 1000 }),
    ).rejects.toBeInstanceOf(FinalizeMoveError);

    await writer.salvage("s1", picked);

    expect((await readFile(picked)).toString()).toBe("new take");
    await expect(access(tempPath)).rejects.toThrow();
  });
});
