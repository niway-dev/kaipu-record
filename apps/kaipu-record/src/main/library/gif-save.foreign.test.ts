import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

// A volume without hard links whose copy fails after another process moved its own file onto
// the GIF's name: neither can be produced portably on a real disk, so the primitives are
// wrapped. Sixth review of NIW2-561 (S3).
const hooks = vi.hoisted(() => ({ foreign: null as null | string }));

vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>();
  return {
    ...actual,
    link: async () => {
      throw Object.assign(new Error("EPERM"), { code: "EPERM" });
    },
    open: async (path: string, flags?: string, mode?: number) => {
      const handle = await actual.open(path, flags, mode);
      const foreign = hooks.foreign;
      if (flags !== "wx" || !path.endsWith(".gif") || !foreign) return handle;
      return Object.assign(handle, {
        write: async () => {
          await actual.rename(foreign, path);
          throw Object.assign(new Error("ENOSPC"), { code: "ENOSPC" });
        },
      });
    },
  };
});

import { saveGif } from "./gif-save";

afterEach(() => {
  hooks.foreign = null;
});

it("a failed save never removes a file that took the GIF's name", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kaipu-gif-foreign-"));
  hooks.foreign = join(directory, "foreign");
  await writeFile(hooks.foreign, "incoming");
  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2, 3, 4]);
  await expect(
    saveGif({ vaultDir: () => directory }, gif, {
      title: "shot",
      durationSeconds: 1,
      width: 1,
      height: 1,
      fps: 1,
      thumbnail: null,
      derivedFromAssetId: null,
    }),
  ).rejects.toMatchObject({ code: "ENOSPC" });
  expect(await readFile(join(directory, "shot.gif"), "utf-8")).toBe("incoming");
  // Only the reservation this save made is released.
  expect(await readdir(join(directory, ".kaipu"))).toEqual([]);
});
