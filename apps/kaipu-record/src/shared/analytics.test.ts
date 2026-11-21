import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRODUCT,
  DEFAULT_SURFACE,
  FLAG_DEFAULTS,
  FLAG_NAMES,
  RELEASE_FLAGS,
  EDITOR_OPENED_EVENT,
  EDITOR_SPEED_CHANGED_EVENT,
  SCREENSHOT_CAPTURED_EVENT,
  buildEditorOpenedProperties,
  buildEditorSpeedChangedProperties,
  buildRecordingStartedProperties,
  buildScreenshotCapturedProperties,
  scrubEventProperties,
  scrubPersonalPaths,
  scrubPersonalPathsDeep,
  serializeError,
} from "./analytics";

describe("flag model", () => {
  it("defaults every known flag to a safe value", () => {
    for (const name of FLAG_NAMES) {
      expect(typeof FLAG_DEFAULTS[name]).toBe("boolean");
    }
    expect(FLAG_DEFAULTS["native-cursor-capture"]).toBe(true);
    expect(FLAG_DEFAULTS["image-canvas"]).toBe(false);
    expect(FLAG_DEFAULTS["image-inspect"]).toBe(false);
    expect(FLAG_DEFAULTS["image-text"]).toBe(false);
    expect(FLAG_DEFAULTS["timeline-levels"]).toBe(false);
    expect(FLAG_DEFAULTS["zoom-filmstrip"]).toBe(false);
    expect(FLAG_DEFAULTS["transcription"]).toBe(false);
  });

  it("uses stable identity defaults", () => {
    expect(DEFAULT_PRODUCT).toBe("kaipu-recorder");
    expect(DEFAULT_SURFACE).toBe("desktop");
  });
});

describe("serializeError", () => {
  it("extracts name/message/stack from an Error", () => {
    const payload = serializeError(new TypeError("boom"));
    expect(payload.name).toBe("TypeError");
    expect(payload.message).toBe("boom");
    expect(payload.stack).toContain("boom");
  });

  it("survives non-Error throws", () => {
    expect(serializeError("nope")).toEqual({ name: "Error", message: "nope", stack: null });
    expect(serializeError(undefined).message).toBe("Unknown error");
  });
});

describe("screenshot_captured", () => {
  it("keeps a stable event name", () => {
    expect(SCREENSHOT_CAPTURED_EVENT).toBe("screenshot_captured");
  });

  it("carries exactly mode, platform, displays and outcome, nothing else", () => {
    const leaky = {
      mode: "frame",
      platform: "darwin",
      displays: 2,
      outcome: "captured",
      rect: { x: 1, y: 2, width: 3, height: 4 },
      png: new ArrayBuffer(8),
    } as Parameters<typeof buildScreenshotCapturedProperties>[0];
    expect(buildScreenshotCapturedProperties(leaky)).toEqual({
      mode: "frame",
      platform: "darwin",
      displays: 2,
      outcome: "captured",
    });
  });

  it("carries after when set and drops anything beyond the allowed fields", () => {
    const input = {
      mode: "window",
      platform: "darwin",
      displays: 1,
      outcome: "captured",
      after: "quiet",
      title: "secret",
    } as Parameters<typeof buildScreenshotCapturedProperties>[0];
    expect(buildScreenshotCapturedProperties(input)).toEqual({
      mode: "window",
      platform: "darwin",
      displays: 1,
      outcome: "captured",
      after: "quiet",
    });
  });
});

describe("buildRecordingStartedProperties", () => {
  it("names the mode from the source and the area, and nothing else", () => {
    const base = { platform: "darwin", displays: 2 };
    expect(
      buildRecordingStartedProperties({ ...base, sourceId: "screen:1:0", area: false }),
    ).toEqual({ mode: "screen", platform: "darwin", displays: 2 });
    expect(
      buildRecordingStartedProperties({ ...base, sourceId: "screen:1:0", area: true }),
    ).toEqual({ mode: "area", platform: "darwin", displays: 2 });
    expect(
      buildRecordingStartedProperties({ ...base, sourceId: "window:42:0", area: false }),
    ).toEqual({ mode: "window", platform: "darwin", displays: 2 });
    const leaky = {
      ...base,
      sourceId: "screen:1:0",
      area: true,
      title: "Secret plan",
    } as Parameters<typeof buildRecordingStartedProperties>[0];
    expect(buildRecordingStartedProperties(leaky)).not.toHaveProperty("title");
    expect(buildRecordingStartedProperties(leaky)).not.toHaveProperty("sourceId");
  });

  it("adds the size bucket and the ratio for an area, never the dimensions", () => {
    const base = { platform: "darwin", displays: 1, sourceId: "screen:1:0" };
    expect(
      buildRecordingStartedProperties({
        ...base,
        area: true,
        areaSize: { width: 2560, height: 1440 },
        ratio: "16:9",
      }),
    ).toEqual({ mode: "area", platform: "darwin", displays: 1, size: "1440p+", ratio: "16:9" });
    // No locked ratio: inferred from the size, like the capture metadata.
    expect(
      buildRecordingStartedProperties({
        ...base,
        area: true,
        areaSize: { width: 720, height: 1280 },
      }),
    ).toMatchObject({ size: "720p", ratio: "9:16" });
    expect(
      buildRecordingStartedProperties({
        ...base,
        area: true,
        areaSize: { width: 900, height: 500 },
      }),
    ).toMatchObject({ size: "<720p", ratio: "free" });
    // A whole screen carries neither.
    expect(
      buildRecordingStartedProperties({ ...base, area: false, areaSize: { width: 1, height: 1 } }),
    ).toEqual({ mode: "screen", platform: "darwin", displays: 1 });
  });
});

