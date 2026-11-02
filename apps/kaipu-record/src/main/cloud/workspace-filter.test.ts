import { describe, expect, it } from "vitest";
import type { CloudCatalogEntry } from "@shared/types/library-item";
import {
  catalogForWorkspace,
  effectiveWorkspace,
  unassignedEntries,
  type CloudScope,
} from "./workspace-filter";

function entry(assetId: string, workspaceId: string | null | undefined): CloudCatalogEntry {
  return {
    assetId,
    kind: "recording",
    title: assetId,
    revisionId: "r",
    contentType: "video/mp4",
    sizeBytes: 1,
    contentSha256: "x",
    durationSeconds: 1,
    hasThumbnail: false,
    derivedFromAssetId: null,
    autoUploadExcluded: false,
    createdAt: 1,
    lastVerifiedAt: 1,
    lastSeenLocalId: null,
    // `undefined` is a cache file written before workspaces: it reads as null.
    ...(workspaceId === undefined ? {} : { workspaceId }),
  } as CloudCatalogEntry;
}

const DEFAULT = "ws-default";
const WORK = "ws-work";
const GONE = "ws-deleted";

function scope(overrides: Partial<CloudScope> = {}): CloudScope {
  return {
    activeId: DEFAULT,
    legacyOwnerId: DEFAULT,
    registered: new Set([DEFAULT, WORK]),
    unassignedHidden: false,
    pending: new Map(),
    ...overrides,
  };
}

const catalog = [
  entry("in-default", DEFAULT),
  entry("in-work", WORK),
  entry("no-ws", null),
  entry("old-cache", undefined),
  entry("of-deleted", GONE),
];
const ids = (entries: CloudCatalogEntry[]) => entries.map((e) => e.assetId).sort();

describe("effectiveWorkspace", () => {
  it("is the server's workspaceId, null for an old cache entry, and a pending move wins", () => {
    expect(effectiveWorkspace(entry("a", WORK), new Map())).toBe(WORK);
    expect(effectiveWorkspace(entry("a", undefined), new Map())).toBeNull();
    expect(effectiveWorkspace(entry("a", WORK), new Map([["a", DEFAULT]]))).toBe(DEFAULT);
  });
});

describe("catalogForWorkspace (decision 4; the rule written in the spec)", () => {
  it("before the first assignment, the legacy owner (Default) lists its own and the unassigned", () => {
    expect(ids(catalogForWorkspace(catalog, scope(), new Set()))).toEqual([
      "in-default",
      "no-ws",
      "old-cache",
    ]);
  });

  it("another workspace lists only its own entries, never the unassigned", () => {
    expect(ids(catalogForWorkspace(catalog, scope({ activeId: WORK }), new Set()))).toEqual([
      "in-work",
    ]);
  });

  it("after the first assignment, nobody lists the unassigned", () => {
    expect(ids(catalogForWorkspace(catalog, scope({ unassignedHidden: true }), new Set()))).toEqual(
      ["in-default"],
    );
  });

  it("an entry of a deleted workspace is listed nowhere (decision 23)", () => {
    for (const activeId of [DEFAULT, WORK]) {
      expect(ids(catalogForWorkspace(catalog, scope({ activeId }), new Set()))).not.toContain(
        "of-deleted",
      );
    }
  });

  it("the cloud copy of a local item of the active workspace is always listed with it", () => {
    expect(
      ids(
        catalogForWorkspace(catalog, scope({ activeId: WORK }), new Set(["no-ws", "in-default"])),
      ),
    ).toEqual(["in-default", "in-work", "no-ws"]);
  });

  it("a pending move shows the entry in its new workspace and not in the old one, offline", () => {
    const pending = new Map([["in-default", WORK]]);
    expect(ids(catalogForWorkspace(catalog, scope({ pending }), new Set()))).not.toContain(
      "in-default",
    );
    expect(
      ids(catalogForWorkspace(catalog, scope({ activeId: WORK, pending }), new Set())),
    ).toContain("in-default");
  });
});

describe("unassignedEntries (Settings → Cloud, 'Unassigned cloud items')", () => {
  it("lists the entries with no workspace or one not registered on this Mac", () => {
    expect(ids(unassignedEntries(catalog, scope()))).toEqual(["no-ws", "of-deleted", "old-cache"]);
  });

  it("a pending assignment takes the entry out of the list at once", () => {
    expect(ids(unassignedEntries(catalog, scope({ pending: new Map([["no-ws", WORK]]) })))).toEqual(
      ["of-deleted", "old-cache"],
    );
  });
});
