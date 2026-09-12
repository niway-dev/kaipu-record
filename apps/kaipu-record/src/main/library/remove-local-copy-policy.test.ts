import { describe, expect, it } from "vitest";
import { canRemoveLocalCopy } from "./remove-local-copy-policy";

const SHA = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";

describe("canRemoveLocalCopy", () => {
  const local = { contentSha256: SHA, sizeBytes: 10 };
  const cloud = { contentSha256: SHA, sizeBytes: 10 };

  it("allows only an identical, verified cloud replica with no edit project", () => {
    expect(canRemoveLocalCopy({ local, cloud, hasEditSession: false })).toEqual({ allowed: true });
  });

  it("refuses without a cloud copy", () => {
    expect(canRemoveLocalCopy({ local, cloud: null, hasEditSession: false })).toEqual({
      allowed: false,
      reason: "no-cloud-copy",
    });
  });

  it("refuses when bytes differ or the local hash is unknown", () => {
    expect(
      canRemoveLocalCopy({ local: { ...local, sizeBytes: 11 }, cloud, hasEditSession: false }),
    ).toEqual({ allowed: false, reason: "different-bytes" });
    expect(
      canRemoveLocalCopy({
        local: { contentSha256: null, sizeBytes: 10 },
        cloud,
        hasEditSession: false,
      }),
    ).toEqual({ allowed: false, reason: "hash-unknown" });
  });

  it("refuses when an edit project depends on the file, even if bytes match", () => {
    expect(canRemoveLocalCopy({ local, cloud, hasEditSession: true })).toEqual({
      allowed: false,
      reason: "edit-project",
    });
  });
});
