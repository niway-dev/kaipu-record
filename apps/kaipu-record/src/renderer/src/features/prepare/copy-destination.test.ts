import { describe, expect, it } from "vitest";
import { copyDestinationOf, copyPresetOf } from "./copy-destination";

const recording = { kind: "recording" as const };

describe("copyDestinationOf", () => {
  it("reads the destination of a whole-recording copy, encode revision and all", () => {
    expect(
      copyDestinationOf({
        ...recording,
        export: { preset: "youtube-1440", fingerprint: "whole#2560x1440-v1" },
      }),
    ).toBe("youtube");
    expect(
      copyDestinationOf({ ...recording, export: { preset: "light", fingerprint: "whole" } }),
    ).toBe("github");
  });

  it("a copy of a take with a webcam keeps its destination (NIW2-576)", () => {
    expect(
      copyDestinationOf({
        ...recording,
        export: { preset: "youtube-1440", fingerprint: "whole:1a2b3c#2560x1440-v1" },
      }),
    ).toBe("youtube");
  });

  it("an editor export, an original and an older file have none", () => {
    expect(
      copyPresetOf({ ...recording, export: { preset: "balanced", fingerprint: "edit:abc#q30" } }),
    ).toBeNull();
    expect(copyDestinationOf({ ...recording, export: null })).toBeNull();
    expect(
      copyDestinationOf({ ...recording, export: { preset: "light", fingerprint: null } }),
    ).toBeNull();
    expect(
      copyDestinationOf({ kind: "gif", export: { preset: "light", fingerprint: "whole" } }),
    ).toBeNull();
  });

  it("reads the destination the sidecar stored, so an Email copy stays Email (Balanced is chat's too)", () => {
    expect(
      copyDestinationOf({
        ...recording,
        export: { preset: "balanced", fingerprint: "whole#q30", destination: "email" },
      }),
    ).toBe("email");
    // Older copies without it fall back to the preset's destination.
    expect(
      copyDestinationOf({
        ...recording,
        export: { preset: "balanced", fingerprint: "whole#q30", destination: null },
      }),
    ).toBe("chat");
  });

  it("prefers the export job's destination when the runner still has it", () => {
    expect(copyDestinationOf({ ...recording, export: null }, "chat")).toBe("chat");
  });
});
