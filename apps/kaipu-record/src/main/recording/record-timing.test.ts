import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginRecordTiming,
  endRecordTiming,
  markRecordTiming,
  receiveRecordTiming,
} from "./record-timing";

describe("record timing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});
    endRecordTiming("reset");
    vi.restoreAllMocks();
  });

  it("stays quiet outside a timeline", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    markRecordTiming("stray");
    receiveRecordTiming("stray from the renderer", "mark");
    expect(info).not.toHaveBeenCalled();
  });

  it("prints one prefixed line per mark until the timeline ends", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    beginRecordTiming("start clicked");
    receiveRecordTiming("beginEngine", "mark");
    receiveRecordTiming("status recording", "end");
    markRecordTiming("after the end");
    expect(info.mock.calls.map(([line]) => String(line).replace(/\+\d+ms/, "+Nms"))).toEqual([
      "[record-timing] +Nms start clicked",
      "[record-timing] +Nms renderer: beginEngine",
      "[record-timing] +Nms renderer: status recording",
    ]);
  });

  it("lets the renderer restart the clock and ignores malformed labels", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    receiveRecordTiming(42, "begin");
    receiveRecordTiming("stop requested", "begin");
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]?.[0]).toBe("[record-timing] +0ms renderer: stop requested");
  });
});
