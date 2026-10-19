import { describe, expect, it } from "vitest";
import { activityOf, continueList, defaultTab, formatAgo } from "./editor-continue";

type Kind = "recording" | "screenshot";
const item = (
  name: string,
  kind: Kind,
  s: { edit?: number; opened?: number; saved?: number } = {},
) => ({
  name,
  kind,
  editSavedAt: s.edit ?? null,
  editorOpenedAt: s.opened ?? null,
  editorSavedAt: s.saved ?? null,
});

describe("activityOf", () => {
  it("is null for an item never opened in an editor", () => {
    expect(activityOf(item("captured", "screenshot"))).toBeNull();
    expect(activityOf(item("recorded", "recording"))).toBeNull();
  });

  it("calls a video's last session save Edited, and a later open Opened", () => {
    expect(activityOf(item("v", "recording", { edit: 50, opened: 40 }))).toEqual({
      at: 50,
      label: "edited",
    });
    expect(activityOf(item("v", "recording", { edit: 50, opened: 90 }))).toEqual({
      at: 90,
      label: "opened",
    });
  });

  it("calls an image's manual save Saved, never Edited (a flat PNG has no session)", () => {
    expect(activityOf(item("i", "screenshot", { saved: 70, opened: 20 }))).toEqual({
      at: 70,
      label: "saved",
    });
    // A screenshot never carries an edit session; if it somehow did, it is ignored.
    expect(activityOf(item("i", "screenshot", { edit: 99 }))).toBeNull();
  });
});

describe("continueList / defaultTab", () => {
  const items = [
    item("old-shot", "screenshot", { saved: 10 }),
    item("captured", "screenshot"),
    item("new-shot", "screenshot", { opened: 30 }),
    item("video", "recording", { edit: 20 }),
  ];

  it("keeps one tab's worked-on items, most recent first", () => {
    expect(continueList(items, "images").map((e) => e.item.name)).toEqual(["new-shot", "old-shot"]);
    expect(continueList(items, "videos").map((e) => e.item.name)).toEqual(["video"]);
  });

  it("opens on the tab with the most recent activity, Images when there is none", () => {
    expect(defaultTab(items)).toBe("images");
    expect(defaultTab([...items, item("fresh", "recording", { opened: 99 })])).toBe("videos");
    expect(defaultTab([item("captured", "screenshot")])).toBe("images");
  });
});

describe("formatAgo", () => {
  const now = Date.UTC(2026, 9, 14, 12);
  it("speaks in the largest whole unit, in the app's locale", () => {
    expect(formatAgo(now - 3 * 3_600_000, now, "en")).toBe("3 hours ago");
    expect(formatAgo(now - 86_400_000, now, "en")).toBe("yesterday");
    expect(formatAgo(now - 20_000, now, "en")).toBe("this minute");
    expect(formatAgo(now - 3 * 3_600_000, now, "es")).toBe("hace 3 horas");
  });
});
