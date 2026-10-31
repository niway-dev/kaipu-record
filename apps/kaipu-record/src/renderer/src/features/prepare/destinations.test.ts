import { describe, expect, it } from "vitest";
import { EXPORT_PRESET_IDS } from "@renderer/features/video-editor/export/export-presets";
import { EXPORT_DESTINATION_IDS } from "@shared/types/export-preset";
import {
  DESTINATION_GROUPS,
  DESTINATION_IDS,
  destinationOfPreset,
  hasFramingChoice,
  isDestinationId,
  planCopy,
  presetForDestination,
  presetsOf,
} from "./destinations";

describe("DESTINATION_IDS", () => {
  it("names the same destinations a sidecar may store", () => {
    expect([...DESTINATION_IDS]).toEqual([...EXPORT_DESTINATION_IDS]);
  });
});

/** A Retina-ish 16:10 screen recording: 3:02, 48 fps, with sound, 119 MB. */
const SOURCE = { width: 1916, height: 1048, fps: 48, hasAudio: true, sampleRate: 48000 };
const DURATION = 182;
const SIZE = 119_000_000;

const plan = (
  destination: Parameters<typeof planCopy>[0]["destination"],
  overrides: Partial<Parameters<typeof planCopy>[0]> = {},
) =>
  planCopy({
    destination,
    presetId: presetForDestination(destination, SOURCE),
    source: SOURCE,
    durationSec: DURATION,
    sourceSizeBytes: SIZE,
    ...overrides,
  });

describe("destinations", () => {
  it("lists every destination exactly once, grouped by who compresses last", () => {
    expect(DESTINATION_GROUPS.map((g) => [g.id, g.destinations])).toEqual([
      ["send-more", ["youtube", "vertical", "square"]],
      ["keep-light", ["github", "chat", "email"]],
      ["keep", ["archive"]],
    ]);
    expect(DESTINATION_GROUPS.flatMap((g) => g.destinations).sort()).toEqual(
      [...DESTINATION_IDS].sort(),
    );
  });

  it("covers every export preset, and maps each back to its destination", () => {
    const covered = new Set(DESTINATION_IDS.flatMap((d) => presetsOf(d)));
    expect([...covered].sort()).toEqual([...EXPORT_PRESET_IDS].sort());
    // Email shares chat's preset, so a Balanced file reads as the chat copy.
    for (const d of DESTINATION_IDS.filter((id) => id !== "email")) {
      for (const p of presetsOf(d)) expect(destinationOfPreset(p)).toBe(d);
    }
    expect(destinationOfPreset("balanced")).toBe("chat");
  });

  it("reads only known ids from the URL", () => {
    expect(isDestinationId("youtube")).toBe(true);
    expect(isDestinationId("tiktok")).toBe(false);
    expect(isDestinationId(null)).toBe(false);
  });

  it("YouTube defaults to 1440p, to 4K for a recording bigger than 1440p, and honours a choice", () => {
    expect(presetForDestination("youtube", SOURCE)).toBe("youtube-1440");
    expect(presetForDestination("youtube", { width: 3024, height: 1964 })).toBe("youtube-4k");
    expect(presetForDestination("youtube", SOURCE, "youtube-4k")).toBe("youtube-4k");
    expect(presetForDestination("github", SOURCE)).toBe("light");
    expect(presetForDestination("chat", SOURCE)).toBe("balanced");
    expect(presetForDestination("email", SOURCE)).toBe("balanced");
    expect(presetForDestination("archive", SOURCE)).toBe("maximum");
  });

  it("offers Fit / Fill only for the vertical and square canvases", () => {
    expect(DESTINATION_IDS.filter(hasFramingChoice)).toEqual(["vertical", "square"]);
  });
});

describe("planCopy", () => {
  it("YouTube: bigger on purpose, scaled up into 2560×1440 with black bars, studio sound", () => {
    const p = plan("youtube");
    expect(p.group).toBe("send-more");
    expect(p.sizeKind).toBe("up-to");
    expect(p.estimateBytes).toBeGreaterThan(SIZE);
    expect(p.direction).toBe("bigger");
    expect(p.picture).toEqual({ width: 2560, height: 1440, scale: "up", edges: "black-bars" });
    expect(p.smoothness).toEqual({ change: "same" });
    expect(p.sound).toBe("studio");
    expect(p.underGithubFreeLimit).toBeNull();
  });

  it("YouTube from a 16:9 recording adds no bars", () => {
    const p = plan("youtube", { source: { ...SOURCE, width: 1920, height: 1080 } });
    expect(p.picture.edges).toBe("none");
  });

  it("Reels: fills 1080×1920 by cropping, or fits with blurred bands", () => {
    expect(plan("vertical").picture).toMatchObject({
      width: 1080,
      height: 1920,
      edges: "cropped",
      scale: "up",
    });
    expect(plan("vertical", { framing: "fit" }).picture).toMatchObject({
      edges: "blurred-bands",
      scale: "down",
    });
  });

  it("GitHub: lighter, same picture, smoothness capped to 24, standard sound", () => {
    const p = plan("github");
    expect(p.group).toBe("keep-light");
    expect(p.sizeKind).toBe("about");
    expect(p.direction).toBe("lighter");
    expect(p.picture).toEqual({ width: 1916, height: 1048, scale: "same", edges: "none" });
    expect(p.smoothness).toEqual({ change: "capped", fps: 24 });
    expect(p.sound).toBe("standard");
  });

  it("GitHub says 'under the 10 MB limit' only when the estimate really fits it", () => {
    expect(plan("github").underGithubFreeLimit).toBe(false);
    expect(plan("github", { durationSec: 20 }).underGithubFreeLimit).toBe(true);
    expect(plan("chat", { durationSec: 20 }).underGithubFreeLimit).toBeNull();
  });

  it("a keep-light copy no smaller than the recording says so instead of claiming lighter", () => {
    expect(plan("chat", { sourceSizeBytes: 1_000_000 }).direction).toBe("not-lighter");
  });

  it("scales a large recording down for the tiers, and keeps a 24 fps one smooth", () => {
    const p = plan("chat", { source: { ...SOURCE, width: 3024, height: 1964, fps: 24 } });
    expect(p.picture.scale).toBe("down");
    expect(p.smoothness).toEqual({ change: "same" });
  });

  it("Archive: full size, nothing changes", () => {
    const p = plan("archive");
    expect(p.group).toBe("keep");
    expect(p.sizeKind).toBe("full");
    expect(p.estimateBytes).toBeNull();
    expect(p.direction).toBe("same");
    expect(p.picture).toEqual({ width: 1916, height: 1048, scale: "same", edges: "none" });
    expect(p.smoothness).toEqual({ change: "same" });
    expect(p.sound).toBe("same");
  });

  it("no sound in the recording means no sound in the copy, and no size means unknown", () => {
    const p = plan("youtube", { source: { ...SOURCE, hasAudio: false }, sourceSizeBytes: null });
    expect(p.sound).toBe("none");
    expect(p.direction).toBe("unknown");
  });
});
