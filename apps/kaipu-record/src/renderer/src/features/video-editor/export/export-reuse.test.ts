import { describe, expect, it } from "vitest";
import type { LibraryVideo } from "@renderer/features/library/types";
import { initialScene, type VideoScene } from "../scene";
import { parseSession, serializeSession } from "../session";
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
    const old = exported("old", 1, { preset: "balanced", fingerprint: "whole#15fps-2m" });
    const fresh = exported("new", 2, { preset: "balanced", fingerprint: "whole#15fps-2m" });
    const yt = exported("yt", 3, { preset: "youtube", fingerprint: whole });
    const found = findReusableExports([old, fresh, yt], whole);
    expect(found.balanced?.assetId).toBe("new");
    expect(found.youtube?.assetId).toBe("yt");
    expect(found.vertical).toBeUndefined();
  });

  it("never reuses a file with different content (an edit vs the whole recording, an older edit)", () => {
    const edit = exported("edit", 1, { preset: "balanced", fingerprint: "edit:abc#15fps-2m" });
    expect(findReusableExports([edit], whole)).toEqual({});
    expect(findReusableExports([edit], "edit:def")).toEqual({});
    expect(findReusableExports([edit], "edit:abc").balanced?.assetId).toBe("edit");
  });

  it("never reuses a file a different encode made: older Balanced numbers, the old Small file", () => {
    // Before the quality tiers: Balanced was 30 fps · 3 Mbps, and small-10 reads as Light.
    const oldBalanced = exported("old-balanced", 1, { preset: "balanced", fingerprint: whole });
    const oldSmall = exported("old-small", 2, { preset: "light", fingerprint: whole });
    const fresh = exported("light", 3, { preset: "light", fingerprint: "whole#15fps-1.2m" });
    expect(findReusableExports([oldBalanced, oldSmall], whole)).toEqual({});
    expect(findReusableExports([oldBalanced, oldSmall, fresh], whole).light?.assetId).toBe("light");
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
