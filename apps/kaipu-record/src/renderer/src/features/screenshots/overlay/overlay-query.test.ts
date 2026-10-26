import { describe, expect, it } from "vitest";
import { parseOverlayQuery, workAreaInWindow } from "./overlay-query";

const QUERY =
  "?window=capture-overlay&display=42&ui=frame&index=2&count=3" +
  "&bounds=-1440,0,1440,900&work=-1440,25,1440,875&ids=7,42,9";

describe("parseOverlayQuery", () => {
  it("reads the query main builds, negative origins included", () => {
    expect(parseOverlayQuery(QUERY)).toEqual({
      displayId: 42,
      ui: "frame",
      index: 2,
      count: 3,
      bounds: { x: -1440, y: 0, width: 1440, height: 900 },
      work: { x: -1440, y: 25, width: 1440, height: 875 },
      ids: [7, 42, 9],
      frame: null,
      internal: false,
      intent: "capture",
    });
  });

  it("reads the record intent, and treats anything else as a screenshot", () => {
    expect(parseOverlayQuery(`${QUERY}&intent=record`)?.intent).toBe("record");
    expect(parseOverlayQuery(`${QUERY}&intent=film`)?.intent).toBe("capture");
  });

  it("marks the built-in display", () => {
    expect(parseOverlayQuery(`${QUERY}&internal=1`)?.internal).toBe(true);
    expect(parseOverlayQuery(`${QUERY}&internal=0`)?.internal).toBe(false);
  });

  it("reads the frame display, and falls back to null when it is malformed", () => {
    expect(parseOverlayQuery(`${QUERY}&frame=9`)?.frame).toBe(9);
    expect(parseOverlayQuery(`${QUERY}&frame=x`)?.frame).toBeNull();
    expect(parseOverlayQuery(`${QUERY}&frame=`)?.frame).toBeNull();
  });

  it("rejects a missing or malformed part", () => {
    expect(parseOverlayQuery(QUERY.replace("ui=frame", "ui=area"))).toBeNull();
    expect(parseOverlayQuery(QUERY.replace("&display=42", ""))).toBeNull();
    expect(parseOverlayQuery(QUERY.replace("bounds=-1440,0,1440,900", "bounds=1,2,3"))).toBeNull();
    expect(parseOverlayQuery(QUERY.replace("work=-1440,25,1440,875", "work=0,0,0,10"))).toBeNull();
    expect(parseOverlayQuery(QUERY.replace("index=2", "index=4"))).toBeNull();
    expect(parseOverlayQuery(QUERY.replace("&ids=7,42,9", ""))).toBeNull();
    // The id list must have `count` entries and name this display at its index.
    expect(parseOverlayQuery(QUERY.replace("ids=7,42,9", "ids=7,42"))).toBeNull();
    expect(parseOverlayQuery(QUERY.replace("ids=7,42,9", "ids=42,7,9"))).toBeNull();
    expect(parseOverlayQuery(QUERY.replace("ids=7,42,9", "ids=7,42,x"))).toBeNull();
  });
});

describe("workAreaInWindow", () => {
  it("is the work area relative to the display's origin (the window's)", () => {
    const query = parseOverlayQuery(QUERY)!;
    expect(workAreaInWindow(query)).toEqual({ x: 0, y: 25, width: 1440, height: 875 });
  });
});
