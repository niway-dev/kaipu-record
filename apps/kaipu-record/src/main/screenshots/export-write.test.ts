import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  /** A staged write that stores half the bytes, then fails with ENOSPC. */
  failStagedWrite: false,
  /** A rename onto this path fails with EACCES. */
  failRenameOnto: null as null | string,
}));

vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      return new Proxy(handle, {
        get(target, key) {
          if (key === "writeFile" && hooks.failStagedWrite) {
            return async (data: Uint8Array) => {
              await target.write(data.subarray(0, data.length / 2));
              throw Object.assign(new Error("ENOSPC"), { code: "ENOSPC" });
            };
          }
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
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

afterEach(() => {
  hooks.failStagedWrite = false;
  hooks.failRenameOnto = null;
});

async function setup() {
  const destDir = await mkdtemp(join(tmpdir(), "kaipu-export-dest-"));
  const stageRoot = await mkdtemp(join(tmpdir(), "kaipu-export-stage-"));
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
    hooks.failStagedWrite = true;
    await expect(
      writeExportFile(target, Buffer.from("new export"), stageRoot),
    ).rejects.toMatchObject({ code: "ENOSPC" });
    expect(await readFile(target, "utf8")).toBe("old export");
    expect(await readdir(destDir)).toEqual(["Screenshot.png"]);
    expect(await readdir(stageRoot)).toEqual([]);
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
