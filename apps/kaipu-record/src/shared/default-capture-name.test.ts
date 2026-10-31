import { describe, expect, it } from "vitest";
import { defaultCaptureName } from "./default-capture-name";

describe("defaultCaptureName", () => {
  // Built from local parts, so the expectation holds in any time zone.
  const at = new Date(2026, 9, 29, 13, 51, 0);

  it("names each kind with the local date and time", () => {
    expect(defaultCaptureName("recording", at)).toBe("Kaipu Recording 2026-10-29 at 13.51.00");
    expect(defaultCaptureName("screenshot", at)).toBe("Kaipu Screenshot 2026-10-29 at 13.51.00");
    expect(defaultCaptureName("gif", at)).toBe("Kaipu GIF 2026-10-29 at 13.51.00");
  });

  it("zero-pads every field and uses a 24-hour clock", () => {
    expect(defaultCaptureName("recording", new Date(2026, 0, 2, 3, 4, 5))).toBe(
      "Kaipu Recording 2026-01-02 at 03.04.05",
    );
    expect(defaultCaptureName("recording", new Date(2026, 11, 31, 23, 59, 59))).toBe(
      "Kaipu Recording 2026-12-31 at 23.59.59",
    );
  });

  it("never contains a character Windows forbids in a file name", () => {
    expect(defaultCaptureName("screenshot", at)).not.toMatch(/[<>:"/\\|?*]/);
  });
});
