import { describe, expect, it } from "vitest";
import {
  audioEncodingCandidates,
  encodeFingerprint,
  EXPORT_PRESET_IDS,
  FIXED_AUDIO_BITRATE,
  type ExportSourceInfo,
  MB,
  PACKET_MARGIN,
  QUALITY_TIERS,
  even,
  fixedVideoBitrate,
  githubFit,
  githubPlans,
  isExportFraming,
  isExportPresetId,
  normalizeExportPresetId,
  packetCountsFor,
  reserveBytes,
  resolveExportTarget,
  sizeForShortSide,
  slideFrameCount,
} from "./export-presets";

const src = (width: number, height: number, extra: Partial<ExportSourceInfo> = {}) => ({
  width,
  height,
  fps: 30,
  hasAudio: true,
  sampleRate: 48000,
  ...extra,
});

const SOURCES = {
  "16:9": src(1920, 1080),
  macbook: src(1662, 1080),
  "4:3": src(1440, 1080),
  ultrawide: src(5120, 1440),
  portrait: src(1080, 1920),
  small720: src(1280, 720),
};

describe("ids and guards", () => {
  it("lists every preset once and validates ids/framings", () => {
    expect(new Set(EXPORT_PRESET_IDS).size).toBe(EXPORT_PRESET_IDS.length);
    expect(isExportPresetId("vertical")).toBe(true);
    expect(isExportPresetId("tiktok")).toBe(false);
    expect(isExportFraming("fill")).toBe(true);
    expect(isExportFraming("stretch")).toBe(false);
  });

  it("puts the recommended Balanced first and Maximum last (the sheet's order)", () => {
    expect(EXPORT_PRESET_IDS[0]).toBe("balanced");
    expect(EXPORT_PRESET_IDS.at(-1)).toBe("maximum");
  });

  it('reads the legacy ids (older sidecars): "original" as Maximum, the Small-file rows as Light', () => {
    expect(isExportPresetId("original")).toBe(false);
    expect(isExportPresetId("small-10")).toBe(false);
    expect(normalizeExportPresetId("original")).toBe("maximum");
    expect(normalizeExportPresetId("small-10")).toBe("light");
    expect(normalizeExportPresetId("small-25")).toBe("light");
    expect(normalizeExportPresetId("square")).toBe("square");
    expect(normalizeExportPresetId("tiktok")).toBeNull();
    expect(normalizeExportPresetId(undefined)).toBeNull();
  });
});

describe("even", () => {
  it("rounds down to an even integer, never below 2", () => {
    expect(even(1662)).toBe(1662);
    expect(even(1081)).toBe(1080);
    expect(even(1080.9)).toBe(1080);
    expect(even(1)).toBe(2);
  });
});

describe("resolveExportTarget — dimensions per preset × source aspect", () => {
  for (const [name, source] of Object.entries(SOURCES)) {
    it(`${name}: Maximum keeps the native size with QUALITY_HIGH`, () => {
      const t = resolveExportTarget("maximum", source, 60);
      expect([t.width, t.height]).toEqual([source.width, source.height]);
      expect(t.videoBitrate).toBe("high");
      expect(t.audioBitrate).toBe("high");
      expect(t.framing).toBe("identity");
      expect(t.fastStart).toBe("reserve");
      expect(t.estimateBytes).toBeNull();
    });

    it(`${name}: fixed presets always output the exact canvas (upscale included)`, () => {
      expect(pick(resolveExportTarget("youtube", source, 60))).toEqual([1920, 1080]);
      expect(pick(resolveExportTarget("vertical", source, 60))).toEqual([1080, 1920]);
      expect(pick(resolveExportTarget("square", source, 60))).toEqual([1080, 1080]);
    });

    it(`${name}: Light never upscales and keeps the source aspect with even sides`, () => {
      const t = resolveExportTarget("light", source, 30);
      expect(t.width % 2).toBe(0);
      expect(t.height % 2).toBe(0);
      expect(Math.min(t.width, t.height)).toBeLessThanOrEqual(
        Math.min(source.width, source.height),
      );
      expect(t.width / t.height).toBeCloseTo(source.width / source.height, 1);
    });
  }
});

