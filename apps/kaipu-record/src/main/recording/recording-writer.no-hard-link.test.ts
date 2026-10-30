import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// A volume without hard links (exFAT, some network shares), a file that arrives at the
// destination while a take is being placed, and a staging file that cannot be removed: none
// can be produced portably on a real disk, so the primitives are wrapped.
const hooks = vi.hoisted(() => ({
  linkError: null as null | string,
  /** Runs once, the first time the destination is looked at or opened after the link failed. */
  arrival: null as null | ((path: string) => Promise<void>),
  failUnlink: new Set<string>(),
  failRename: new Set<string>(),
}));

vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>();
  const arrive = async (path: string) => {
    const run = hooks.arrival;
    hooks.arrival = null;
    if (run) await run(path);
  };
  return {
    ...actual,
    link: async (from: string, to: string) => {
      if (hooks.linkError)
        throw Object.assign(new Error(hooks.linkError), { code: hooks.linkError });
      return actual.link(from, to);
    },
    // Arrival right after a check that found nothing.
    lstat: async (path: string) => {
      try {
        return await actual.lstat(path);
      } finally {
        if (path.endsWith(".mp4")) await arrive(path);
      }
    },
    // Arrival right before the destination is created.
    open: async (path: string, ...rest: [string?, number?]) => {
      if (path.endsWith(".mp4")) await arrive(path);
      return actual.open(path, ...rest);
    },
    unlink: async (path: string) => {
      if (hooks.failUnlink.has(path)) throw Object.assign(new Error("EPERM"), { code: "EPERM" });
      return actual.unlink(path);
    },
    rename: async (from: string, to: string) => {
      if (hooks.failRename.has(from)) throw Object.assign(new Error("EPERM"), { code: "EPERM" });
      return actual.rename(from, to);
    },
  };
});

import { STAGING_DIR, moveFile } from "./recording-writer";
import { recoverStrandedRecordings } from "./stranded-recordings";

afterEach(() => {
  hooks.linkError = null;
  hooks.arrival = null;
  hooks.failUnlink.clear();
  hooks.failRename.clear();
});

async function stagedTake() {
  const vaultDir = await mkdtemp(join(tmpdir(), "rw-nolink-"));
  const staging = join(vaultDir, STAGING_DIR);
  await import("node:fs/promises").then((fs) => fs.mkdir(staging, { recursive: true }));
  const from = join(staging, "kaipu-rec-s1-abcd1234.mp4.part");
  await writeFile(from, "new recording");
  return { vaultDir, staging, from, to: join(vaultDir, "T.mp4") };
}

describe("moveFile on a volume without hard links", () => {
  it.each(["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EXDEV"])(
    "(%s) never replaces a file that arrives while the take is placed",
    async (code) => {
      const { from, to } = await stagedTake();
      hooks.linkError = code;
      hooks.arrival = (path) => writeFile(path, "other recording");

      await expect(moveFile(from, to)).rejects.toMatchObject({ code: "EEXIST" });
      expect(await readFile(to, "utf-8")).toBe("other recording");
      expect(await readFile(from, "utf-8")).toBe("new recording");
    },
  );

  it("places the take with an exclusive copy and removes the staging file", async () => {
    const { from, to, staging } = await stagedTake();
    hooks.linkError = "EPERM";

    await moveFile(from, to);
    expect(await readFile(to, "utf-8")).toBe("new recording");
    expect(await readdir(staging)).toEqual([]);
  });
});

describe("moveFile when the staging file cannot be removed after placing the take", () => {
  it.each([
    ["it is set aside under a name the sweep ignores", false],
    ["the sweep still skips it when it cannot even be renamed", true],
  ])("%s", async (_name, renameFails) => {
    const { vaultDir, from, to } = await stagedTake();
    hooks.failUnlink.add(from);
    if (renameFails) hooks.failRename.add(from);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await moveFile(from, to);
    expect(await readFile(to, "utf-8")).toBe("new recording");
    expect(error).toHaveBeenCalled();

    const swept = await recoverStrandedRecordings({
      vaultDir,
      fallbackTempDir: await mkdtemp(join(tmpdir(), "rw-nolink-tmp-")),
      title: "Recovered",
      now: () => Date.now() + 10 * 60_000,
    });
    expect(swept).toEqual({ recovered: [], discarded: 0, failed: [] });
    expect((await readdir(vaultDir)).filter((n) => n.endsWith(".mp4"))).toEqual(["T.mp4"]);
  });
});
