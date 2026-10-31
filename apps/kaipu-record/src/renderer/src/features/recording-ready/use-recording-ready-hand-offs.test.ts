import { describe, expect, it } from "vitest";
import { pathForHandOff } from "./use-recording-ready-hand-offs";

describe("pathForHandOff", () => {
  it("a chip opens Export on its destination, More places on none", () => {
    expect(pathForHandOff({ target: "prepare", assetId: "a 1", destination: "github" })).toBe(
      "/export/a%201?to=github",
    );
    expect(pathForHandOff({ target: "prepare", assetId: "a1", destination: null })).toBe(
      "/export/a1",
    );
  });

  it("Edit first opens the video editor, Open the recording's page", () => {
    expect(pathForHandOff({ target: "editor", assetId: "a1" })).toBe("/editor/video/a1");
    expect(pathForHandOff({ target: "detail", assetId: "a1" })).toBe("/library/a1");
  });
});
