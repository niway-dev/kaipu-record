import { describe, expect, it } from "vitest";
import { discoverProcesses, roleOf, rootMatch } from "./discover";
import type { PsRow } from "./parse-system";

const ELECTRON =
  "/repo/node_modules/.bun/electron@39/node_modules/electron/dist/Electron.app/Contents";
const row = (pid: number, ppid: number, command: string): PsRow => ({
  pid,
  ppid,
  rssBytes: 0,
  cpuPct: 0,
  cpuTimeS: 0,
  command,
});

const MAIN = row(100, 50, `${ELECTRON}/MacOS/Electron .`);
const TABLE: PsRow[] = [
  row(50, 1, "node /repo/apps/kaipu-record/node_modules/.bin/electron-vite dev"),
  MAIN,
  row(
    101,
    100,
    `${ELECTRON}/Frameworks/Electron Helper (Renderer).app/Contents/MacOS/Electron Helper (Renderer) --type=renderer --user-data-dir=/Users/x/Library/My Data`,
  ),
  row(
    102,
    100,
    `${ELECTRON}/Frameworks/Electron Helper (GPU).app/Contents/MacOS/Electron Helper (GPU) --type=gpu-process`,
  ),
  row(
    103,
    100,
    `${ELECTRON}/Frameworks/Electron Helper.app/Contents/MacOS/Electron Helper --type=utility --utility-sub-type=network.mojom.NetworkService`,
  ),
  row(104, 100, "/repo/apps/kaipu-record/native/bin/capture-helper --fd 3"),
  row(105, 104, "/usr/bin/ffmpeg -i x"),
  row(200, 1, "/other/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron ."),
  row(300, 1, "/usr/bin/unrelated"),
];

describe("roleOf", () => {
  it("reads the Chromium --type argument", () => {
    expect(roleOf(TABLE[2]!.command)).toBe("renderer");
    expect(roleOf(TABLE[3]!.command)).toBe("gpu");
    expect(roleOf(TABLE[4]!.command)).toBe("utility:network.mojom.NetworkService");
    expect(roleOf(MAIN.command)).toBe("main");
    expect(roleOf(TABLE[5]!.command)).toBe("native:capture-helper");
  });
});

describe("discoverProcesses", () => {
  it("finds the main process under the repo and its descendants only", () => {
    const found = discoverProcesses(TABLE, { rootContains: "/repo/" });
    expect(found.map((p) => [p.pid, p.role])).toEqual([
      [100, "main"],
      [101, "renderer"],
      [102, "gpu"],
      [103, "utility:network.mojom.NetworkService"],
      [104, "native:capture-helper"],
      [105, "native:ffmpeg"],
    ]);
  });
  it("never stores a command line", () => {
    for (const p of discoverProcesses(TABLE, { rootContains: "/repo/" })) {
      expect(Object.keys(p).sort()).toEqual(["pid", "ppid", "role"]);
    }
  });
  it("returns nothing when no dev Electron runs under the repo", () => {
    expect(discoverProcesses(TABLE, { rootContains: "/nowhere/" })).toEqual([]);
  });
  it("does not treat a helper as a root", () => {
    const helperOnly = [TABLE[2]!, TABLE[3]!];
    expect(discoverProcesses(helperOnly, { rootContains: "/repo/" })).toEqual([]);
  });
});

describe("rootMatch and sibling checkouts", () => {
  const sibling = row(
    400,
    1,
    "/repo-2/node_modules/.bun/electron@39/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .",
  );
  it("adds a path boundary to the root", () => {
    expect(rootMatch("/repo")).toBe("/repo/");
    expect(rootMatch("/repo/")).toBe("/repo/");
  });
  it("does not attach to a sibling directory that shares the root as a prefix", () => {
    const found = discoverProcesses([...TABLE, sibling], { rootContains: rootMatch("/repo") });
    expect(found.map((p) => p.pid)).not.toContain(400);
  });
  it("keeps a native helper role free of argument fragments and file paths", () => {
    expect(roleOf("/bin/tool /Users/me/My Video.mp4")).toBe("native:tool");
    expect(roleOf("/bin/tool fd 3 secret=x")).toBe("native:tool");
    expect(roleOf("/bin/we ird$name --x")).toBe("native:we");
    expect(roleOf("node scripts/foo.js")).toBe("native:node");
    expect(roleOf("sh -c a/b c")).toBe("native:sh");
  });
});
