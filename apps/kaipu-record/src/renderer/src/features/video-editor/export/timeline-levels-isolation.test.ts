import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { joinedSource } from "../media-switch.fixture";
import { initialScene } from "../scene";
import { buildExportPlan } from "./export-plan";

/**
 * The `timeline-levels` flag gates how a scene gets a second recording or floating images in
 * the editor; it never decides what an existing scene exports. The export is a function of the
 * scene alone: no module under export/ may read a flag or name this one. A scene that already
 * has two recordings exports with the flag off exactly as with it on.
 */

function sourcesIn(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name))
    .map((name) => join(dir, name));
}

const FLAG_NAME = "timeline-levels";
const FLAG_IDENTIFIER = /^(?:useFlag|isFlagEnabled|getFlag|featureFlags?)$/;
const FLAG_MODULE = /(?:^|\/)(?:use-flag|flags?)(?:\.[cm]?[jt]sx?)?$/;

/** What in a source reads a flag, from the syntax tree: identifiers and string literals. */
function flagReferences(text: string, fileName = "source.ts"): string[] {
  const kind = fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && FLAG_IDENTIFIER.test(node.text)) found.add(node.text);
    if (
      ts.isStringLiteralLike(node) &&
      (node.text.includes(FLAG_NAME) || FLAG_MODULE.test(node.text))
    ) {
      found.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...found];
}

describe("the flag scan", () => {
  it.each([
    [
      "the page's flag import",
      'import { useFlag } from "@renderer/features/analytics/use-flag";',
      "useFlag",
    ],
    [
      "the flag hook through the analytics barrel",
      'import { captureException, useFlag } from "@renderer/features/analytics";',
      "useFlag",
    ],
    [
      "the flag hook module path",
      'import("@renderer/features/analytics/use-flag");',
      "@renderer/features/analytics/use-flag",
    ],
    ["the flag name", 'const on = flag("timeline-levels");', "timeline-levels"],
    ["a call to the hook", "const on = useFlag(name);", "useFlag"],
  ])("finds %s", (_title, code, expected) => {
    expect(flagReferences(code)).toContain(expected);
  });

  it("ignores prose", () => {
    expect(flagReferences("// timeline-levels and useFlag are mentioned here\nexport {};")).toEqual(
      [],
    );
  });

  it("scans a non-empty export/ tree", () => {
    expect(sourcesIn(__dirname)).toContain(join(__dirname, "export-plan.ts"));
  });
});

describe("the timeline-levels flag does not reach the export", () => {
  it("is not read or named by any module under export/", () => {
    const offenders = sourcesIn(__dirname).flatMap((file) => {
      const found = flagReferences(readFileSync(file, "utf8"), file);
      return found.length > 0 ? [`${relative(__dirname, file)}: ${found.join(", ")}`] : [];
    });
    expect(offenders).toEqual([]);
  });

  it("exports a scene that already has two recordings, whatever the flag says", () => {
    const scene = {
      ...initialScene(100),
      sources: [joinedSource("b", 3600, 40)],
      items: [
        { id: "a1", kind: "clip" as const, sourceStart: 0, sourceEnd: 10 },
        { id: "b", kind: "clip" as const, sourceStart: 3600, sourceEnd: 3610 },
      ],
    };
    // buildExportPlan takes the scene alone (arity pinned), so there is no way to pass a flag in.
    expect(buildExportPlan.length).toBe(1);
    const plan = buildExportPlan(scene);
    expect(plan.segments[1]).toMatchObject({ kind: "clip", sourceId: "b", sourceStart: 3600 });
    expect(plan.totalDuration).toBe(20);
  });
});
