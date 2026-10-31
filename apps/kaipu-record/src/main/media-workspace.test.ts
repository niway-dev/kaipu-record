import { describe, expect, it } from "vitest";
import { isForeignWorkspaceUrl } from "./media-workspace";

describe("isForeignWorkspaceUrl", () => {
  it.each(["recording", "screenshot", "thumb"])(
    "refuses a %s URL stamped for another workspace",
    (kind) => {
      expect(isForeignWorkspaceUrl(new URL(`kaipu-media://${kind}/clip?w=ws-old`), "ws-new")).toBe(
        true,
      );
    },
  );

  it.each(["recording", "screenshot", "thumb"])(
    "serves a %s URL of the active workspace",
    (kind) => {
      expect(
        isForeignWorkspaceUrl(new URL(`kaipu-media://${kind}/clip?v=3&w=ws-new`), "ws-new"),
      ).toBe(false);
    },
  );

  it("does not refuse a URL without a workspace", () => {
    expect(isForeignWorkspaceUrl(new URL("kaipu-media://recording/clip"), "ws-new")).toBe(false);
  });
});
