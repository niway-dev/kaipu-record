import { describe, expect, it } from "vitest";
import { mediaUrl, parseMediaUrl } from "./media-url";

describe("mediaUrl / parseMediaUrl", () => {
  it.each([
    "Demo #1",
    "50% done",
    "What? Why",
    "a%2Fb",
    "%E0%A4%A",
    "Sprint demo part 1 2",
    "名前",
  ])("round-trips the id %j", (id) => {
    const url = mediaUrl("screenshot", id, 1234);
    expect(parseMediaUrl(url)).toEqual({ kind: "screenshot", id });
    // The version token stays a query, never part of the id.
    expect(new URL(url).searchParams.get("v")).toBe("1234");
  });

  it("builds a URL without a version", () => {
    expect(mediaUrl("recording", "Demo #1")).toBe("kaipu-media://recording/Demo%20%231");
  });

  it("refuses a malformed escape instead of throwing", () => {
    expect(parseMediaUrl("kaipu-media://recording/%E0%A4%A")).toBeNull();
    expect(parseMediaUrl("kaipu-media://recording/100%")).toBeNull();
  });

  it("refuses ids that would leave the vault, encoded or not", () => {
    expect(parseMediaUrl("kaipu-media://recording/..%2F..%2Fetc")).toBeNull();
    expect(parseMediaUrl("kaipu-media://recording/a%2Fb")).toBeNull();
    expect(parseMediaUrl("kaipu-media://recording/a%5Cb")).toBeNull();
    expect(parseMediaUrl("kaipu-media://recording/")).toBeNull();
    expect(parseMediaUrl("https://example.com/x")).toBeNull();
  });
});
