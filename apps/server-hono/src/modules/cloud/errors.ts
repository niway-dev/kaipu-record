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

/** Domain error → oRPC error with a small, structured `data` payload the desktop switches on. */
export function toOrpcError(err: unknown): unknown {
  if (err instanceof QuotaExceededError) {
    return new ORPCError("PAYLOAD_TOO_LARGE", {
      message: "Not enough cloud space",
      data: { kind: "quota-exceeded", missingBytes: err.missingBytes },
    });
  }
  if (err instanceof FileTooLargeError) {
    return new ORPCError("PAYLOAD_TOO_LARGE", {
      message: "File exceeds the per-file limit",
      data: { kind: "file-too-large", limitBytes: err.limitBytes },
    });
  }
  if (err instanceof UnsupportedContentTypeError) {
    return new ORPCError("BAD_REQUEST", { message: "Unsupported content type" });
  }
  if (err instanceof TooManyPendingUploadsError) {
    return new ORPCError("TOO_MANY_REQUESTS", { message: "Too many uploads in progress" });
  }
  if (err instanceof UploadsDisabledError) {
    return new ORPCError("SERVICE_UNAVAILABLE", {
      message: "Cloud uploads are temporarily disabled",
    });
  }
  if (err instanceof CloudAccessDeniedError) {
    return new ORPCError("FORBIDDEN", {
      message: "Cloud upload access is not enabled for this account",
    });
  }
  if (err instanceof UploadVerificationError) {
    return new ORPCError("CONFLICT", {
      message: "Uploaded object does not match the declared revision",
      data: { kind: "verification-failed", reason: err.reason },
    });
  }
  return err;
}
