import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A disk-write failure (ENOSPC, ejected drive, permissions) can't be triggered
// portably through the real `FileHandle.write` — Node coerces bad positions and
// an out-of-bounds length isn't reachable via the public API. So this file mocks
// `fs/promises` to return a handle whose `write` rejects, isolating the
// failed-session behaviour. (The happy paths are covered against a real temp dir
// in `recording-writer.test.ts`.)
const { openMock, closeMock, unlinkMock } = vi.hoisted(() => {
  const closeMock = vi.fn(async () => {});
  return {
    closeMock,
    unlinkMock: vi.fn(async () => {}),
    openMock: vi.fn(async () => ({
      write: vi.fn(async () => {
        throw new Error("ENOSPC: no space left on device");
      }),
      close: closeMock,
    })),
  };
});

vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>();
  return { ...actual, open: openMock, unlink: unlinkMock };
});

import { RecordingWriter } from "./recording-writer";

describe("RecordingWriter — write failure", () => {
  let writer: RecordingWriter;

  beforeEach(() => {
    openMock.mockClear();
    closeMock.mockClear();
    unlinkMock.mockClear();
    writer = new RecordingWriter({
      vaultDir: () => "/vault",
      newId: () => "rec-fixed",
      now: () => 5000,
      tempDir: "/tmp",
    });
  });

  afterEach(() => vi.clearAllMocks());

  it("marks the session failed and rethrows when a positional write rejects", async () => {
    await writer.create("s1");
    await expect(writer.write("s1", new TextEncoder().encode("x").buffer, 0)).rejects.toThrow(
      /ENOSPC/,
    );
    expect(writer.hasFailed("s1")).toBe(true);
  });

  it("finalize refuses a failed session — rejects, cleans up the temp file, drops the session", async () => {
    await writer.create("s1");
    await expect(writer.write("s1", new TextEncoder().encode("x").buffer, 0)).rejects.toThrow();

    await expect(writer.finalize("s1", { title: "T", durationSeconds: 1 })).rejects.toThrow(
      /ENOSPC/,
    );
    // The truncated .part is deleted (never renamed into the vault) and the
    // session is gone, so a second finalize/hasFailed sees nothing.
    expect(unlinkMock).toHaveBeenCalledWith("/tmp/kaipu-rec-s1.mp4.part");
    expect(closeMock).toHaveBeenCalled();
    expect(writer.hasFailed("s1")).toBe(false);
  });
});
