import { describe, expect, it } from "vitest";
import { DEFAULT_ACCELERATORS, formatAccelerator } from "@kaipu/domain/constants";
import en from "../../messages/en.json";
import es from "../../messages/es.json";

/**
 * One landing string is a keyboard shortcut rather than prose: chapter 01's
 * second pill. Pills come from the catalogues, so this one cannot read the
 * constant at render time — this guard keeps the literal honest instead, the
 * same shape `settings.service.test.ts` uses to pin DEFAULT_LOCALE.
 *
 * It exists because every shortcut the landing printed was wrong: the page
 * advertised ⌘⇧P for a binding that is ⌘⌃C, and nothing was comparing them.
 */
describe("the landing's shortcut copy", () => {
  const expected = formatAccelerator(DEFAULT_ACCELERATORS.mac.startRecording);

  it("matches the real start-recording default", () => {
    expect(expected).toBe("⌘⌃C");
    expect(en.landing.homeChapter1Pill2).toBe(expected);
    expect(es.landing.homeChapter1Pill2).toBe(expected);
  });

  it("says the same in both languages — a shortcut is not translatable", () => {
    expect(en.landing.homeChapter1Pill2).toBe(es.landing.homeChapter1Pill2);
  });
});
