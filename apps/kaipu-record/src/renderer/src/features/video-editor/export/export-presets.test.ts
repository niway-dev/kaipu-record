import { describe, expect, it } from "vitest";
import {
  EXPORT_PRESET_IDS,
  type ExportSourceInfo,
  MB,
  PACKET_MARGIN,
  SIZE_BUDGET_RATIO,
  SMALL_AUDIO_BITRATE,
  even,
  fixedVideoBitrate,
  isExportFraming,
  isExportPresetId,
  packetCountsFor,
  reserveBytes,
  resolveExportTarget,
  shrinkSmallFileTarget,
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
    it(`${name}: Original keeps the native size with QUALITY_HIGH`, () => {
      const t = resolveExportTarget("original", source, 60);
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

    it(`${name}: Small file never upscales and keeps the source aspect with even sides`, () => {
      const t = resolveExportTarget("small-25", source, 30);
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

  it("Original and Small file are identity (no framing)", () => {
    expect(resolveExportTarget("original", SOURCES["16:9"], 10).framing).toBe("identity");
    expect(resolveExportTarget("small-10", SOURCES["16:9"], 10).framing).toBe("identity");
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

describe("Small file ladder (FR6)", () => {
  const cases: Array<{
    preset: "small-10" | "small-25";
    seconds: number;
    shortSide: number;
    achievable: boolean;
  }> = [
    { preset: "small-10", seconds: 30, shortSide: 1080, achievable: true },
    { preset: "small-10", seconds: 120, shortSide: 540, achievable: true },
    { preset: "small-10", seconds: 300, shortSide: 480, achievable: false },
    { preset: "small-10", seconds: 900, shortSide: 480, achievable: false },
    { preset: "small-25", seconds: 30, shortSide: 1080, achievable: true },
    { preset: "small-25", seconds: 120, shortSide: 1080, achievable: true },
    { preset: "small-25", seconds: 300, shortSide: 540, achievable: true },
    { preset: "small-25", seconds: 900, shortSide: 480, achievable: false },
  ];

  for (const c of cases) {
    it(`${c.preset} @ ${c.seconds}s on 1920×1080 → ${c.shortSide}p, achievable=${c.achievable}`, () => {
      const t = resolveExportTarget(c.preset, SOURCES["16:9"], c.seconds);
      expect(t.height).toBe(c.shortSide);
      expect(t.achievable).toBe(c.achievable);
      expect(t.audioChannels).toBe(1);
      expect(t.audioBitrate).toBe(SMALL_AUDIO_BITRATE);
      if (c.achievable) {
        // The chosen bitrate fits the budget (moov reservation included).
        const bytes =
          ((Number(t.videoBitrate) + SMALL_AUDIO_BITRATE) * c.seconds) / 8 +
          reserveBytes(t.packetCounts);
        expect(bytes).toBeLessThanOrEqual(t.capBytes! * SIZE_BUDGET_RATIO + 1);
        expect(t.estimateBytes).toBeLessThanOrEqual(t.capBytes!);
      } else {
        expect(t.estimateBytes!).toBeGreaterThan(t.capBytes!);
        expect(t.maxDurationSec).toBeGreaterThan(0);
        expect(t.maxDurationSec!).toBeLessThan(c.seconds);
      }
    });
  }

  it("caps fps at 30 below 1080p and keeps the source rate at 1080p", () => {
    const fast = src(1920, 1080, { fps: 60 });
    expect(resolveExportTarget("small-10", fast, 120).maxFps).toBe(30);
    expect(resolveExportTarget("small-25", fast, 30).maxFps).toBeNull();
  });

  it("never exceeds the fixed-preset ceiling on a short clip", () => {
    const t = resolveExportTarget("small-25", SOURCES["16:9"], 5);
    expect(t.videoBitrate).toBe(8_000_000);
  });

  it("a 720p source never goes above 720p", () => {
    const t = resolveExportTarget("small-25", SOURCES.small720, 30);
    expect(pick(t)).toEqual([1280, 720]);
  });

  it("a source smaller than 480p keeps its own size", () => {
    const t = resolveExportTarget("small-10", src(640, 360), 30);
    expect(pick(t)).toEqual([640, 360]);
  });

  it("a portrait source steps down on its short (width) side", () => {
    const t = resolveExportTarget("small-10", SOURCES.portrait, 60);
    expect(pick(t)).toEqual([720, 1280]);
  });

  it("silent or muted exports give the audio budget to video", () => {
    const voiced = resolveExportTarget("small-10", SOURCES["16:9"], 120);
    const silent = resolveExportTarget("small-10", src(1920, 1080, { hasAudio: false }), 120);
    expect(Number(silent.videoBitrate)).toBeGreaterThan(Number(voiced.videoBitrate));
    expect(silent.packetCounts.audio).toBe(0);
  });

  it("the cap is decimal MB", () => {
    expect(resolveExportTarget("small-10", SOURCES["16:9"], 30).capBytes).toBe(10 * MB);
    expect(resolveExportTarget("small-25", SOURCES["16:9"], 30).capBytes).toBe(25_000_000);
  });
});

describe("shrinkSmallFileTarget (FR8)", () => {
  it("re-targets V × 0.8 × cap / actual on the same rung when that stays above its floor", () => {
    const t = resolveExportTarget("small-25", SOURCES["16:9"], 30); // 1080p rung
    const shrunk = shrinkSmallFileTarget(t, 26_000_000, SOURCES["16:9"]);
    expect(shrunk.height).toBe(t.height);
    expect(shrunk.videoBitrate).toBe(
      Math.floor((Number(t.videoBitrate) * 0.8 * 25_000_000) / 26_000_000),
    );
  });

  it("steps one rung down (fps ≤ 30) when the new bitrate falls below the rung floor", () => {
    const t = resolveExportTarget("small-10", SOURCES["16:9"], 120); // 540p rung
    const shrunk = shrinkSmallFileTarget(t, 14_000_000, SOURCES["16:9"]);
    expect(shrunk.height).toBe(480);
    expect(shrunk.width).toBe(852);
    expect(shrunk.maxFps).toBe(30);
    expect(Number(shrunk.videoBitrate)).toBeLessThan(Number(t.videoBitrate));
  });

  it("leaves non-capped targets alone", () => {
    const t = resolveExportTarget("youtube", SOURCES["16:9"], 60);
    expect(shrinkSmallFileTarget(t, 999_000_000, SOURCES["16:9"])).toBe(t);
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

  it("the reservation stays small relative to the cap (≈4% on a 2-minute 10 MB export)", () => {
    const t = resolveExportTarget("small-10", SOURCES["16:9"], 120);
    expect(reserveBytes(t.packetCounts)).toBeLessThan(0.05 * 10 * MB);
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
