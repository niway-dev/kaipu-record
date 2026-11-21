import { describe, expect, it } from "vitest";
import {
  parseCpuTime,
  parseLoadAvg,
  parsePs,
  parsePsThreads,
  parseSwapUsage,
  parseVmStat,
  pressureName,
} from "./parse-system";

describe("parseCpuTime", () => {
  it("parses mm:ss.cc, hh:mm:ss.cc and d-hh:mm:ss", () => {
    expect(parseCpuTime("18:34.81")).toBeCloseTo(18 * 60 + 34.81);
    expect(parseCpuTime("1:02:03.50")).toBeCloseTo(3723.5);
    expect(parseCpuTime("2-03:04:05")).toBeCloseTo(2 * 86400 + 3 * 3600 + 4 * 60 + 5);
  });
  it("returns 0 for garbage", () => {
    expect(parseCpuTime("x")).toBe(0);
  });
});

describe("parsePs", () => {
  const OUT = `  PID  PPID    RSS  %CPU      TIME COMMAND
    1     0   9536   0.9  42:10.00 /sbin/launchd
43231 43129 119808  12.5  25:27.69 /Applications/My App/Electron Helper (Renderer) --type=renderer --x=1
`;
  it("keeps the whole command, spaces included, and converts RSS to bytes", () => {
    const rows = parsePs(OUT);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({
      pid: 43231,
      ppid: 43129,
      rssBytes: 119808 * 1024,
      cpuPct: 12.5,
      cpuTimeS: 25 * 60 + 27.69,
      command: "/Applications/My App/Electron Helper (Renderer) --type=renderer --x=1",
    });
  });
});

describe("parsePsThreads", () => {
  it("counts the process row plus its continuation rows", () => {
    const m = parsePsThreads(
      [
        "USER   PID   TT   %CPU STAT PRI     STIME     UTIME COMMAND",
        "me     10   ??    0.0 S    31T   0:00.25   0:00.04 /bin/a",
        "              0.0 S    31T   0:00.00   0:00.00",
        "              0.0 S    31T   0:00.00   0:00.00",
        "me     11   ??    0.0 S    31T   0:00.25   0:00.04 /bin/b",
      ].join("\n"),
    );
    expect(m.get(10)).toBe(3);
    expect(m.get(11)).toBe(1);
  });
});

describe("parseVmStat", () => {
  const OUT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                   286163.
Pages occupied by compressor:                 552459.
Pages stored in compressor:                  1997918.
`;
  it("reports free and compressor bytes using the page size", () => {
    expect(parseVmStat(OUT)).toEqual({
      freeBytes: 286163 * 16384,
      compressedBytes: 552459 * 16384,
      storedInCompressorBytes: 1997918 * 16384,
    });
  });
});

describe("parseSwapUsage", () => {
  it("parses M and G units", () => {
    const r = parseSwapUsage(
      "vm.swapusage: total = 11264.00M  used = 9958.06M  free = 1305.94M  (encrypted)",
    );
    expect(r.totalBytes).toBe(11264 * 1024 ** 2);
    expect(r.usedBytes).toBeCloseTo(9958.06 * 1024 ** 2);
    expect(parseSwapUsage("total = 2.00G  used = 0.00M  free = 2.00G").totalBytes).toBe(
      2 * 1024 ** 3,
    );
  });
});

describe("parseLoadAvg / pressureName", () => {
  it("parses braces", () => {
    expect(parseLoadAvg("{ 13.85 13.65 10.51 }")).toEqual([13.85, 13.65, 10.51]);
  });
  it("names pressure levels", () => {
    expect(pressureName(1)).toBe("normal");
    expect(pressureName(2)).toBe("warn");
    expect(pressureName(4)).toBe("critical");
    expect(pressureName(9)).toBe("unknown");
  });
});
