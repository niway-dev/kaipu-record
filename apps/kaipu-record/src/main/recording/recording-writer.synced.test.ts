import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Synced folders (decision 15): a take of a synced workspace writes no `.part` inside the
// folder, and is placed without a hard link. `link` is counted, never needed.
const hooks = vi.hoisted(() => ({ links: [] as string[] }));
vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>();
  return {
    ...actual,
    link: async (from: string, to: string) => {
      hooks.links.push(to);
      return actual.link(from, to);
    },
  };
});

const { RecordingWriter } = await import("./recording-writer");
const { recoverStrandedRecordings } = await import("./stranded-recordings");

describe("RecordingWriter — a synced workspace", () => {
  let root: string;
  let vaultDir: string;
  let scratch: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "rw-synced-"));
    vaultDir = join(root, "My Drive", "Kaipu");
    scratch = join(root, "userData", "workspace-scratch", "ws-1", "tmp");
    await (await import("node:fs/promises")).mkdir(vaultDir, { recursive: true });
    hooks.links = [];
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const writer = () =>
    new RecordingWriter({
      vaultDir: () => vaultDir,
      now: () => 5000,
      stagingFor: (dir) => (dir === vaultDir ? scratch : null),
    });

  it("stages the take in the scratch folder, never inside the synced folder, and never links", async () => {
    const w = writer();
    const { tempPath } = await w.create("s1");
    expect(tempPath.startsWith(scratch)).toBe(true);
    expect(await readdir(join(vaultDir, ".kaipu", "tmp")).catch(() => [])).toEqual([]);
    await w.write("s1", new TextEncoder().encode("bytes").buffer, 0);
    const rec = await w.finalize("s1", { title: "T", durationSeconds: 1, durationMs: 1000 });
    expect(rec.filePath).toBe(join(vaultDir, "T.mp4"));
    expect(hooks.links).toEqual([]);
    expect((await stat(rec.filePath)).nlink).toBe(1);
    expect(await readdir(scratch)).toEqual([]);
  });

  it("a plain workspace keeps staging in .kaipu/tmp", async () => {
    const w = new RecordingWriter({
      vaultDir: () => vaultDir,
      now: () => 5000,
      stagingFor: () => null,
    });
    const { tempPath } = await w.create("s1");
    expect(tempPath.startsWith(join(vaultDir, ".kaipu", "tmp"))).toBe(true);
    await w.abort("s1");
  });

  it("the stranded sweep recovers a take left in the scratch folder, without a link", async () => {
    const w = writer();
    const { tempPath } = await w.create("s1");
    await w.write("s1", new TextEncoder().encode("bytes").buffer, 0);
    // The app dies here: the part stays in the scratch folder.
    void tempPath;
    const result = await recoverStrandedRecordings({
      vaultDir,
      stagingDir: scratch,
      placeByRename: true,
      title: "Recovered",
      now: () => Date.now() + 10 * 60_000,
    });
    expect(result.recovered).toHaveLength(1);
    expect(hooks.links).toEqual([]);
    expect(await readdir(scratch)).toEqual([]);
  });
});