const pick = (t: { width: number; height: number }) => [t.width, t.height];

describe("framing", () => {
  it("YouTube is always Fit with black padding, whatever is asked", () => {
    const t = resolveExportTarget("youtube", SOURCES.macbook, 10, { framing: "fill" });
    expect(t.framing).toBe("fit");
    expect(t.padding).toBe("black");
  });

  it("defaults: Vertical = Fill, Square = Fit, both with blurred padding", () => {
    expect(resolveExportTarget("vertical", SOURCES["16:9"], 10).framing).toBe("fill");
    expect(resolveExportTarget("square", SOURCES["16:9"], 10).framing).toBe("fit");
    expect(resolveExportTarget("vertical", SOURCES["16:9"], 10).padding).toBe("blur");
  });

  it("honours an explicit Fit/Fill on Vertical and Square", () => {
    expect(resolveExportTarget("vertical", SOURCES["16:9"], 10, { framing: "fit" }).framing).toBe(
      "fit",
    );
    expect(resolveExportTarget("square", SOURCES["16:9"], 10, { framing: "fill" }).framing).toBe(
      "fill",
    );
  });

  it("Balanced, Light and Maximum are identity (no framing)", () => {
    expect(resolveExportTarget("balanced", SOURCES["16:9"], 10).framing).toBe("identity");
    expect(resolveExportTarget("maximum", SOURCES["16:9"], 10).framing).toBe("identity");
    expect(resolveExportTarget("light", SOURCES["16:9"], 10).framing).toBe("identity");
  });
});

describe("Balanced (recommended default, the measured 1080p · 15 fps · 2 Mbps tier)", () => {
  it("keeps a 1080p-or-smaller source at its own size (never upscales)", () => {
    expect(pick(resolveExportTarget("balanced", SOURCES.macbook, 60))).toEqual([1662, 1080]);
    expect(pick(resolveExportTarget("balanced", SOURCES["16:9"], 60))).toEqual([1920, 1080]);
    expect(pick(resolveExportTarget("balanced", SOURCES.small720, 60))).toEqual([1280, 720]);
  });

  it("caps a bigger source at 1080 on its short side, at the source aspect", () => {
    expect(pick(resolveExportTarget("balanced", src(3840, 2160), 60))).toEqual([1920, 1080]);
    expect(pick(resolveExportTarget("balanced", SOURCES.ultrawide, 60))).toEqual([3840, 1080]);
    expect(pick(resolveExportTarget("balanced", src(2160, 3840), 60))).toEqual([1080, 1920]);
  });

  it("targets 2 Mbps + 128 kbps at ≤ 15 fps (~16 MB a minute)", () => {
    const t = resolveExportTarget("balanced", src(1920, 1080, { fps: 60 }), 60);
    expect(t.videoBitrate).toBe(2_000_000);
    expect(t.audioBitrate).toBe(FIXED_AUDIO_BITRATE);
    expect(t.audioChannels).toBeNull();
    expect(t.maxFps).toBe(15);
    expect(t.fastStart).toBe("reserve");
    expect(t.estimateBytes! / MB).toBeGreaterThan(15.9);
    expect(t.estimateBytes! / MB).toBeLessThan(16.2); // + the moov reservation
  });

  it("gives a source below 1080p proportionally fewer bits", () => {
    const t = resolveExportTarget("balanced", SOURCES.small720, 60);
    expect(t.videoBitrate).toBe(
      Math.round(QUALITY_TIERS.balanced.videoBitrate * (720 / 1080) ** 2),
    );
  });

  it("leaves the audio share out of the estimate for a silent export", () => {
    const withAudio = resolveExportTarget("balanced", SOURCES["16:9"], 60);
    const silent = resolveExportTarget("balanced", { ...SOURCES["16:9"], hasAudio: false }, 60);
    expect(withAudio.estimateBytes! - silent.estimateBytes!).toBeGreaterThan(
      (FIXED_AUDIO_BITRATE * 60) / 8 - 50_000,
    );
    expect(silent.packetCounts.audio).toBe(0);
  });
});

