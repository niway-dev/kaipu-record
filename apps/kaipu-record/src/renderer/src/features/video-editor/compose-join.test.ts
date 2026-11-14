import { describe, expect, it } from "vitest";
import type { CursorTrack } from "@shared/cursor-track";
import type { WebcamTrackMeta } from "@shared/webcam-track";
import { composeJoin } from "./compose-join";
import { initialScene } from "./scene";
import { sourceAxis } from "./source-axis";
import { detectZoomSegments } from "./zoom/detect-zoom-segments";
import type { ZoomSegment } from "./zoom/zoom-model";

const TRACK: CursorTrack = {
  version: 1,
  display: { id: "1", width: 1600, height: 1000, scaleFactor: 2 },
  anchor: "exact",
  clicksAvailable: true,
  t: [0, 20_000],
  x: [0.5, 0.5],
  y: [0.5, 0.5],
  clicks: [{ t: 10_000, x: 0.5, y: 0.5, button: 0 }],
};
const WEBCAM: WebcamTrackMeta = {
  startOffsetMs: 0,
  offsetQuality: "exact",
  width: 1280,
  height: 720,
  fps: 30,
};
const INPUT = { assetId: "lib-b", title: "B", durationSeconds: 20, width: 1280, height: 720 };

describe("composeJoin", () => {
  it("adds the clip, the source, the recording's zooms and its webcam in one scene", () => {
    const scene = initialScene(20);
    const next = composeJoin(scene, 20, INPUT, 20, TRACK, WEBCAM);
    const source = next.sources![0];
    expect(source).toMatchObject({ assetId: "lib-b", offset: 3600, durationSeconds: 20 });
    expect(
      next.items.map((i) => (i.kind === "clip" ? [i.sourceStart, i.sourceEnd] : null)),
    ).toEqual([
      [0, 20],
      [3600, 3620],
    ]);
    const zooms = next.zoomSegments;
    expect(zooms).toHaveLength(detectZoomSegments(TRACK, 20, scene.zoomSensitivity).length);
    for (const z of zooms) {
      expect(z.start).toBeGreaterThanOrEqual(3600);
      expect(z.end).toBeLessThanOrEqual(3620);
    }
    // The opened recording has no webcam, so the layer comes from the joined one.
    expect(next.webcam).not.toBeNull();
    expect(sourceAxis(20, next.sources).recordings.map((r) => r.offset)).toEqual([0, 3600]);
  });

  it("keeps the opened recording's webcam layout and zooms when joining", () => {
    const opened = initialScene(20, WEBCAM);
    const layout = { ...opened.webcam!.layout, size: 0.4 };
    const zoom: ZoomSegment = {
      id: "z-opened",
      start: 2,
      end: 5,
      scale: 2,
      mode: "fixed",
      anchor: { x: 0.5, y: 0.5 },
      smoothing: 50,
      origin: "manual",
      trigger: null,
    };
    const scene = { ...opened, webcam: { ...opened.webcam!, layout }, zoomSegments: [zoom] };
    const next = composeJoin(scene, 20, INPUT, 0, TRACK, WEBCAM);
    expect(next.webcam!.layout).toEqual(layout);
    // The opened recording's own zoom is untouched (the joined recording's land at 3600+).
    expect(next.zoomSegments.find((z) => z.id === "z-opened")).toEqual(zoom);
    // At t = 0 the new clip goes first; the opened recording's clip follows it.
    expect(next.items[0]).toMatchObject({ kind: "clip", sourceStart: 3600 });
  });

  it("without cursor data or a webcam it is exactly joinRecording", () => {
    const scene = initialScene(20);
    const next = composeJoin(scene, 20, INPUT, 20, null, null);
    expect(next.zoomSegments).toEqual([]);
    expect(next.webcam).toBeNull();
    expect(next.sources).toHaveLength(1);
    expect(next.items).toHaveLength(2);
  });

  it("is pure: the scene it was given is not changed", () => {
    const scene = initialScene(20);
    composeJoin(scene, 20, INPUT, 20, TRACK, WEBCAM);
    expect(scene.sources).toBeUndefined();
    expect(scene.items).toHaveLength(1);
  });
});
