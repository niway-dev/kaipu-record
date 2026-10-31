import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { onPageGone } from "./renderer-lifetime";

describe("onPageGone", () => {
  it("fires on a reload, a dead renderer and a destroyed webContents; not on in-page routes", () => {
    const contents = Object.assign(new EventEmitter(), { id: 1 });
    const gone = vi.fn();
    onPageGone(contents, gone);

    contents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
    contents.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false });
    expect(gone).not.toHaveBeenCalled();

    contents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    contents.emit("render-process-gone");
    contents.emit("destroyed");
    contents.emit("destroyed");
    expect(gone).toHaveBeenCalledTimes(3);
  });
});
