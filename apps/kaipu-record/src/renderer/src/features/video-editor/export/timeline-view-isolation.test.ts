import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { initialScene } from "../scene";
import { serializeSession } from "../session";
import { buildExportPlan, sliceExportPlan } from "./export-plan";
import { editFingerprint } from "./export-reuse";

/**
 * NIW2-667: the timeline's zoom and scroll are view state. The export is a function of the
 * scene alone, and the scene is never touched by a zoom. What these tests pin, honestly: no
 * plan builder takes a view, none of the scene, the session or the plan carries one, and no
 * module on the export path (or the scene, the session, the cut model) imports the view.
 * The module that does read it (the page, which gives it to the strip and the transport bar)
 * is covered at page level: "hands the export the same scene at 1x and at 4x" in
 * `pages/video-editor/video-editor-page.test.tsx`.
 */

const FEATURE = resolve(__dirname, "..");
const sourcesIn = (dir: string): string[] =>
  readdirSync(dir)
    .filter((name) => /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name))
    .map((name) => join(dir, name));

const VIEW_REFERENCE =
  /timeline-view|use-timeline-view|timeline-pointer|TimelineView|timeAt\b|zoomAt|followPlayhead|MAX_PX_PER_SECOND/;

describe("the timeline zoom and scroll do not reach the export", () => {
  const scene = {
    ...initialScene(20),
    items: [
      { id: "a", kind: "clip" as const, sourceStart: 0, sourceEnd: 8 },
      { id: "b", kind: "clip" as const, sourceStart: 12, sourceEnd: 20 },
    ],
  };

  it("builds the same plan, slice and fingerprint whatever the view is", () => {
    // The builders take the scene (and a range) and nothing else, so there is nowhere to pass a
    // view; building "zoomed" and "at fit" is the same call on the same scene, and must stay so.
    const atFit = buildExportPlan(scene);
    const zoomed = buildExportPlan(structuredClone(scene));
    expect(zoomed).toEqual(atFit);
    expect(sliceExportPlan(zoomed, 1, 9)).toEqual(sliceExportPlan(atFit, 1, 9));
    expect(editFingerprint(scene)).toBe(editFingerprint(structuredClone(scene)));
    expect(buildExportPlan.length).toBe(1);
    expect(sliceExportPlan.length).toBe(3);
  });

  it("has no view in the scene, the saved session or the plan", () => {
    const key = /"scroll"|laneWidth|timelineView|viewZoom|timelineZoom/i;
    expect(JSON.stringify(scene)).not.toMatch(key);
    expect(serializeSession(scene)).not.toMatch(key);
    expect(JSON.stringify(buildExportPlan(scene))).not.toMatch(key);
  });

  it("is not referenced by anything under export/", () => {
    const offenders = sourcesIn(__dirname).filter((file) =>
      VIEW_REFERENCE.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("is not referenced by the scene, the session, the scene hook or the cut model", () => {
    const files = ["scene.ts", "session.ts", "use-video-scene.ts", "timeline.ts"].map((name) =>
      join(FEATURE, name),
    );
    const offenders = files.filter((file) => VIEW_REFERENCE.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the pure view module imports nothing from the editor: it can never pull the scene in", () => {
    const source = readFileSync(join(FEATURE, "components", "timeline-view.ts"), "utf8");
    expect(source).not.toMatch(/^import /m);
  });
});