describe("bitrates (FR5)", () => {
  it("8 Mbps ≤ 30 fps and 12 Mbps above for 1080p canvases, scaled by pixels for square", () => {
    expect(fixedVideoBitrate(1920, 1080, 30)).toBe(8_000_000);
    expect(fixedVideoBitrate(1920, 1080, 60)).toBe(12_000_000);
    expect(fixedVideoBitrate(1080, 1920, 30)).toBe(8_000_000);
    expect(fixedVideoBitrate(1080, 1080, 30)).toBe(4_500_000);
    expect(fixedVideoBitrate(1080, 1080, 60)).toBe(6_750_000);
  });

  it("fixed presets use 128 kbps AAC and keep the source cadence", () => {
    const t = resolveExportTarget("youtube", src(1920, 1080, { fps: 60 }), 10);
    expect(t.videoBitrate).toBe(12_000_000);
    expect(t.audioBitrate).toBe(128_000);
    expect(t.audioChannels).toBeNull();
    expect(t.maxFps).toBeNull();
  });
});

describe("size estimate (FR7)", () => {
  it("fixed presets: (V + A) × D / 8 plus the moov reservation", () => {
    const t = resolveExportTarget("youtube", SOURCES["16:9"], 120);
    const content = ((8_000_000 + 128_000) * 120) / 8;
    expect(t.estimateBytes).toBe(Math.ceil(content + reserveBytes(t.packetCounts)));
  });

  it("no-audio sources leave the audio share out of the estimate", () => {
    const withAudio = resolveExportTarget("square", SOURCES["16:9"], 60).estimateBytes!;
    const without = resolveExportTarget(
      "square",
      src(1920, 1080, { hasAudio: false }),
      60,
    ).estimateBytes!;
    expect(withAudio - without).toBeGreaterThanOrEqual((128_000 * 60) / 8);
  });
});

describe("Light (720p · 15 fps · 1.2 Mbps, mono 64 kbps)", () => {
  it("caps the short side at 720, never upscales, at the source aspect", () => {
    expect(pick(resolveExportTarget("light", src(2560, 1440), 60))).toEqual([1280, 720]);
    expect(pick(resolveExportTarget("light", SOURCES.macbook, 60))).toEqual([1108, 720]);
    expect(pick(resolveExportTarget("light", SOURCES.portrait, 60))).toEqual([720, 1280]);
    expect(pick(resolveExportTarget("light", src(960, 540), 60))).toEqual([960, 540]);
  });

  it("targets ~9 MB a minute at ≤ 15 fps, whatever the length — the tier is the floor", () => {
    const minute = resolveExportTarget("light", src(2560, 1440, { fps: 60 }), 60);
    expect(minute.videoBitrate).toBe(1_200_000);
    expect(minute.audioBitrate).toBe(64_000);
    expect(minute.audioChannels).toBe(1);
    expect(minute.maxFps).toBe(15);
    expect(minute.estimateBytes! / MB).toBeGreaterThan(9.4);
    expect(minute.estimateBytes! / MB).toBeLessThan(9.7); // + the moov reservation
    // The owner's 2:51 terminal recording: same quality, just a bigger file (no squeeze).
    const long = resolveExportTarget("light", src(2560, 1440), 171);
    expect(long.videoBitrate).toBe(1_200_000);
    expect(pick(long)).toEqual([1280, 720]);
    expect(long.estimateBytes! / MB).toBeGreaterThan(26);
  });
});

describe("githubFit (100 MB, paid plans)", () => {
  it("fits up to 100 MB, decimal", () => {
    expect(githubFit(100 * MB)).toBe("fits");
    expect(githubFit(100 * MB + 1)).toBe("too-big");
  });

  it("ten minutes of Light fit; twelve do not", () => {
    expect(githubFit(resolveExportTarget("light", src(2560, 1440), 600).estimateBytes!)).toBe(
      "fits",
    );
    expect(githubFit(resolveExportTarget("light", src(2560, 1440), 720).estimateBytes!)).toBe(
      "too-big",
    );
  });
});

describe("githubPlans (Free 10 MB, Pro / Team / Enterprise 100 MB)", () => {
  it("answers both plans, decimal", () => {
    expect(githubPlans(10 * MB)).toEqual({ free: true, paid: true });
    expect(githubPlans(10 * MB + 1)).toEqual({ free: false, paid: true });
    expect(githubPlans(100 * MB + 1)).toEqual({ free: false, paid: false });
  });
});

