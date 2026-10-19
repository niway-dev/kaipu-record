import { describe, expect, it } from "vitest";
import en from "@kaipu/i18n/messages/en";
import es from "@kaipu/i18n/messages/es";

import { mergeMessages, pickMessages, type MessageTree } from "./pick-messages";
import { coversSlices, slicesForPath } from "./route-messages";

describe("slicesForPath", () => {
  it("keeps the legal text off the home page", () => {
    const slices = slicesForPath("/");
    expect(slices).toContain("landing");
    expect(slices).toContain("record");
    expect(slices).toContain("legal.links");
    expect(slices).not.toContain("legal");
  });

  it("gives every legal page the full legal namespace", () => {
    expect(slicesForPath("/legal/privacy-policy")).toContain("legal");
    expect(slicesForPath("/legal/cookies/")).toContain("legal");
  });

  it("does not match a prefix that is only a lookalike", () => {
    expect(slicesForPath("/legalese")).toEqual([]);
    expect(slicesForPath("/roadmap-extra")).toEqual([]);
  });

  it("loads the recordings namespace only for the recordings page", () => {
    expect(slicesForPath("/dashboard/recordings")).toContain("recordings");
    expect(slicesForPath("/dashboard")).not.toContain("recordings");
    expect(slicesForPath("/auth/login")).not.toContain("recordings");
    expect(slicesForPath("/auth/login")).toContain("auth");
  });

  it("gives every dashboard page its navigation copy and the app chrome", () => {
    for (const path of [
      "/dashboard",
      "/dashboard/profile",
      "/dashboard/settings",
      "/dashboard/recordings",
    ]) {
      const slices = slicesForPath(path);
      expect(slices).toContain("dashboard");
      expect(slices).toContain("header");
      expect(slices).toContain("auth");
    }
    expect(slicesForPath("/dashboard/")).toEqual(slicesForPath("/dashboard"));
  });

  it("gives the home and the settings page the shared capacity copy, and not the profile", () => {
    for (const path of ["/dashboard", "/dashboard/settings"]) {
      expect(slicesForPath(path)).toContain("account");
      expect(slicesForPath(path)).toContain("storageCloud");
    }
    expect(slicesForPath("/dashboard/profile")).toContain("account");
    expect(slicesForPath("/dashboard/profile")).not.toContain("storageCloud");
  });

  it("sends no copy for the redirect-only legacy paths", () => {
    expect(slicesForPath("/account")).toEqual([]);
    expect(slicesForPath("/recordings")).toEqual([]);
  });

  it("ships the features catalogue only to the features page", () => {
    expect(slicesForPath("/features")).toContain("features");
    expect(slicesForPath("/features")).toContain("landing");
    expect(slicesForPath("/")).not.toContain("features");
    expect(slicesForPath("/roadmap")).not.toContain("features");
  });

  it("sends nothing for a route with no rule", () => {
    expect(slicesForPath("/does-not-exist")).toEqual([]);
  });

  it("only names namespaces that exist in the catalog", () => {
    const known = new Set(Object.keys(en));
    for (const path of [
      "/",
      "/features",
      "/roadmap",
      "/legal/cookies",
      "/auth/login",
      "/dashboard",
      "/dashboard/profile",
      "/dashboard/settings",
      "/dashboard/recordings",
    ]) {
      for (const slice of slicesForPath(path)) {
        expect(known.has(slice.split(".")[0] ?? "")).toBe(true);
      }
    }
  });
});

describe("coversSlices", () => {
  it("lets a full namespace stand in for its sub-slice", () => {
    expect(coversSlices(["legal"], ["legal.links"])).toBe(true);
    expect(coversSlices(["legal.links"], ["legal"])).toBe(false);
  });

  it("is false while any slice is missing", () => {
    expect(coversSlices(["landing"], ["landing", "roadmap"])).toBe(false);
  });
});

describe("pickMessages", () => {
  it("returns only the requested namespaces", () => {
    const picked = pickMessages(en, ["header", "record"]);
    expect(Object.keys(picked).sort()).toEqual(["header", "record"]);
  });

  it("returns the legal link labels without the policy text", () => {
    const { legal } = pickMessages(es, ["legal.links"]) as { legal: MessageTree };
    expect(legal.navigation).toBe(es.legal.navigation);
    expect(legal.privacy).toEqual({ title: es.legal.privacy.title });
    expect(JSON.stringify(legal).length).toBeLessThan(JSON.stringify(es.legal).length / 10);
  });

  it("keeps the full legal namespace when both forms are requested", () => {
    const picked = pickMessages(en, ["legal.links", "legal"]);
    expect(picked.legal).toEqual(en.legal);
  });

  it("ignores a namespace the catalog does not have", () => {
    expect(pickMessages(en, ["nope" as never])).toEqual({});
  });
});

describe("mergeMessages", () => {
  it("lets a full namespace replace the slice that was loaded earlier", () => {
    const links = pickMessages(en, ["legal.links"]);
    const full = pickMessages(en, ["legal"]);
    expect(mergeMessages(links, full)).toEqual(full);
  });

  it("keeps what the next load does not mention", () => {
    const merged = mergeMessages({ a: { x: "1" } }, { a: { y: "2" }, b: "3" });
    expect(merged).toEqual({ a: { x: "1", y: "2" }, b: "3" });
  });
});
