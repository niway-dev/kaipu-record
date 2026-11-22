import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CLIP_SECONDS,
  DEFAULT_WORKSPACE,
  DESTINATIONS,
  GITHUB_FREE_LIMIT_MB,
  GITHUB_PAID_LIMIT_MB,
  WORKSPACE_IDS,
  DEFAULT_AREA,
  FULL_REGION,
  INITIAL_CLIP,
  MIN_KEPT_SECONDS,
  cropClip,
  cropTransform,
  estimateMegabytes,
  formatMegabytes,
  formatTime,
  keepMark,
  keptSeconds,
  moveEnd,
  movePlayhead,
  moveStart,
  planDestination,
  regionFromDrag,
  regionPixels,
  settleRegion,
  workspaceFolder,
} from "./hero-stage-model";

describe("selection", () => {
  it("builds the same rectangle whichever way the drag went", () => {
    const a = { x: 0.2, y: 0.3 };
    const b = { x: 0.6, y: 0.8 };
    expect(regionFromDrag(a, b)).toEqual(regionFromDrag(b, a));
    const r = regionFromDrag(a, b);
    expect(r.x).toBeCloseTo(0.2);
    expect(r.w).toBeCloseTo(0.4);
    expect(r.h).toBeCloseTo(0.5);
  });

  it("keeps a drag that leaves the screen inside it", () => {
    const r = regionFromDrag({ x: 0.5, y: 0.5 }, { x: 1.7, y: -0.4 });
    expect(r.x + r.w).toBeLessThanOrEqual(1);
    expect(r.y).toBe(0);
  });

  it("a click falls back to the default area, a real drag stays", () => {
    expect(settleRegion({ x: 0.4, y: 0.4, w: 0.01, h: 0.01 })).toEqual(DEFAULT_AREA);
    const kept = { x: 0.1, y: 0.1, w: 0.3, h: 0.3 };
    expect(settleRegion(kept)).toBe(kept);
  });

  it("reports the selection in pixels of the pretend 1920 × 1080 screen", () => {
    expect(regionPixels(FULL_REGION)).toEqual({ w: 1920, h: 1080 });
    expect(regionPixels({ x: 0, y: 0, w: 0.5, h: 0.5 })).toEqual({ w: 960, h: 540 });
  });
});

describe("crop", () => {
  it("leaves a full-screen capture untouched", () => {
    expect(cropTransform(FULL_REGION)).toBe("translate(0%, 0%) scale(1) translate(0%, 0%)");
    expect(cropClip(FULL_REGION)).toBe("inset(0% 0% 0% 0%)");
  });

  it("zooms an area to fit and clips everything outside it", () => {
    const area = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
    expect(cropTransform(area)).toBe("translate(0%, 0%) scale(2) translate(-25%, -25%)");
    expect(cropClip(area)).toBe("inset(25% 25% 25% 25%)");
  });

  it("centres an area whose shape differs from the canvas", () => {
    const wide = { x: 0, y: 0, w: 1, h: 0.5 };
    expect(cropTransform(wide)).toBe("translate(0%, 25%) scale(1) translate(0%, 0%)");
  });
});

describe("annotations", () => {
  it("drops an arrow that was only a click and keeps the rest", () => {
    const p = { x: 0.3, y: 0.3 };
    expect(keepMark({ kind: "arrow", from: p, to: p })).toBe(false);
    expect(keepMark({ kind: "arrow", from: p, to: { x: 0.6, y: 0.5 } })).toBe(true);
    expect(keepMark({ kind: "pencil", points: [p] })).toBe(true);
    expect(keepMark({ kind: "text", at: p })).toBe(true);
  });
});

describe("trim", () => {
  it("never trims the start past the end, and drags the playhead along", () => {
    const clip = moveStart(INITIAL_CLIP, 99);
    expect(clip.start).toBe(INITIAL_CLIP.end - MIN_KEPT_SECONDS);
    expect(clip.playhead).toBe(clip.start);
  });

  it("never trims the end before the start, or past the clip", () => {
    expect(moveEnd(INITIAL_CLIP, 0).end).toBe(INITIAL_CLIP.start + MIN_KEPT_SECONDS);
    expect(moveEnd(INITIAL_CLIP, 999).end).toBe(CLIP_SECONDS);
  });

  it("keeps the playhead inside the trimmed range", () => {
    expect(movePlayhead(INITIAL_CLIP, 0).playhead).toBe(INITIAL_CLIP.start);
    expect(movePlayhead(INITIAL_CLIP, 30).playhead).toBe(INITIAL_CLIP.end);
    expect(keptSeconds({ start: 3, end: 21, playhead: 3 })).toBe(18);
  });
});

describe("time and size", () => {
  it("formats whole seconds as mm:ss", () => {
    expect(formatTime(0)).toBe("00:00");
    expect(formatTime(9.9)).toBe("00:09");
    expect(formatTime(75)).toBe("01:15");
  });

  it("estimates bigger files for bigger sizes and for GIF, and one frame for PNG", () => {
    const mp4 = estimateMegabytes("mp4", "1080p", 20);
    expect(estimateMegabytes("mp4", "4K", 20)).toBeGreaterThan(mp4);
    expect(estimateMegabytes("gif", "1080p", 20)).toBeGreaterThan(mp4);
    expect(estimateMegabytes("png", "1080p", 20)).toBe(estimateMegabytes("png", "1080p", 2));
  });

  it("writes sizes with one decimal under 10 MB and none above", () => {
    expect(formatMegabytes(4.44)).toBe("4.4 MB");
    expect(formatMegabytes(38.2)).toBe("38 MB");
  });
});

