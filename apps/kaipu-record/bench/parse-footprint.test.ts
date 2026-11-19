import { describe, expect, it } from "vitest";
import { parseFootprint, parseSize } from "./parse-footprint";

const SINGLE = `Electron Helper (Renderer) [43231]: 64-bit    Footprint: 599 MB (16384 bytes per page)
    phys_footprint: 596 MB
    phys_footprint_peak: 1025 MB
`;

const MULTI = `======================================================================
Electron Helper (Renderer) [43231]: 64-bit    Footprint: 459229968 B (16384 bytes per page)
======================================================================

Auxiliary data:
    phys_footprint: 459262736 B
    phys_footprint_peak: 1683049976 B

======================================================================
Electron [43129]: 64-bit    Footprint: 7313 KB (16384 bytes per page)
======================================================================

Auxiliary data:
    phys_footprint: 7313 KB
    phys_footprint_peak: 1.5 GB

======================================================================
Summary Footprint: 756 MB
======================================================================
`;

describe("parseSize", () => {
  it("converts B, KB, MB and GB with binary units", () => {
    expect(parseSize("12", "B")).toBe(12);
    expect(parseSize("7313", "KB")).toBe(7313 * 1024);
    expect(parseSize("596", "MB")).toBe(596 * 1024 ** 2);
    expect(parseSize("1.5", "GB")).toBe(1.5 * 1024 ** 3);
  });
  it("returns null for an unknown unit", () => {
    expect(parseSize("1", "ZB")).toBeNull();
  });
});

describe("parseFootprint", () => {
  it("reads the real single-process fixture", () => {
    expect(parseFootprint(SINGLE)).toEqual([
      {
        pid: 43231,
        footprintBytes: 596 * 1024 ** 2,
        peakBytes: 1025 * 1024 ** 2,
      },
    ]);
  });
  it("reads several processes and ignores the summary block", () => {
    const rows = parseFootprint(MULTI);
    expect(rows.map((r) => r.pid)).toEqual([43231, 43129]);
    expect(rows[0]).toEqual({ pid: 43231, footprintBytes: 459262736, peakBytes: 1683049976 });
    expect(rows[1]?.footprintBytes).toBe(7313 * 1024);
    expect(rows[1]?.peakBytes).toBe(1.5 * 1024 ** 3);
  });
  it("falls back to the header Footprint when phys_footprint is missing", () => {
    const rows = parseFootprint("Foo [5]: 64-bit    Footprint: 2 MB (16384 bytes per page)\n");
    expect(rows).toEqual([{ pid: 5, footprintBytes: 2 * 1024 ** 2, peakBytes: null }]);
  });
  it("returns an empty list for garbage", () => {
    expect(parseFootprint("nothing here")).toEqual([]);
  });
});
