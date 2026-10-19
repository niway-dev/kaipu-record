import { describe, expect, it } from "vitest";
import {
  canOpenInEditor,
  editorPathFor,
  imageSourceFor,
  videoSourceFor,
  type EditableItem,
} from "./open-in-editor";

const recording: EditableItem = {
  id: "local-1",
  assetId: "asset-1",
  kind: "recording",
  title: "Demo",
  durationSeconds: 30,
  thumbnailUrl: null,
};
const screenshot: EditableItem = {
  id: "local-2",
  assetId: "asset-2",
  kind: "screenshot",
  title: "Shot",
  durationSeconds: 0,
  thumbnailUrl: "kaipu-media://thumb/local-2.png?v=42",
};

describe("open-in-editor", () => {
  it("picks the route by kind", () => {
    expect(editorPathFor(recording)).toBe("/editor/video/asset-1");
    expect(editorPathFor(screenshot)).toBe("/editor/image/asset-2");
  });

  it("encodes the asset id into the path", () => {
    expect(editorPathFor({ assetId: "a b", kind: "recording" })).toBe("/editor/video/a%20b");
  });

  it("needs a local copy, and a duration for a video", () => {
    expect(canOpenInEditor(recording)).toBe(true);
    expect(canOpenInEditor(screenshot)).toBe(true);
    expect(canOpenInEditor({ ...recording, id: null })).toBe(false);
    expect(canOpenInEditor({ ...screenshot, id: null })).toBe(false);
    expect(canOpenInEditor({ ...recording, durationSeconds: 0 })).toBe(false);
  });

  it("builds the video editor's input from a recording", () => {
    expect(videoSourceFor(recording)).toEqual({
      id: "local-1",
      assetId: "asset-1",
      title: "Demo",
      durationSeconds: 30,
    });
    expect(videoSourceFor(screenshot)).toBeNull();
    expect(videoSourceFor({ ...recording, durationSeconds: 0 })).toBeNull();
  });

  it("builds a local image source carrying the thumbnail's version token", () => {
    expect(imageSourceFor(screenshot)).toEqual({
      kind: "local",
      id: "local-2",
      title: "Shot",
      version: 42,
    });
    expect(imageSourceFor({ ...screenshot, thumbnailUrl: null })).toMatchObject({
      version: undefined,
    });
    expect(imageSourceFor(recording)).toBeNull();
  });
});
