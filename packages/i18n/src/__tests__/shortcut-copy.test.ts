import { describe, expect, it } from "vitest";
import { DEFAULT_ACCELERATORS, formatAccelerator } from "@kaipu/domain/constants";
import en from "../../messages/en.json";
import es from "../../messages/es.json";

/**
 * One landing string is a keyboard shortcut rather than prose: the Capture
 * chapter's second pill. Pills come from the catalogues, so this one cannot read the
 * constant at render time — this guard keeps the literal honest instead, the
 * same shape `settings.service.test.ts` uses to pin DEFAULT_LOCALE.
 *
 * It exists because every shortcut the landing printed was wrong: the page
 * advertised ⌘⇧P for a binding that was ⌘⌃C, and nothing was comparing them.
 */
describe("the landing's shortcut copy", () => {
  const screenshot = formatAccelerator(DEFAULT_ACCELERATORS.mac.captureScreenshot);
  const recording = formatAccelerator(DEFAULT_ACCELERATORS.mac.startRecording);
  const expected = `${screenshot} · ${recording}`;

  it("matches the real screenshot and start-recording defaults", () => {
    expect(expected).toBe("⌘⇧1 · ⌘⇧2");
    expect(en.landing.homeChapter2Pill2).toBe(expected);
    expect(es.landing.homeChapter2Pill2).toBe(expected);
  });

  it("says the same in both languages — a shortcut is not translatable", () => {
    expect(en.landing.homeChapter2Pill2).toBe(es.landing.homeChapter2Pill2);
  });
});
