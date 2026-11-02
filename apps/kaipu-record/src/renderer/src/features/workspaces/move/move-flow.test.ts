import { describe, expect, it } from "vitest";
import type { WorkspaceView } from "@shared/types/workspaces";
import {
  exportsToSuggest,
  moveCost,
  notMovableReason,
  orderForMove,
  resultMessage,
  type MovableItem,
} from "./move-flow";

const item = (over: Partial<MovableItem> & { assetId: string }): MovableItem => ({
  id: over.assetId,
  title: over.assetId,
  kind: "recording",
  derivedFromAssetId: null,
  ...over,
});

const rec = item({ assetId: "rec" });
const exp1 = item({ assetId: "exp1", derivedFromAssetId: "rec" });
const exp2 = item({ assetId: "exp2", derivedFromAssetId: "rec" });
const cloudExport = item({ assetId: "exp3", derivedFromAssetId: "rec", id: null });
const other = item({ assetId: "other" });

describe("exportsToSuggest", () => {
  it("counts the local exports of a selected recording", () => {
    expect(exportsToSuggest([rec], [rec, exp1, exp2, cloudExport, other])).toEqual([exp1, exp2]);
  });

  it("counts an export that is also selected only once (not at all as a suggestion)", () => {
    expect(exportsToSuggest([rec, exp1], [rec, exp1, exp2])).toEqual([exp2]);
  });

  it("suggests nothing for a recording without exports, or for an export moved alone", () => {
    expect(exportsToSuggest([other], [rec, exp1, other])).toEqual([]);
    expect(exportsToSuggest([exp1], [rec, exp1, exp2])).toEqual([]);
  });
});

describe("orderForMove", () => {
  it("moves each recording first, then its exports", () => {
    // The exports keep the order they have on screen.
    expect(orderForMove([rec, other], [exp1, exp2]).map((i) => i.assetId)).toEqual([
      "rec",
      "exp1",
      "exp2",
      "other",
    ]);
  });
});

describe("notMovableReason", () => {
  it("refuses a cloud-only item and an item whose record cannot be read", () => {
    expect(notMovableReason(cloudExport)).toBe("cloud");
    expect(notMovableReason(item({ assetId: "x", metadataIssue: "corrupt" }))).toBe("record");
    expect(notMovableReason(rec)).toBeNull();
  });

  it("refuses an item whose media a synced workspace's provider offloaded: download it first", () => {
    expect(notMovableReason({ ...rec, evicted: "media" })).toBe("evicted");
    // Only its poster is offloaded: the media is local, the move can copy it.
    expect(notMovableReason({ ...rec, evicted: "thumbnail" })).toBeNull();
  });
});

describe("moveCost", () => {
  const view = (over: Partial<WorkspaceView>): WorkspaceView => ({
    id: "w",
    name: "W",
    color: "rose",
    initials: "W",
    path: "/w",
    volume: null,
    state: "available",
    itemCount: null,
    device: "1",
    sync: null,
    ...over,
  });
  it("is instant on the same drive, copies on another, and is off when not connected", () => {
    const active = view({ id: "a" });
    expect(moveCost(view({ id: "b" }), active)).toBe("same-drive");
    expect(moveCost(view({ id: "b", device: "2" }), active)).toBe("other-drive");
    expect(moveCost(view({ id: "b", state: "unavailable", device: null }), active)).toBe(
      "not-connected",
    );
  });

  it("a synced side copies, even on the same drive (decision 15)", () => {
    const active = view({ id: "a" });
    expect(moveCost(view({ id: "b", sync: "google-drive" }), active)).toBe("synced");
    expect(moveCost(view({ id: "b" }), view({ id: "a", sync: "onedrive" }))).toBe("synced");
  });
});

describe("resultMessage", () => {
  const t = (key: string, values?: Record<string, string | number>): string =>
    `${key}${values ? JSON.stringify(values) : ""}`;
  const titles = new Map([
    ["a", "Demo"],
    ["b", "Export"],
  ]);
  const context = { titles, target: "Personal", source: "Work" };

  it("names what stayed and why", () => {
    const message = resultMessage(
      {
        targetId: "p",
        moved: [{ id: "a", newId: "a" }],
        failed: [{ id: "b", reason: "no-room" }],
        skipped: [],
      },
      context,
      t,
    );
    expect(message).toContain("resultPartial");
    expect(message).toContain('"moved":1');
    expect(message).toContain('"total":2');
    expect(message).toContain("Export");
    expect(message).toContain("reason_no-room");
  });

  it("a Stop before anything moved says nothing moved, not 'Moved 0 items'", () => {
    const message = resultMessage(
      { targetId: "p", moved: [], failed: [], skipped: ["a", "b"] },
      context,
      t,
    );
    expect(message).not.toContain("resultAll");
    expect(message).toContain("resultNone");
    expect(message).toContain('resultSkipped{"count":2}');
  });

  it("says how many were not started after a Stop", () => {
    const message = resultMessage(
      { targetId: "p", moved: [{ id: "a", newId: "a" }], failed: [], skipped: ["b"] },
      context,
      t,
    );
    expect(message).toContain("resultAll");
    expect(message).toContain('resultSkipped{"count":1}');
  });
});
