import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activeFlagOverrides,
  changeFlagOverride,
  onActiveFlagOverridesChanged,
  setActiveFlagOverrides,
} from "./flag-overrides";

afterEach(() => setActiveFlagOverrides({}));

describe("changeFlagOverride", () => {
  it("pins a flag, keeps the others and tells the listeners", () => {
    setActiveFlagOverrides({ "image-canvas": true });
    const listener = vi.fn();
    const off = onActiveFlagOverridesChanged(listener);

    const next = changeFlagOverride("image-text", true, { isPackaged: false });

    expect(next).toEqual({ "image-canvas": true, "image-text": true });
    expect(activeFlagOverrides()).toEqual(next);
    expect(listener).toHaveBeenCalledExactlyOnceWith(next);
    off();
  });

  it("clears a flag with null", () => {
    setActiveFlagOverrides({ "image-canvas": true });
    expect(changeFlagOverride("image-canvas", null, { isPackaged: false })).toEqual({});
  });

  it("stays silent when nothing changes", () => {
    setActiveFlagOverrides({ "image-canvas": true });
    const listener = vi.fn();
    const off = onActiveFlagOverridesChanged(listener);
    changeFlagOverride("image-canvas", true, { isPackaged: false });
    changeFlagOverride("not-a-flag", true, { isPackaged: false });
    expect(listener).not.toHaveBeenCalled();
    off();
  });

  it("never changes anything in a packaged build", () => {
    const listener = vi.fn();
    const off = onActiveFlagOverridesChanged(listener);
    expect(changeFlagOverride("image-canvas", true, { isPackaged: true })).toEqual({});
    expect(activeFlagOverrides()).toEqual({});
    expect(listener).not.toHaveBeenCalled();
    off();
  });
});