describe("encodeFingerprint", () => {
  it("adds the tiers' encode revision, so files made with older numbers never match", () => {
    expect(encodeFingerprint("whole", "light")).toBe("whole#15fps-1.2m");
    expect(encodeFingerprint("edit:abc", "balanced")).toBe("edit:abc#15fps-2m");
    // Unchanged encodes keep the bare fingerprint (their older files still match).
    expect(encodeFingerprint("whole", "youtube")).toBe("whole");
    expect(encodeFingerprint("whole", "maximum")).toBe("whole");
  });
});

describe("sizeForShortSide", () => {
  it("keeps the aspect with even sides", () => {
    expect(sizeForShortSide(1662, 1080, 720)).toEqual({ width: 1108, height: 720 });
    expect(sizeForShortSide(5120, 1440, 480)).toEqual({ width: 1706, height: 480 });
    expect(sizeForShortSide(1080, 1920, 540)).toEqual({ width: 540, height: 960 });
  });
});

describe("packetCountsFor (FR9 maximumPacketCount)", () => {
  it("video = ceil(D × fps × 1.33) + slide frames (+1), audio = ceil(D × sr / 1024 × 1.33) (+1)", () => {
    const c = packetCountsFor({
      durationSec: 10,
      fps: 60,
      maxFps: null,
      slideFrames: 90,
      hasAudio: true,
      sampleRate: 48000,
    });
    expect(c.video).toBe(Math.ceil(10 * 60 * PACKET_MARGIN) + 90 + 1);
    expect(c.audio).toBe(Math.ceil(((10 * 48000) / 1024) * PACKET_MARGIN) + 1);
  });

  it("never assumes less than 30 fps without a cap (VFR bursts), and honours a cap", () => {
    const base = { durationSec: 10, slideFrames: 0, hasAudio: false, sampleRate: 48000 };
    expect(packetCountsFor({ ...base, fps: 12, maxFps: null }).video).toBe(
      Math.ceil(10 * 30 * PACKET_MARGIN) + 1,
    );
    expect(packetCountsFor({ ...base, fps: 60, maxFps: 30 }).video).toBe(
      Math.ceil(10 * 30 * PACKET_MARGIN) + 1,
    );
    expect(packetCountsFor({ ...base, fps: 60, maxFps: 30 }).audio).toBe(0);
  });

  it("the reservation stays small (< 2% of a 2-minute Light export)", () => {
    const t = resolveExportTarget("light", SOURCES["16:9"], 120);
    expect(reserveBytes(t.packetCounts)).toBeLessThan(0.02 * t.estimateBytes!);
  });
});

describe("slideFrameCount", () => {
  it("sums round(duration × fps) over slide segments only", () => {
    expect(
      slideFrameCount(
        [
          { kind: "clip", duration: 10 },
          { kind: "slide", duration: 2 },
          { kind: "slide", duration: 0.5 },
        ],
        30,
      ),
    ).toBe(75);
  });
});

describe("audioEncodingCandidates", () => {
  it("tries mono 64 kbps first for Light, then keeps the source channels", () => {
    expect(audioEncodingCandidates({ audioBitrate: 64_000, audioChannels: 1 }, 2)).toEqual([
      { numberOfChannels: 1, bitrate: 64_000 },
      { numberOfChannels: 2, bitrate: 64_000 },
      { numberOfChannels: 2, bitrate: 96_000 },
      { numberOfChannels: 2, bitrate: 128_000 },
    ]);
  });

  it("keeps a single config when the preset keeps the source layout", () => {
    expect(audioEncodingCandidates({ audioBitrate: 128_000, audioChannels: null }, 2)).toEqual([
      { numberOfChannels: 2, bitrate: 128_000 },
    ]);
  });

  it("drops duplicates when the source is already mono", () => {
    expect(audioEncodingCandidates({ audioBitrate: 64_000, audioChannels: 1 }, 1)).toEqual([
      { numberOfChannels: 1, bitrate: 64_000 },
      { numberOfChannels: 1, bitrate: 96_000 },
      { numberOfChannels: 1, bitrate: 128_000 },
    ]);
  });
});
