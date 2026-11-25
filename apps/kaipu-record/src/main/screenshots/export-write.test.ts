import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  /** Writes to files under this folder fail with ENOSPC (`writeFile` after storing half). */
  failWritesUnder: null as null | string,
  /** `link` fails with EXDEV, as across volumes, so placement copies. */
  noLinks: false,
  /** A rename onto this path fails with EACCES. */
  failRenameOnto: null as null | string,
}));

function noSpace(): NodeJS.ErrnoException {
  return Object.assign(new Error("ENOSPC"), { code: "ENOSPC" });
}

vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      const failing =
        hooks.failWritesUnder !== null && String(args[0]).startsWith(hooks.failWritesUnder);
      return new Proxy(handle, {
        get(target, key) {
          if (failing && key === "writeFile") {
            return async (data: Uint8Array) => {
              await target.write(data.subarray(0, data.length / 2));
              throw noSpace();
            };
          }
          if (failing && key === "write") {
            return async () => {
              throw noSpace();
            };
          }
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
    link: async (from: string, to: string) => {
      if (hooks.noLinks) throw Object.assign(new Error("EXDEV"), { code: "EXDEV" });
      await actual.link(from, to);
    },
    rename: async (from: string, to: string) => {
      if (hooks.failRenameOnto === to) {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      }
      await actual.rename(from, to);
    },
  };
});

import { writeExportFile } from "./export-write";

const created: string[] = [];

afterEach(async () => {
  hooks.failWritesUnder = null;
  hooks.noLinks = false;
  hooks.failRenameOnto = null;
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup() {
  const destDir = await mkdtemp(join(tmpdir(), "kaipu-export-dest-"));
  const stageRoot = await mkdtemp(join(tmpdir(), "kaipu-export-stage-"));
  created.push(destDir, stageRoot);
  const target = join(destDir, "Screenshot.png");
  await writeFile(target, "old export");
  return { destDir, stageRoot, target };
}

describe("writeExportFile", () => {
  it("replaces a confirmed destination and leaves no staging files", async () => {
    const { destDir, stageRoot, target } = await setup();
    await writeExportFile(target, Buffer.from("new export"), stageRoot);
    expect(await readFile(target, "utf8")).toBe("new export");
    expect(await readdir(destDir)).toEqual(["Screenshot.png"]);
    expect(await readdir(stageRoot)).toEqual([]);
  });

  it("writes a destination that did not exist", async () => {
    const { destDir, stageRoot } = await setup();
    const target = join(destDir, "New.pdf");
    await writeExportFile(target, Buffer.from("pdf bytes"), stageRoot);
    expect(await readFile(target, "utf8")).toBe("pdf bytes");
  });

  it("a failed write does not truncate a confirmed overwrite", async () => {
    const { destDir, stageRoot, target } = await setup();
    hooks.failWritesUnder = stageRoot;
    await expect(
      writeExportFile(target, Buffer.from("new export"), stageRoot),
    ).rejects.toMatchObject({ code: "ENOSPC" });
    expect(await readFile(target, "utf8")).toBe("old export");
    expect(await readdir(destDir)).toEqual(["Screenshot.png"]);
    expect(await readdir(stageRoot)).toEqual([]);
  });

  it("a failed copy onto another volume does not truncate a confirmed overwrite", async () => {
    const { destDir, stageRoot, target } = await setup();
    hooks.noLinks = true;
    hooks.failWritesUnder = destDir;
    await expect(
      writeExportFile(target, Buffer.from("new export"), stageRoot),
    ).rejects.toMatchObject({ code: "ENOSPC" });
    expect(await readFile(target, "utf8")).toBe("old export");
    expect(await readdir(destDir)).toEqual(["Screenshot.png"]);
    expect(await readdir(stageRoot)).toEqual([]);
  });

  it("replaces a confirmed destination on another volume", async () => {
    const { destDir, stageRoot, target } = await setup();
    hooks.noLinks = true;
    await writeExportFile(target, Buffer.from("new export"), stageRoot);
    expect(await readFile(target, "utf8")).toBe("new export");
    expect(await readdir(destDir)).toEqual(["Screenshot.png"]);
  });

  it("a failed final move keeps the existing destination", async () => {
    const { destDir, stageRoot, target } = await setup();
    hooks.failRenameOnto = target;
    await expect(
      writeExportFile(target, Buffer.from("new export"), stageRoot),
    ).rejects.toMatchObject({ code: "EACCES" });
    expect(await readFile(target, "utf8")).toBe("old export");
    expect(await readdir(destDir)).toEqual(["Screenshot.png"]);
    expect(await readdir(stageRoot)).toEqual([]);
  });
});
