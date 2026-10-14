import { z } from "zod";

/** A cloud recording is either a screen video or a screenshot (mirrors the local vault). */
export const recordingKindSchema = z.enum(["recording", "screenshot"]);
export type RecordingKind = z.infer<typeof recordingKindSchema>;

/**
 * `pending` — the row exists and a presigned upload URL was handed out, but the
 * object has not been confirmed in storage yet. `ready` — upload confirmed.
 */
export const recordingStatusSchema = z.enum(["pending", "ready"]);
export type RecordingStatus = z.infer<typeof recordingStatusSchema>;

export const recordingBaseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  kind: recordingKindSchema,
  title: z.string().min(1).max(500),
  /** Object key in cloud storage — see `buildStorageKey`. */
  storageKey: z.string().min(1),
  contentType: z.string().min(1).max(255),
  sizeBytes: z.number().int().nonnegative(),
  durationSeconds: z.number().int().nonnegative(),
  status: recordingStatusSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type RecordingBase = z.infer<typeof recordingBaseSchema>;

// --- Pure rules (no I/O) ---------------------------------------------------

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "video/webm": "webm",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** File extension for a content type (ignoring codec params); "bin" when unknown. */
export function extensionForContentType(contentType: string): string {
  const base = contentType.toLowerCase().split(";")[0]?.trim() ?? "";
  return EXTENSION_BY_CONTENT_TYPE[base] ?? "bin";
}

/**
 * The object key a recording lives at in the private R2 bucket. Follows the
 * layout in `docs backlog/r2-storage-architecture`: videos and images are split
 * by prefix, then namespaced by user so one prefix maps to exactly one account.
 *
 * Shape: `videos/<userId>/<id>.<ext>` (recording) or `img/<userId>/<id>.<ext>`
 * (screenshot).
 */
export function buildStorageKey(params: {
  userId: string;
  recordingId: string;
  kind: RecordingKind;
  contentType: string;
}): string {
  const ext = extensionForContentType(params.contentType);
  const prefix = params.kind === "screenshot" ? "img" : "videos";
  return `${prefix}/${params.userId}/${params.recordingId}.${ext}`;
}
