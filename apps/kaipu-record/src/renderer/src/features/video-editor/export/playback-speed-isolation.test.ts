import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { initialScene } from "../scene";
import { serializeSession } from "../session";
import { buildExportPlan, gifFrameSchedule, sliceExportPlan } from "./export-plan";

/**
 * NIW2-666: the preview playback speed is view state. The export file always plays at 1x
 * and the plan is a function of the scene alone. What these tests pin, honestly: no
 * plan builder has a parameter a speed could travel in, none of the scene, the session or
 * the plan carries one, and no module on the export path imports the speed. They do not
 * re-prove that the planners are pure: calling a function twice and comparing the results
 * cannot fail. The one module that does read the speed (the page) is covered at page
 * level: "hands the export the same scene at 1x and at 2x" in
 * `pages/video-editor/video-editor-page.test.tsx`.
 */

const FEATURE = resolve(__dirname, "..");

/** Every .ts/.tsx source under `dir`, subfolders included, tests excluded. */
function sourcesIn(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name))
    .map((name) => join(dir, name));
}

// The names the preview speed travels by: the exports of `playback-speed.ts` and the hook's
// own, plus the generic `rate` / `speed` a renamed parameter would use. Whole identifiers
// only, so `frameRate`, `sampleRate` and `bitrate` (all legitimate in the export) stay clear.
const SPEED_IDENTIFIER =
  /^(?:speed|rate|previewRate|playbackRate|defaultPlaybackRate|previewSpeed|setSpeed|nextSpeed|PreviewSpeed|PREVIEW_SPEEDS|DEFAULT_SPEED)$/;
// The two modules that own the speed, as an import path, a dynamic import or a mock path.
const SPEED_MODULE = /(?:^|\/)(?:playback-speed|use-preview-playback)(?:\.[cm]?[jt]sx?)?$/;

/**
 * What in a source ties it to the preview speed, read from the syntax tree: identifiers
 * and string literals (a module path, or `state["playbackRate"]`). A comment or prose that
 * merely says "rate" is not a reference. A speed renamed to something this list does not
 * know is beyond any scan; the page-level test covers what actually reaches the export.
 */
function speedReferences(text: string, fileName = "source.ts"): string[] {
  const kind = fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && SPEED_IDENTIFIER.test(node.text)) found.add(node.text);
    if (
      ts.isStringLiteralLike(node) &&
      (SPEED_IDENTIFIER.test(node.text) || SPEED_MODULE.test(node.text))
    ) {
      found.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...found];
}

/** `file: reference, reference` for every file that mentions the speed. */
function offendersAmong(files: string[], base: string): string[] {
  return files.flatMap((file) => {
    const found = speedReferences(readFileSync(file, "utf8"), file);
    return found.length > 0 ? [`${relative(base, file)}: ${found.join(", ")}`] : [];
  });
}

describe("the speed scan", () => {
  it.each([
    ["a local called rate", "const rate = 2;", "rate"],
    ["a property called previewRate", "plan({ previewRate: 2 });", "previewRate"],
    ["the element's playbackRate", "video.playbackRate = 2;", "playbackRate"],
    ["a parameter called speed", "export const f = (speed: number) => speed;", "speed"],
    ["the speeds list", 'import { PREVIEW_SPEEDS } from "./x";', "PREVIEW_SPEEDS"],
    ["the module path", 'import { n } from "../playback-speed";', "../playback-speed"],
    [
      "a dynamic import of the hook",
      'await import("../use-preview-playback");',
      "../use-preview-playback",
    ],
    ["a string key", 'const r = state["playbackRate"];', "playbackRate"],
  ])("finds %s", (_title, code, expected) => {
    expect(speedReferences(code)).toContain(expected);
  });

  it("ignores prose and the names that merely end in rate", () => {
    const code = [
      "// the measured rate per minute, and the speed of the encoder",
      "/** Video bitrate at the source frame rate. */",
      "export const frameRate = 30, sampleRate = 48000, bitrate = 8_000_000;",
      'export const label = "frame rate cap";',
    ].join("\n");
    expect(speedReferences(code)).toEqual([]);
  });

  it("walks subfolders and skips tests and non-sources", () => {
    const dir = mkdtempSync(join(tmpdir(), "speed-scan-"));
    try {
      mkdirSync(join(dir, "sub", "deep"), { recursive: true });
      for (const name of [
        "a.ts",
        "sub/b.tsx",
        "sub/deep/c.ts",
        "d.test.ts",
        "sub/e.test.tsx",
        "f.md",
      ]) {
        writeFileSync(join(dir, name), "export {};\n");
      }
      expect(
        sourcesIn(dir)
          .map((file) => relative(dir, file))
          .sort(),
      ).toEqual(["a.ts", join("sub", "b.tsx"), join("sub", "deep", "c.ts")]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("scans a non-empty export/ tree", () => {
    expect(sourcesIn(__dirname)).toContain(join(__dirname, "export-plan.ts"));
  });
});

describe("preview playback speed does not reach the export", () => {
  const scene = {
    ...initialScene(20),
    items: [
      { id: "a", kind: "clip" as const, sourceStart: 0, sourceEnd: 8 },
      {
        id: "s",
        kind: "slide" as const,
        assetId: "asset-s",
        duration: 3,
        naturalWidth: 800,
        naturalHeight: 600,
      },
      { id: "b", kind: "clip" as const, sourceStart: 12, sourceEnd: 20 },
    ],
  };

  it("gives the plan builders no parameter a speed could travel in (signatures pinned by arity)", () => {
    // scene | plan, start, end | duration, fps. A fourth argument for a speed fails here
    // and forces the question of whether the export may know it.
    expect(buildExportPlan.length).toBe(1);
    expect(sliceExportPlan.length).toBe(3);
    expect(gifFrameSchedule.length).toBe(2);
  });

  it("keeps the real timeline length: a 3 s slide stays 3 s in the plan", () => {
    const plan = buildExportPlan(scene);
    expect(plan.totalDuration).toBe(8 + 3 + 8);
    const slide = plan.segments.find((segment) => segment.kind === "slide");
    expect(slide).toMatchObject({ timelineStart: 8, duration: 3 });
  });

  it("has no speed in the scene, the saved session or the plan", () => {
    const key = /speed|playbackRate/i;
    expect(JSON.stringify(scene)).not.toMatch(key);
    expect(serializeSession(scene)).not.toMatch(key);
    expect(JSON.stringify(buildExportPlan(scene))).not.toMatch(key);
  });

  it("is not referenced by anything under export/, subfolders included", () => {
    expect(offendersAmong(sourcesIn(__dirname), __dirname)).toEqual([]);
  });

  it("is not referenced by the scene, the session or the scene hook", () => {
    const files = ["scene.ts", "session.ts", "use-video-scene.ts", "timeline.ts"].map((name) =>
      join(FEATURE, name),
    );
    expect(offendersAmong(files, FEATURE)).toEqual([]);
  });
});
