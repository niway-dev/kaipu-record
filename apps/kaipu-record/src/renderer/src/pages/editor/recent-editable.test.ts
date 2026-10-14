import { describe, expect, it } from "vitest";
import {
  formatAgo,
  lastActivity,
  matchesFilter,
  paginate,
  recentItems,
  wasEdited,
} from "./recent-editable";

type Kind = "recording" | "screenshot";
const item = (
  name: string,
  kind: Kind,
  createdAt: number,
  editSavedAt: number | null = null,
  derivedFromAssetId: string | null = null,
) => ({ name, kind, createdAt, editSavedAt, derivedFromAssetId });

describe("lastActivity / wasEdited", () => {
  it("is the last edit when there is one, the creation otherwise", () => {
    expect(lastActivity(item("a", "recording", 100, 500))).toBe(500);
    expect(lastActivity(item("b", "recording", 100))).toBe(100);
    expect(wasEdited(item("a", "recording", 100, 500))).toBe(true);
    expect(wasEdited(item("b", "recording", 100))).toBe(false);
  });
});

describe("recentItems", () => {
  const items = [
    item("recorded-today", "recording", 900),
    item("edited-just-now", "recording", 100, 1000),
    item("shot", "screenshot", 800),
    item("export", "recording", 700, null, "edited-just-now"),
    item("never-touched", "recording", 50),
  ];

  it("puts the last thing worked on first, not the newest file", () => {
    expect(recentItems(items, "all").map((i) => i.name)).toEqual([
      "edited-just-now",
      "recorded-today",
      "shot",
      "export",
      "never-touched",
    ]);
  });

  it("filters videos (exports included), images, and recordings never edited", () => {
    expect(recentItems(items, "videos").map((i) => i.name)).toEqual([
      "edited-just-now",
      "recorded-today",
      "export",
      "never-touched",
    ]);
    expect(recentItems(items, "images").map((i) => i.name)).toEqual(["shot"]);
    // An export is the result of an edit and a screenshot has no session: neither
    // is "waiting for a first edit".
    expect(recentItems(items, "unedited").map((i) => i.name)).toEqual([
      "recorded-today",
      "never-touched",
    ]);
  });

  it("does not count a screenshot as not edited", () => {
    expect(matchesFilter(item("s", "screenshot", 1), "unedited")).toBe(false);
  });
});

describe("paginate", () => {
  const list = Array.from({ length: 19 }, (_, i) => i);

  it("cuts pages and reports the range shown", () => {
    expect(paginate(list, 0, 8)).toMatchObject({
      rows: [0, 1, 2, 3, 4, 5, 6, 7],
      page: 0,
      pageCount: 3,
      from: 1,
      to: 8,
      total: 19,
    });
    expect(paginate(list, 2, 8)).toMatchObject({ rows: [16, 17, 18], page: 2, from: 17, to: 19 });
  });

  it("clamps a page that no longer exists to the last one", () => {
    expect(paginate(list, 9, 8).page).toBe(2);
    expect(paginate(list, -1, 8).page).toBe(0);
  });

  it("has one empty page for an empty list", () => {
    expect(paginate([], 0, 8)).toMatchObject({
      rows: [],
      page: 0,
      pageCount: 1,
      from: 0,
      to: 0,
      total: 0,
    });
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
