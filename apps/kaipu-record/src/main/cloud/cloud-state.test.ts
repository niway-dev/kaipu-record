import { describe, expect, it } from "vitest";
import type { CloudCatalogEntry } from "@shared/types/library-item";
import { buildCloudState, locationOf } from "./cloud-state";
import type { CloudScope } from "./workspace-filter";

const entry = (assetId: string, workspaceId: string | null, createdAt = 1): CloudCatalogEntry => ({
  assetId,
  kind: "screenshot",
  title: assetId,
  revisionId: "r",
  contentType: "image/png",
  sizeBytes: 10,
  contentSha256: "x",
  durationSeconds: 0,
  hasThumbnail: false,
  derivedFromAssetId: null,
  autoUploadExcluded: false,
  createdAt,
  lastVerifiedAt: 1,
  lastSeenLocalId: null,
  workspaceId,
});

const scope = (overrides: Partial<CloudScope> = {}): CloudScope => ({
  activeId: "ws-a",
  legacyOwnerId: "ws-a",
  registered: new Set(["ws-a", "ws-b"]),
  unassignedHidden: false,
  pending: new Map(),
  ...overrides,
});

describe("locationOf", () => {
  it("names the provider, an external drive, or this Mac", () => {
    expect(
      locationOf("/Users/x/Library/CloudStorage/GoogleDrive-a/My Drive/K", "google-drive"),
    ).toBe("google-drive");
    expect(locationOf("/Volumes/T7/Kaipu", null)).toBe("external-drive");
    expect(locationOf("/Users/x/Movies/Kaipu Record", null)).toBe("this-mac");
  });
});

describe("buildCloudState", () => {
  it("lists the unassigned newest first, with the server's unknown workspace id kept", () => {
    const state = buildCloudState({
      active: { id: "ws-a", path: "/Users/x/Movies/K" },
      sync: null,
      signedIn: true,
      scope: scope(),
      catalog: [entry("old", null, 1), entry("gone", "ws-deleted", 3), entry("mine", "ws-a", 2)],
    });
    expect(state.unassigned.map((i) => [i.assetId, i.workspaceId])).toEqual([
      ["gone", "ws-deleted"],
      ["old", null],
    ]);
    expect(state).toMatchObject({ location: "this-mac", catalogKnown: true });
  });

  it("the legacy owner says it also lists the unassigned, until the first assignment", () => {
    const base = {
      active: { id: "ws-a", path: "/p" },
      sync: null,
      signedIn: true,
      catalog: [],
    };
    expect(buildCloudState({ ...base, scope: scope() }).filter).toBe("own-and-unassigned");
    expect(buildCloudState({ ...base, scope: scope({ unassignedHidden: true }) }).filter).toBe(
      "own",
    );
    expect(buildCloudState({ ...base, scope: scope({ activeId: "ws-b" }) }).filter).toBe("own");
  });

  it("signed out or never fetched: no list, and it says so", () => {
    const state = buildCloudState({
      active: { id: "ws-a", path: "/p" },
      sync: "icloud",
      signedIn: false,
      scope: scope(),
      catalog: null,
    });
    expect(state).toMatchObject({ catalogKnown: false, unassigned: [], location: "icloud" });
  });
});
