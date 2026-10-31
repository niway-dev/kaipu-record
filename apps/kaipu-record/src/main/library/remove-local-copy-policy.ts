/**
 * "Remove local download" is only safe when the cloud holds exactly these bytes
 * and nothing local depends on the file. Pure — the caller gathers the inputs.
 * Conservative on purpose: an unknown hash is a refusal, not a guess.
 */
export type RemoveLocalCopyDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | "no-cloud-copy"
        | "different-bytes"
        | "hash-unknown"
        | "edit-project"
        | "webcam-track";
    };

export function canRemoveLocalCopy(input: {
  local: { contentSha256: string | null; sizeBytes: number };
  cloud: { contentSha256: string; sizeBytes: number } | null;
  hasEditSession: boolean;
  /** The take's webcam file exists: it is local-only (not uploaded yet), so it must stay. */
  hasWebcamTrack?: boolean;
}): RemoveLocalCopyDecision {
  if (!input.cloud) return { allowed: false, reason: "no-cloud-copy" };
  if (input.hasEditSession) return { allowed: false, reason: "edit-project" };
  if (input.hasWebcamTrack) return { allowed: false, reason: "webcam-track" };
  if (input.local.contentSha256 === null) return { allowed: false, reason: "hash-unknown" };
  if (
    input.local.sizeBytes !== input.cloud.sizeBytes ||
    input.local.contentSha256 !== input.cloud.contentSha256
  ) {
    return { allowed: false, reason: "different-bytes" };
  }
  return { allowed: true };
}
