import type { MoveItemsResult, MoveRefusal, WorkspaceView } from "@shared/types/workspaces";

/** What the move needs to know about an item: a Library video or a listed recording fits. */
export interface MovableItem {
  /** Null for a cloud-only item: there is no local file to move. */
  id: string | null;
  assetId: string;
  title: string;
  kind: "recording" | "screenshot" | "gif";
  derivedFromAssetId: string | null;
  metadataIssue?: unknown;
  /** A synced workspace's provider offloaded the media ("media"): it cannot move until downloaded. */
  evicted?: "media" | "thumbnail";
}

/** Why an item cannot be offered for a move, or null when it can. */
export function notMovableReason(item: MovableItem): "cloud" | "record" | "evicted" | null {
  if (item.id === null) return "cloud";
  if (item.metadataIssue) return "record";
  // Copying an evicted file would download it (decision 15): "Download it first".
  if (item.evicted === "media") return "evicted";
  return null;
}

/** What a move to `target` costs, from where the active workspace is (design: section 2). */
export type MoveCost = "same-drive" | "other-drive" | "synced" | "not-connected";

export function moveCost(target: WorkspaceView, active: WorkspaceView): MoveCost {
  if (target.state !== "available") return "not-connected";
  // A synced side always copies and verifies, even on one drive (decision 15).
  if (target.sync !== null || active.sync !== null) return "synced";
  return target.device !== null && target.device === active.device ? "same-drive" : "other-drive";
}

/**
 * The exports a move should suggest (ADR 0033, decision 15): local exports in the loaded list
 * whose source is one of the selected recordings, counted once, and not already selected.
 * Cloud-only exports are not counted, and moving an export never suggests its source.
 */
export function exportsToSuggest(
  selected: readonly MovableItem[],
  library: readonly MovableItem[],
): MovableItem[] {
  const sources = new Set(selected.filter((i) => i.kind === "recording").map((i) => i.assetId));
  if (sources.size === 0) return [];
  const chosen = new Set(selected.map((i) => i.assetId));
  const seen = new Set<string>();
  return library.filter((item) => {
    if (item.id === null || item.metadataIssue) return false;
    if (!item.derivedFromAssetId || !sources.has(item.derivedFromAssetId)) return false;
    if (chosen.has(item.assetId) || seen.has(item.assetId)) return false;
    seen.add(item.assetId);
    return true;
  });
}

/** The items to move, in order: each recording followed by its exports when "Move all". */
export function orderForMove(
  selected: readonly MovableItem[],
  exports: readonly MovableItem[],
): MovableItem[] {
  const out: MovableItem[] = [];
  const taken = new Set<MovableItem>();
  for (const item of selected) {
    out.push(item);
    for (const candidate of exports) {
      if (candidate.derivedFromAssetId !== item.assetId || taken.has(candidate)) continue;
      taken.add(candidate);
      out.push(candidate);
    }
  }
  return [...out, ...exports.filter((candidate) => !taken.has(candidate))];
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * The result toast: "Moved 3 items to Personal", or "Moved 2 of 3 to Personal. 1 stayed in
 * Work: <title> — <reason>", plus how many were not started after a Stop.
 */
export function resultMessage(
  result: MoveItemsResult,
  context: { titles: ReadonlyMap<string, string>; target: string; source: string },
  t: Translate,
): string {
  const total = result.moved.length + result.failed.length + result.skipped.length;
  const list = result.failed
    .map(({ id, reason }) =>
      t("resultItem", { title: context.titles.get(id) ?? id, reason: reasonText(reason, t) }),
    )
    .join("; ");
  let message: string;
  if (result.failed.length === 0 && result.skipped.length === 0) {
    message = t("resultAll", { count: result.moved.length, target: context.target });
  } else if (result.moved.length === 0) {
    // Everything failed, or Stop came before the first move finished.
    message = t("resultNone", { target: context.target, list }).trim().replace(/\.$/, "");
  } else if (result.failed.length > 0) {
    message = t("resultPartial", {
      moved: result.moved.length,
      total,
      target: context.target,
      failed: result.failed.length,
      source: context.source,
      list,
    });
  } else {
    message = t("resultAll", { count: result.moved.length, target: context.target });
  }
  if (result.skipped.length > 0) {
    message = `${message}. ${t("resultSkipped", { count: result.skipped.length })}`;
  }
  return message;
}

export function reasonText(reason: MoveRefusal, t: Translate): string {
  return t(`reason_${reason}`);
}