describe("editor_speed_changed", () => {
  it("keeps a stable event name", () => {
    expect(EDITOR_SPEED_CHANGED_EVENT).toBe("editor_speed_changed");
  });

  it("carries exactly the speed, nothing else", () => {
    expect(buildEditorSpeedChangedProperties({ speed: 1.5 })).toEqual({ speed: 1.5 });
    // A caller cannot smuggle an extra field through (a title, a time, a path).
    const sneaky = { speed: 2, title: "Q3 board call", timelineTime: 41 } as never;
    expect(Object.keys(buildEditorSpeedChangedProperties(sneaky))).toEqual(["speed"]);
  });
});

describe("editor_opened", () => {
  it("keeps a stable event name", () => {
    expect(EDITOR_OPENED_EVENT).toBe("editor_opened");
  });

  it("carries exactly which editor opened, nothing else", () => {
    expect(buildEditorOpenedProperties({ editor: "video" })).toEqual({ editor: "video" });
    expect(buildEditorOpenedProperties({ editor: "image" })).toEqual({ editor: "image" });
    // A caller cannot smuggle an extra field through (a recording id, a title, a path).
    const sneaky = { editor: "image", recordingId: "r-1", title: "Q3 board call" } as never;
    expect(Object.keys(buildEditorOpenedProperties(sneaky))).toEqual(["editor"]);
  });
});

describe("scrubPersonalPaths", () => {
  const REDACTED = "<user-path>";

  it("removes a macOS home path, file name included", () => {
    expect(
      scrubPersonalPaths("ENOENT: open '/Users/ana/Movies/Kaipu Record/Q3 board call.mp4'"),
    ).toBe(`ENOENT: open '${REDACTED}'`);
  });

  it("removes a path inside a stack frame and keeps the frame's shape", () => {
    expect(scrubPersonalPaths("    at load (/Users/ana/dev/kaipu/src/a.ts:12:3)")).toBe(
      `    at load (${REDACTED})`,
    );
  });

  it("removes Windows and Linux home paths and file URLs", () => {
    expect(scrubPersonalPaths("open C:\\Users\\Ana Perez\\Videos\\clip.mp4 failed")).not.toContain(
      "Ana",
    );
    expect(scrubPersonalPaths("c:/Users/ana/Videos/clip.mp4")).toBe(REDACTED);
    expect(scrubPersonalPaths("/home/ana/clips/a.mp4")).toBe(REDACTED);
    expect(scrubPersonalPaths("file:///Users/ana/Movies/a.mp4")).toBe(`file://${REDACTED}`);
  });

  it("takes a file name that contains brackets or an apostrophe, whole", () => {
    expect(scrubPersonalPaths("open '/Users/ana/Movies/Foo (draft) Q3 board.mp4' failed")).toBe(
      `open '${REDACTED}' failed`,
    );
    expect(scrubPersonalPaths("ENOENT '/Users/ana/Screen Recording (2) final.mov'")).toBe(
      `ENOENT '${REDACTED}'`,
    );
    expect(scrubPersonalPaths("'/Users/ana/Ana's Videos/clip.mp4' is gone")).toBe(
      `'${REDACTED}' is gone`,
    );
    const unquoted = scrubPersonalPaths("cannot read /Users/ana/Ana's Videos/clip.mp4");
    expect(unquoted).toBe(`cannot read ${REDACTED}`);
    // A name can hold its own quote followed by a space: the path runs to the last closing quote.
    expect(scrubPersonalPaths("open '/Users/ana/Clients' Archive/secret.mp4' failed")).toBe(
      `open '${REDACTED}' failed`,
    );
    // Two quoted paths on one line: both are gone, and so may be the words between them.
    expect(scrubPersonalPaths(`"/Users/ana/a.mp4" and "/Users/bob/b (1).mp4"`)).not.toMatch(
      /ana|bob|b \(1\)/,
    );
  });

  it("removes a recordings folder on a volume or another drive", () => {
    expect(scrubPersonalPaths("open '/Volumes/Work/Kaipu/Q3 call.mp4'")).toBe(`open '${REDACTED}'`);
    expect(scrubPersonalPaths("open D:\\Recordings\\Q3 call.mp4")).toBe(`open ${REDACTED}`);
    // A network share names a server, its folders and the file.
    expect(scrubPersonalPaths("open '\\\\NAS\\Ana\\Q3 board call.mp4' failed")).toBe(
      `open '${REDACTED}' failed`,
    );
    // App and system folders are not personal.
    const system = "at x (C:\\Program Files\\Kaipu Record\\resources\\app.asar\\main.js:1:1)";
    expect(scrubPersonalPaths(system)).toBe(system);
  });

  it("keeps app paths and URLs that merely contain /Users or /home", () => {
    const appPath =
      "at x (/Applications/Kaipu Record.app/Contents/Resources/app.asar/out/main.js:1:1)";
    expect(scrubPersonalPaths(appPath)).toBe(appPath);
    expect(scrubPersonalPaths("GET https://kaipu.app/home/Users/ana")).toBe(
      "GET https://kaipu.app/home/Users/ana",
    );
  });

  it("leaves text without a personal path untouched", () => {
    expect(scrubPersonalPaths("Cannot read properties of undefined")).toBe(
      "Cannot read properties of undefined",
    );
  });
});

