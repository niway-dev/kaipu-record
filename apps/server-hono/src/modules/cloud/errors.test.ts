import {
  CloudAccessDeniedError,
  FileTooLargeError,
  QuotaExceededError,
  TooManyPendingUploadsError,
  UnsupportedContentTypeError,
  UploadVerificationError,
  UploadsDisabledError,
} from "@kaipu/domain/schemas";
import { ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { toOrpcError } from "./errors";

// `toOrpcError` returns `unknown` on purpose (see errors.ts) — narrow it here for assertions only.
const asOrpcError = (value: unknown): ORPCError<string, unknown> =>
  value as ORPCError<string, unknown>;

describe("toOrpcError", () => {
  it("maps domain errors to codes and structured data, never leaking internals", () => {
    const quota = asOrpcError(toOrpcError(new QuotaExceededError(350)));
    expect(quota).toBeInstanceOf(ORPCError);
    expect(quota.code).toBe("PAYLOAD_TOO_LARGE");
    expect(quota.data).toEqual({ kind: "quota-exceeded", missingBytes: 350 });
    expect(asOrpcError(toOrpcError(new FileTooLargeError(1000))).data).toEqual({
      kind: "file-too-large",
      limitBytes: 1000,
    });
    expect(asOrpcError(toOrpcError(new UnsupportedContentTypeError("x/y"))).code).toBe(
      "BAD_REQUEST",
    );
    expect(asOrpcError(toOrpcError(new TooManyPendingUploadsError(3))).code).toBe(
      "TOO_MANY_REQUESTS",
    );
    expect(asOrpcError(toOrpcError(new UploadsDisabledError())).code).toBe("SERVICE_UNAVAILABLE");
    expect(asOrpcError(toOrpcError(new CloudAccessDeniedError())).code).toBe("FORBIDDEN");
    expect(asOrpcError(toOrpcError(new UploadVerificationError("size"))).data).toEqual({
      kind: "verification-failed",
      reason: "size",
    });
  });

  it("returns unknown errors untouched so the framework reports a 500 without details", () => {
    const err = new Error("boom https://secret");
    expect(toOrpcError(err)).toBe(err);
  });
});
