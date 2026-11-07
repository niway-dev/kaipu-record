import { describe, expect, it } from "vitest";
import type { LibraryVideo } from "@renderer/features/library/types";
import { initialScene, type VideoScene } from "../scene";
import { parseSession, serializeSession } from "../session";
import { encodeFingerprint, normalizeExportPresetId } from "./export-presets";
import { seedWebcamScene } from "../webcam/webcam-model";
import {
  facelessFingerprint,
  WHOLE_RECORDING_FINGERPRINT,
  editFingerprint,
  findReusableExports,
  isWholeFingerprint,
  wholeFingerprint,
} from "./export-reuse";

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

  it("is tagged only with a webcam, so an export made before the layer was drawn never matches", () => {
    // Before NIW2-575 a webcam scene fingerprinted as `edit:<hash>` and its file had no face.
    expect(editFingerprint(fixed(track))).toMatch(/^edit:wc2:[0-9a-z]+$/);
    expect(editFingerprint(fixed(null))).not.toMatch(/wc2/);
  });
});

describe("editFingerprint — background (NIW2-668)", () => {
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
  const MAGENTA = { bg: "magenta", padding: 48, radius: 16, shadow: 24 } as const;

  it("fingerprints a plain scene exactly as before the background existed (pinned)", () => {
    // Taken from the code before this change: every export already made from a plain scene
    // must still match.
    expect(editFingerprint(fixed(null))).toBe("edit:2bdufz02r20");
    expect(editFingerprint(fixed(null), true)).toBe("edit:cursor3:czrk19yfc6");
    expect(editFingerprint(fixed(track))).toBe("edit:wc2:3sdivqr4ok");
    expect(editFingerprint(fixed(track), true)).toBe("edit:cursor3:3sdivqr4ok");
  });

  it("is unchanged by a none background, even with stored padding, radius and shadow", () => {
    // With none the three numbers are kept but never drawn, so they are not part of the edit.
    const stored = { bg: "none", padding: 48, radius: 16, shadow: 24 } as const;
    for (const [webcam, cursor] of [
      [null, false],
      [null, true],
      [track, false],
      [track, true],
    ] as const) {
      const plain = fixed(webcam);
      expect(editFingerprint({ ...plain, background: stored }, cursor)).toBe(
        editFingerprint(plain, cursor),
      );
    }
    // And through a session round trip, which re-parses the stored numbers.
    const reloaded = parseSession(serializeSession({ ...fixed(null), background: stored }))!.scene;
    expect(editFingerprint(reloaded)).toBe("edit:2bdufz02r20");
  });

  it("is tagged bg1 only when a background is set", () => {
    const withBg = (webcam: typeof track | null) => ({ ...fixed(webcam), background: MAGENTA });
    expect(editFingerprint(withBg(null))).toMatch(/^edit:bg1:[0-9a-z]+$/);
    expect(editFingerprint(withBg(track))).toMatch(/^edit:wc2:bg1:[0-9a-z]+$/);
    expect(editFingerprint(withBg(null), true)).toMatch(/^edit:cursor3:bg1:[0-9a-z]+$/);
    expect(editFingerprint(withBg(track), true)).toMatch(/^edit:cursor3:bg1:[0-9a-z]+$/);
    expect(editFingerprint(fixed(null))).not.toMatch(/bg1/);
  });

  it("changes with the preset and with each number once a background is set", () => {
    const base = { ...fixed(null), background: MAGENTA };
    const keys = new Set([
      editFingerprint(base),
      editFingerprint({ ...base, background: { ...MAGENTA, bg: "ocean" } }),
      editFingerprint({ ...base, background: { ...MAGENTA, padding: 49 } }),
      editFingerprint({ ...base, background: { ...MAGENTA, radius: 17 } }),
      editFingerprint({ ...base, background: { ...MAGENTA, shadow: 25 } }),
      editFingerprint(fixed(null)),
    ]);
    expect(keys.size).toBe(6);
  });

  it("is the same after a session save and reload", () => {
    const scene = { ...fixed(null), background: MAGENTA };
    const reloaded = parseSession(serializeSession(scene))!.scene;
    expect(editFingerprint(reloaded)).toBe(editFingerprint(scene));
  });

  it("offers an old export for a plain scene but never for one with a background", () => {
    const enc = (fingerprint: string) => encodeFingerprint(fingerprint, "balanced");
    const plain = fixed(null);
    const oldExport = exported("old", 1, {
      preset: "balanced",
      // The fingerprint a build without backgrounds stamped on this edit.
      fingerprint: enc("edit:2bdufz02r20"),
    });
    expect(findReusableExports([oldExport], editFingerprint(plain)).balanced?.assetId).toBe("old");
    expect(
      findReusableExports([oldExport], editFingerprint({ ...plain, background: MAGENTA })),
    ).toEqual({});
  });

  it("leaves Share's whole-recording fingerprint alone: it takes no scene at all", () => {
    // Share composes `initialScene` (use-prepare-copy.ts), so a background set in the editor
    // never reaches it; the fingerprint has no input that could carry one.
    expect(wholeFingerprint(null)).toBe(WHOLE_RECORDING_FINGERPRINT);
    expect(wholeFingerprint.length).toBe(1);
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

describe("wholeFingerprint (Share)", () => {
  const webcam = {
    startOffsetMs: 0,
    offsetQuality: "exact" as const,
    width: 1280,
    height: 720,
    fps: 30,
  };

  it("is the plain whole-recording fingerprint without a webcam, so old Share files stay reusable", () => {
    expect(wholeFingerprint(null)).toBe(WHOLE_RECORDING_FINGERPRINT);
  });

  it("with a webcam hashes the seeded layer: stable, and a different layout is a different file", () => {
    const layer = seedWebcamScene(webcam);
    expect(wholeFingerprint(layer)).toMatch(/^whole:[0-9a-z]+$/);
    expect(wholeFingerprint(layer)).toBe(wholeFingerprint(seedWebcamScene({ ...webcam })));
    const moved = seedWebcamScene({
      ...webcam,
      recordedLayout: {
        shape: "circle",
        cornerRadius: 0.18,
        mirrored: true,
        size: 200,
        framing: { enabled: false, zoom: 1, x: 0.5, y: 0.5 },
        position: { x: 0.9, y: 0.9 },
        sizeFraction: 0.3,
      },
    });
    expect(wholeFingerprint(moved)).not.toBe(wholeFingerprint(layer));
  });

  it("is the same for a take with camera-off gaps seeded twice, so its Share file is reused", () => {
    const withGaps = {
      ...webcam,
      gaps: [
        { startMs: 2000, endMs: 4000 },
        { startMs: 6000, endMs: 6500 },
      ],
    };
    expect(wholeFingerprint(seedWebcamScene(withGaps, 10))).toBe(
      wholeFingerprint(seedWebcamScene({ ...withGaps }, 10)),
    );
  });

  it("is told apart from the pre-webcam whole and from an editor export", () => {
    const enc = (f: string) => encodeFingerprint(f, "balanced");
    const layer = seedWebcamScene(webcam);
    const faceful = wholeFingerprint(layer);
    const oldShare = exported("old", 1, {
      preset: "balanced",
      fingerprint: enc(WHOLE_RECORDING_FINGERPRINT),
    });
    const faceShare = exported("face", 2, { preset: "balanced", fingerprint: enc(faceful) });
    const edit = exported("edit", 3, {
      preset: "balanced",
      fingerprint: enc(editFingerprint(initialScene(10, webcam))),
    });
    expect(findReusableExports([oldShare, edit], faceful)).toEqual({});
    expect(findReusableExports([oldShare, faceShare, edit], faceful).balanced?.assetId).toBe(
      "face",
    );
    expect(findReusableExports([faceShare, edit], WHOLE_RECORDING_FINGERPRINT)).toEqual({});
  });

  it("isWholeFingerprint recognizes both forms and nothing else", () => {
    expect(isWholeFingerprint("whole")).toBe(true);
    expect(isWholeFingerprint("whole:abc")).toBe(true);
    expect(isWholeFingerprint("edit:wc1:abc")).toBe(false);
    expect(isWholeFingerprint(undefined)).toBe(false);
  });
});

it("never reuses a pre-cursor export for an eligible source, even with default settings", () => {
  const scene = initialScene(3);
  expect(editFingerprint(scene, true)).not.toBe(editFingerprint(scene));
  expect(editFingerprint(parseSession(serializeSession(scene))!.scene, true)).toBe(
    editFingerprint(scene, true),
  );
  expect(editFingerprint({ ...scene, cursor: { ...scene.cursor!, size: 64 } }, true)).not.toBe(
    editFingerprint(scene, true),
  );
});

describe("facelessFingerprint", () => {
  it("keeps the cursor revision of a cursor-redrawing copy that lost its face", () => {
    expect(facelessFingerprint("whole:abc123:cursor3")).toBe("whole:cursor3");
    expect(facelessFingerprint("whole:abc123")).toBe("whole");
    expect(facelessFingerprint("edit:wc2:abc")).toBeUndefined();
  });
});
