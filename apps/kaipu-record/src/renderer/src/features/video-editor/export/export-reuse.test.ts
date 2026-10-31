import { describe, expect, it } from "vitest";
import type { LibraryVideo } from "@renderer/features/library/types";
import { initialScene, type VideoScene } from "../scene";
import { parseSession, serializeSession } from "../session";
import { normalizeExportPresetId } from "./export-presets";
import { WHOLE_RECORDING_FINGERPRINT, editFingerprint, findReusableExports } from "./export-reuse";

function exported(
  assetId: string,
  createdAt: number,
  exp: LibraryVideo["export"],
  extra: Partial<LibraryVideo> = {},
): LibraryVideo {
  return {
    id: `local-${assetId}`,
    assetId,
    kind: "recording",
    title: assetId,
    createdAt,
    durationSeconds: 10,
    fileSizeBytes: 100,
    cloudSizeBytes: null,
    availability: "local",
    comparison: "same",
    editing: "exported-only",
    transfer: { state: "idle" },
    derivedFromAssetId: "source",
    editSavedAt: null,
    editExportedSavedAt: null,
    export: exp,
    ...extra,
  };
}

describe("editFingerprint — webcam", () => {
  const track = {
    startOffsetMs: 0,
    offsetQuality: "exact",
    width: 1280,
    height: 720,
    fps: 30,
  } as const;
  const fixed = (webcam: typeof track | null): VideoScene => {
    const scene = initialScene(10, webcam);
    return { ...scene, items: [{ ...scene.items[0]!, id: "clip" }] };
  };

  it("changes with the layer, so an export without the face is never reused for one with it", () => {
    const scene = fixed(track);
    const moved = {
      ...scene,
      webcam: { ...scene.webcam!, layout: { ...scene.webcam!.layout, shape: "rounded" as const } },
    };
    expect(editFingerprint(moved)).not.toBe(editFingerprint(scene));
    expect(editFingerprint(scene)).not.toBe(editFingerprint(fixed(null)));
  });

  it("is the legacy fingerprint for a recording without a webcam (old exports stay reusable)", () => {
    // Pinned: the hash of the scene as it was serialized before the `webcam` key existed.
    expect(editFingerprint(fixed(null))).toBe("edit:2bdufz02r20");
  });
});

describe("editFingerprint", () => {
  it("is stable for the same scene and changes with any edit", () => {
    const scene = initialScene(10);
    expect(editFingerprint(scene)).toBe(editFingerprint(structuredClone(scene)));
    expect(editFingerprint(scene)).toMatch(/^edit:/);
    expect(editFingerprint({ ...scene, audioMuted: true })).not.toBe(editFingerprint(scene));
  });

  it("ignores key order (a scene re-read from its session file hashes the same)", () => {
    const scene = initialScene(10);
    const reordered = Object.fromEntries(Object.entries(scene).reverse()) as typeof scene;
    expect(editFingerprint(reordered)).toBe(editFingerprint(scene));
  });

  it("survives a session save + reload (reopening the editor on the same edit)", () => {
    const scene: VideoScene = {
      ...initialScene(10),
      audioMuted: true,
      mutedRanges: [{ id: "m1", sourceStart: 1, sourceEnd: 2 }],
      zoomSensitivity: 40,
    };
    const reloaded = parseSession(serializeSession(scene))!.scene;
    expect(editFingerprint(reloaded)).toBe(editFingerprint(scene));
  });

  it("never equals the whole-recording fingerprint", () => {
    expect(editFingerprint(initialScene(1))).not.toBe(WHOLE_RECORDING_FINGERPRINT);
  });
});

describe("findReusableExports", () => {
  const whole = WHOLE_RECORDING_FINGERPRINT;

  it("finds the newest export per preset with the same content", () => {
    const old = exported("old", 1, { preset: "balanced", fingerprint: "whole#q30-24fps-kfi10" });
    const fresh = exported("new", 2, { preset: "balanced", fingerprint: "whole#q30-24fps-kfi10" });
    const yt = exported("yt", 3, { preset: "youtube-1440", fingerprint: "whole#2560x1440-v1" });
    const sq = exported("sq", 4, { preset: "square", fingerprint: whole });
    const found = findReusableExports([old, fresh, yt, sq], whole);
    expect(found.balanced?.assetId).toBe("new");
    expect(found["youtube-1440"]?.assetId).toBe("yt");
    expect(found.square?.assetId).toBe("sq");
    expect(found.vertical).toBeUndefined();
  });

  it('never reuses an old 1920×1080 "youtube" file for YouTube 1440p or 4K (NIW2-564)', () => {
    // Main reads the legacy sidecar `exportPreset: "youtube"` as youtube-1440, and the file's
    // fingerprint predates the canvases' encode revision.
    const legacy = exported("legacy-yt", 1, {
      preset: normalizeExportPresetId("youtube")!,
      fingerprint: whole,
    });
    expect(legacy.export?.preset).toBe("youtube-1440");
    expect(findReusableExports([legacy], whole)).toEqual({});
    const fresh = exported("yt", 2, { preset: "youtube-1440", fingerprint: "whole#2560x1440-v1" });
    expect(findReusableExports([legacy, fresh], whole)["youtube-1440"]?.assetId).toBe("yt");
  });

  it("never reuses a file with different content (an edit vs the whole recording, an older edit)", () => {
    const edit = exported("edit", 1, {
      preset: "balanced",
      fingerprint: "edit:abc#q30-24fps-kfi10",
    });
    expect(findReusableExports([edit], whole)).toEqual({});
    expect(findReusableExports([edit], "edit:def")).toEqual({});
    expect(findReusableExports([edit], "edit:abc").balanced?.assetId).toBe("edit");
  });

  it("never reuses a file a different encode made: older Balanced numbers, the old Small file", () => {
    // Before the quality tiers: Balanced was 30 fps · 3 Mbps, and small-10 reads as Light.
    const oldBalanced = exported("old-balanced", 1, { preset: "balanced", fingerprint: whole });
    const oldSmall = exported("old-small", 2, { preset: "light", fingerprint: whole });
    const fresh = exported("light", 3, { preset: "light", fingerprint: "whole#q33-24fps-kfi10" });
    expect(findReusableExports([oldBalanced, oldSmall], whole)).toEqual({});
    expect(findReusableExports([oldBalanced, oldSmall, fresh], whole).light?.assetId).toBe("light");
  });

  it("never reuses a bitrate-tier file (15 fps) once the tiers encode by quantizer", () => {
    const bitrateTier = exported("bitrate-tier", 1, {
      preset: "balanced",
      fingerprint: "whole#15fps-2m",
    });
    expect(findReusableExports([bitrateTier], whole)).toEqual({});
  });

  it("skips exports without a fingerprint, GIFs and files that aren't on this device", () => {
    const legacy = exported("legacy", 1, { preset: "maximum", fingerprint: null });
    const gif = exported("gif", 2, null, { kind: "gif" });
    const cloudOnly = exported(
      "cloud",
      3,
      { preset: "balanced", fingerprint: whole },
      { id: null },
    );
    expect(findReusableExports([legacy, gif, cloudOnly], whole)).toEqual({});
  });
});
