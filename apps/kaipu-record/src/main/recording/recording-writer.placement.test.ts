import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Fifth review of NIW2-561: a short write on a volume without hard links, a confirmed
// overwrite whose copy fails before it starts, and a placed take whose staging file can be
// neither removed nor renamed. None can be produced portably on a real disk.
const hooks = vi.hoisted(() => ({
  linkError: null as null | string,
  /** Byte cap per write on a handle opened "wx" (the placement's own file). */
  writeCap: null as null | number,
  failUnlink: new Set<string>(),
  failRename: null as null | ((from: string, to: string) => boolean),
  failCopyFile: false,
}));

vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>();
  return {
    ...actual,
    link: async (from: string, to: string) => {
      if (hooks.linkError) {
        throw Object.assign(new Error(hooks.linkError), { code: hooks.linkError });
      }
      return actual.link(from, to);
    },
    open: async (path: string, flags?: string, mode?: number) => {
      const handle = await actual.open(path, flags, mode);
      if (flags !== "wx" || hooks.writeCap === null) return handle;
      const write = handle.write.bind(handle) as (
        b: Buffer,
        o: number,
        n: number,
        p: number,
      ) => Promise<{ bytesWritten: number; buffer: Buffer }>;
      return Object.assign(handle, {
        write: (b: Buffer, o: number, n: number, p: number) =>
          write(b, o, Math.min(n, hooks.writeCap!), p),
      });
    },
    unlink: async (path: string) => {
      if (hooks.failUnlink.has(path)) throw Object.assign(new Error("EPERM"), { code: "EPERM" });
      return actual.unlink(path);
    },
    rename: async (from: string, to: string) => {
      if (hooks.failRename?.(from, to)) {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      }
      return actual.rename(from, to);
    },
    copyFile: async (...args: Parameters<typeof actual.copyFile>) => {
      if (hooks.failCopyFile) throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      return actual.copyFile(...args);
    },
  };
});

import { FinalizeMoveError, RecordingWriter } from "./recording-writer";
import { recoverStrandedRecordings } from "./stranded-recordings";

afterEach(() => {
  hooks.linkError = null;
  hooks.writeCap = null;
  hooks.failUnlink.clear();
  hooks.failRename = null;
  hooks.failCopyFile = false;
  vi.restoreAllMocks();
});

const meta = { title: "Take", durationSeconds: 1, durationMs: 1000 };

async function recorded(content: Buffer | string) {
  const vaultDir = await mkdtemp(join(tmpdir(), "rw-place-"));
  const writer = new RecordingWriter({ vaultDir: () => vaultDir });
  const { tempPath } = await writer.create("s1");
  const bytes = typeof content === "string" ? Buffer.from(content) : content;
  await writer.write(
    "s1",
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
    0,
  );
  return { vaultDir, writer, tempPath };
}

describe("finalize on a volume without hard links", () => {
  it("writes every byte when the disk accepts only part of each write", async () => {
    const content = Buffer.alloc((1 << 20) + 777, 3);
    content.write("end", content.length - 3);
    const { vaultDir, writer, tempPath } = await recorded(content);
    hooks.linkError = "EPERM";
    hooks.writeCap = 1000;

    const recording = await writer.finalize("s1", meta);
    expect((await readFile(join(vaultDir, `${recording.id}.mp4`))).equals(content)).toBe(true);
    await expect(readFile(tempPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("salvage onto a file the user confirmed replacing", () => {
  it("keeps the existing file when the move fails before anything is written", async () => {
    // A vault path that is a file, not a folder: finalize strands the take.
    const vaultPath = join(await mkdtemp(join(tmpdir(), "rw-place-")), "vault");
    await writeFile(vaultPath, "not a folder");
    const writer = new RecordingWriter({
      vaultDir: () => vaultPath,
      fallbackTempDir: await mkdtemp(join(tmpdir(), "rw-place-tmp-")),
    });
    const { tempPath } = await writer.create("s1");
    await writer.write("s1", new TextEncoder().encode("new").buffer, 0);
    await expect(writer.finalize("s1", meta)).rejects.toBeInstanceOf(FinalizeMoveError);

    const dest = join(await mkdtemp(join(tmpdir(), "rw-place-dest-")), "Take.mp4");
    await writeFile(dest, "old recording");
    hooks.linkError = "EXDEV";
    hooks.failRename = () => true;
    hooks.failCopyFile = true;
    await expect(writer.salvage("s1", dest)).rejects.toMatchObject({ code: "EACCES" });
    expect(await readFile(dest, "utf-8")).toBe("old recording");
    expect(await readFile(tempPath, "utf-8")).toBe("new");
  });
});

describe("a placed take whose staging file can be neither removed nor renamed", () => {
  it.each([null, "EPERM"])(
    "is not recovered as a second recording (link error: %s)",
    async (linkError) => {
      const { vaultDir, writer, tempPath } = await recorded("new recording");
      hooks.linkError = linkError;
      hooks.failUnlink.add(tempPath);
      hooks.failRename = (from) => from === tempPath;
      vi.spyOn(console, "error").mockImplementation(() => {});

      const recording = await writer.finalize("s1", meta);
      hooks.failUnlink.clear();
      hooks.failRename = null;

      const swept = await recoverStrandedRecordings({
        vaultDir,
        fallbackTempDir: await mkdtemp(join(tmpdir(), "rw-place-empty-")),
        title: "Recovered",
        now: () => Date.now() + 10 * 60_000,
      });
      expect(swept.recovered).toEqual([]);
      expect((await readdir(vaultDir)).filter((n) => n.endsWith(".mp4"))).toEqual([
        `${recording.id}.mp4`,
      ]);
      // The sweep finished the cleanup the placement could not.
      expect(await readdir(join(vaultDir, ".kaipu", "tmp"))).toEqual([]);
    },
  );
});
