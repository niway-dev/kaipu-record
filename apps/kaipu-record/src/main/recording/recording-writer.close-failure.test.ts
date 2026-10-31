import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const hook = vi.hoisted(() => ({ failClose: false }));

// Fail the staging handle's close once: the bytes are written, the close reports EIO.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (
      path: string,
      ...args: Parameters<typeof actual.open> extends [unknown, ...infer R] ? R : never
    ) => {
      const handle = await actual.open(path, ...args);
      if (args[0] === "wx+" && String(path).endsWith(".mp4.part")) {
        const close = handle.close.bind(handle);
        handle.close = async () => {
          await close();
          if (hook.failClose) {
            hook.failClose = false;
            throw Object.assign(new Error("close I/O error"), { code: "EIO" });
          }
        };
      }
      return handle;
    },
  };
});

const { FinalizeMoveError, RecordingWriter } = await import("./recording-writer");
const { replaceConfirmed } = await import("../library/safe-place");

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kaipu-close-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  hook.failClose = false;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("RecordingWriter finalize when closing the staging file fails", () => {
  it("strands the take, so the renderer's abort after the failure keeps its bytes", async () => {
    const vault = await tempDir();
    const writer = new RecordingWriter({ vaultDir: () => vault });
    const { tempPath } = await writer.create("close");
    await writer.write("close", new TextEncoder().encode("only recording bytes").buffer, 0);

    hook.failClose = true;
    await expect(
      writer.finalize("close", { title: "Test", durationSeconds: 1 } as never),
    ).rejects.toBeInstanceOf(FinalizeMoveError);
    await writer.abort("close");

    expect(await readFile(tempPath, "utf8")).toBe("only recording bytes");
    // The reserved stem is given back: no stub record is left behind in the vault.
    expect((await readdir(vault)).filter((name) => name.endsWith(".mp4"))).toEqual([]);
  });
});

describe("replaceConfirmed onto its own path", () => {
  it("leaves the file where it is", async () => {
    const dir = await tempDir();
    const path = join(dir, "take.mp4");
    await writeFile(path, "only recording bytes");

    await replaceConfirmed(path, path);

    expect(await readFile(path, "utf8")).toBe("only recording bytes");
    expect(await readdir(dir)).toEqual(["take.mp4"]);
  });
});
