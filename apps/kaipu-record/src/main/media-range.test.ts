import { describe, expect, it } from "vitest";
import { parseByteRange } from "./media-range";

describe("parseByteRange", () => {
  it("returns null (serve 200 full body) when no Range header is present", () => {
    expect(parseByteRange(null, 1000)).toBeNull();
  });

  it("parses Chromium's media seek form `bytes=<offset>-` to an offset→EOF slice", () => {
    // This exact shape is what a <video> seek outside the buffered range sends;
    // answering it with a 200 full body permanently wedges the element in `seeking`.
    expect(parseByteRange("bytes=39452672-", 51000000)).toEqual({
      start: 39452672,
      end: 50999999,
    });
  });

  it("parses the initial load form `bytes=0-` as the whole file", () => {
    expect(parseByteRange("bytes=0-", 1000)).toEqual({ start: 0, end: 999 });
  });

  it("parses a bounded range and clamps the end to the file size", () => {
    expect(parseByteRange("bytes=10-19", 1000)).toEqual({ start: 10, end: 19 });
    expect(parseByteRange("bytes=990-2000", 1000)).toEqual({ start: 990, end: 999 });
  });

  it("parses the suffix form `bytes=-N` as the last N bytes", () => {
    expect(parseByteRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseByteRange("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 });
  });

  it("flags out-of-bounds ranges as unsatisfiable (→ 416)", () => {
    expect(parseByteRange("bytes=1000-", 1000)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=500-400", 1000)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=-0", 1000)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=0-", 0)).toBe("unsatisfiable");
  });

  it("ignores malformed or multi-range headers (→ 200 full body, per RFC 9110)", () => {
    expect(parseByteRange("bytes=", 1000)).toBeNull();
    expect(parseByteRange("bytes=0-1,5-6", 1000)).toBeNull();
    expect(parseByteRange("items=0-10", 1000)).toBeNull();
    expect(parseByteRange("garbage", 1000)).toBeNull();
  });
});