describe("scrubPersonalPathsDeep", () => {
  it("scrubs every string in nested objects and arrays without mutating the input", () => {
    const input = {
      $exception_list: [
        {
          value: "open '/Users/ana/Movies/a.mp4' failed",
          stacktrace: { frames: [{ filename: "/Users/ana/dev/a.ts", lineno: 4 }] },
        },
      ],
      count: 3,
      flag: true,
      nothing: null,
    };
    const copy = JSON.parse(JSON.stringify(input));
    const out = scrubPersonalPathsDeep(input) as typeof input;
    expect(JSON.stringify(out)).not.toContain("ana");
    expect(out.$exception_list[0].stacktrace.frames[0].lineno).toBe(4);
    expect(out.count).toBe(3);
    expect(input).toEqual(copy);
  });

  it("keeps an object that is referenced twice, and cuts only a real cycle", () => {
    const shared = { path: "/Users/ana/a.mp4", n: 1 };
    const out = scrubPersonalPathsDeep({ first: shared, second: shared, list: [shared] }) as {
      first: { path: string; n: number };
      second: { path: string; n: number };
      list: { path: string; n: number }[];
    };
    expect(out.first).toEqual({ path: "<user-path>", n: 1 });
    expect(out.second).toEqual({ path: "<user-path>", n: 1 });
    expect(out.list[0]).toEqual({ path: "<user-path>", n: 1 });
  });

  it("survives a cyclic object", () => {
    const loop: Record<string, unknown> = { path: "/Users/ana/a.mp4" };
    loop.self = loop;
    expect(() => scrubPersonalPathsDeep(loop)).not.toThrow();
  });
});

describe("scrubEventProperties", () => {
  it("drops the item ids, which can spell a recording's name, and scrubs the rest", () => {
    const input = {
      id: "Q3 board call",
      assetId: "Q3 board call",
      localId: "Q3 board call",
      phase: "rename",
      message: "open '/Users/ana/a.mp4' failed",
    };
    const out = scrubEventProperties(input);
    expect(out).toEqual({ phase: "rename", message: `open '<user-path>' failed` });
    // The input is left as it was.
    expect(input.id).toBe("Q3 board call");
  });
});

describe("RELEASE_FLAGS", () => {
  it("is exactly the flags whose code default is false", () => {
    expect([...RELEASE_FLAGS].sort()).toEqual(
      [...FLAG_NAMES].filter((name) => FLAG_DEFAULTS[name] === false).sort(),
    );
  });

  it("pins today's list, and leaves a shipped (default true) flag out", () => {
    expect([...RELEASE_FLAGS].sort()).toEqual(
      [
        "capture-while-recording",
        "image-canvas",
        "image-inspect",
        "image-text",
        "timeline-levels",
        "transcription",
        "zoom-filmstrip",
      ].sort(),
    );
    expect(RELEASE_FLAGS).not.toContain("native-cursor-capture");
  });
});