describe("destinations", () => {
  const mb = (id: Parameters<typeof planDestination>[0], seconds = 24) =>
    planDestination(id, seconds).megabytes;

  it("plans every destination as an MP4", () => {
    for (const id of DESTINATIONS) expect(planDestination(id, 24).format).toBe("mp4");
  });

  it("YouTube is a 1440p or 4K canvas at the top of the app's bitrate range", () => {
    const p1440 = planDestination("youtube", 24, "1440p");
    expect(p1440.picture).toEqual({ w: 2560, h: 1440 });
    expect(p1440.megabytes).toBeCloseTo(48, 5);
    const p4k = planDestination("youtube", 24, "4K");
    expect(p4k.picture).toEqual({ w: 3840, h: 2160 });
    expect(p4k.megabytes).toBeCloseTo(135, 5);
  });

  it("vertical and square are scaled from 8 Mbps at 1080p by pixel count", () => {
    expect(planDestination("vertical", 24).picture).toEqual({ w: 1080, h: 1920 });
    expect(mb("vertical")).toBeCloseTo(24, 5);
    expect(planDestination("square", 24).picture).toEqual({ w: 1080, h: 1080 });
    expect(mb("square")).toBeCloseTo((24 * (1080 * 1080)) / (1920 * 1080), 5);
  });

  it("GitHub and chat are 1080p, 24 fps, at 4.7 and 6 MB per minute", () => {
    expect(mb("github", 60)).toBeCloseTo(4.7, 5);
    expect(mb("chat", 60)).toBeCloseTo(6, 5);
    for (const id of ["github", "chat"] as const) {
      const p = planDestination(id, 60);
      expect(p.maxFps).toBe(24);
      expect(p.picture).toEqual({ w: 1920, h: 1080 });
    }
  });

  it("the archive copy has the recording's own size, so no picture and no estimate", () => {
    const p = planDestination("archive", 24);
    expect(p.picture).toBeNull();
    expect(p.megabytes).toBeNull();
  });

  it("only GitHub reports whether it fits, against 10 MB free and 100 MB paid", () => {
    expect([GITHUB_FREE_LIMIT_MB, GITHUB_PAID_LIMIT_MB]).toEqual([10, 100]);
    expect(planDestination("github", 24).github).toEqual({ free: true, paid: true });
    expect(planDestination("github", 60 * 3).github).toEqual({ free: false, paid: true });
    expect(planDestination("github", 60 * 30).github).toEqual({ free: false, paid: false });
    for (const id of DESTINATIONS.filter((d) => d !== "github")) {
      expect(planDestination(id, 24).github).toBeNull();
    }
  });

  it("scales with the kept length", () => {
    expect(mb("youtube", 48)!).toBeCloseTo(mb("youtube", 24)! * 2, 5);
  });
});

describe("destinations still match the desktop app", () => {
  // The numbers above are copied from the desktop app on purpose. This reads its source as
  // text (no import: the page must not bundle the app) so a change there fails here.
  const desktop = (file: string) =>
    readFileSync(
      resolve(__dirname, "../../../../kaipu-record/src/renderer/src/features", file),
      "utf8",
    );

  it("has the same destination ids, in the same order (email folded into the chat label)", () => {
    const source = desktop("prepare/destinations.ts");
    const ids = [...source.slice(source.indexOf("DESTINATION_IDS")).matchAll(/"([a-z]+)",/g)]
      .map((m) => m[1])
      .slice(0, 7);
    expect(ids.filter((id) => id !== "email")).toEqual([...DESTINATIONS]);
  });

  it("has the same bitrates, per-minute rates and GitHub limits", () => {
    const presets = desktop("video-editor/export/export-presets.ts");
    expect(presets).toContain('"youtube-1440": { lowFps: 16_000_000, highFps: 24_000_000 }');
    expect(presets).toContain('"youtube-4k": { lowFps: 45_000_000, highFps: 68_000_000 }');
    expect(presets).toContain("videoBytesPerMinute: 6 * MB");
    expect(presets).toContain("videoBytesPerMinute: 4.7 * MB");
    expect(presets).toContain("GITHUB_FREE_LIMIT_BYTES = 10 * MB");
    expect(presets).toContain("GITHUB_PAID_LIMIT_BYTES = 100 * MB");
    expect(presets).toContain("canvas: { width: 2560, height: 1440 }");
    expect(presets).toContain("canvas: { width: 3840, height: 2160 }");
  });
});

describe("workspaces", () => {
  it("starts on the default workspace, whose folder is the app's own", () => {
    expect(WORKSPACE_IDS[0]).toBe(DEFAULT_WORKSPACE);
    expect(workspaceFolder(DEFAULT_WORKSPACE, "Personal")).toBe("~/Movies/Kaipu Record");
  });

  it("puts every other workspace in a sibling folder named after it", () => {
    expect(workspaceFolder("work", "Work")).toBe("~/Movies/Kaipu Record \u2014 Work");
    expect(workspaceFolder("work", "Trabajo")).toBe("~/Movies/Kaipu Record \u2014 Trabajo");
  });
});
