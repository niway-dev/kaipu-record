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

/**
 * Input to begin an upload: the client declares the file it is about to send so
 * the server can mint a presigned URL and attach a row to the account.
 */
export const createRecordingUploadSchema = z.object({
  title: z.string().min(1, "Title is required").max(500),
  kind: recordingKindSchema,
  contentType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  durationSeconds: z.number().int().nonnegative().default(0),
});
export type CreateRecordingUpload = z.infer<typeof createRecordingUploadSchema>;

// --- Pure rules (no I/O) ---------------------------------------------------

/** Hard cap on a single upload (2 GiB) — a presigned PUT is one request. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

/** A positive size within the single-request cap. */
export function isWithinUploadLimit(sizeBytes: number): boolean {
  return sizeBytes > 0 && sizeBytes <= MAX_UPLOAD_BYTES;
}

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
 * The object key a recording lives at in cloud storage. Namespaced by user so
 * one prefix maps to exactly one account (`recordings/<userId>/`), and suffixed
 * by the content-type extension.
 *
 * Shape: `recordings/<userId>/<recordingId>.<ext>`.
 */
export function buildStorageKey(params: {
  userId: string;
  recordingId: string;
  contentType: string;
}): string {
  const ext = extensionForContentType(params.contentType);
  return `recordings/${params.userId}/${params.recordingId}.${ext}`;
}
