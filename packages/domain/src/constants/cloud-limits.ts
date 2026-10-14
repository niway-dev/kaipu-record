/**
 * Cloud storage limits. All sizes are integer bytes in DECIMAL units (the units on
 * the product page and the invoice): 1 GB = 1,000,000,000 bytes. Never use 1024
 * here — the desktop shows the same numbers the server enforces.
 */
export const BYTES_PER_MB = 1_000_000;
export const BYTES_PER_GB = 1_000_000_000;

/** Total occupied space allowed per account (media + persisted thumbnails). */
export const FREE_CLOUD_CAPACITY_BYTES = 1 * BYTES_PER_GB;
export const PRO_CLOUD_CAPACITY_BYTES = 25 * BYTES_PER_GB;

/** Per-file caps, independent of the account capacity. */
export const MAX_VIDEO_BYTES = 1 * BYTES_PER_GB;
export const MAX_SCREENSHOT_BYTES = 25 * BYTES_PER_MB; // Task 0: approved 2026-09-13
/** A persisted thumbnail is an auxiliary object and counts toward capacity. */
export const MAX_THUMBNAIL_BYTES = 512_000;

/** Reservations one account may hold in `reserved` state at once, across all its devices. */
export const MAX_PENDING_UPLOADS_PER_ACCOUNT = 3; // Task 0: approved 2026-09-13
/**
 * Presigned PUT lifetime: a margin to START the upload, not a transfer limit — R2 checks expiry
 * when the request starts (Task 1b), so a slow upload that began in time completes.
 */
export const UPLOAD_TICKET_TTL_SECONDS = 5 * 60; // Task 0: approved 2026-09-13
/**
 * How long after ticket expiry the sweep waits before releasing a reservation. Must cover the
 * slowest reasonable upload: 1 GB at ~1 Mbps takes ~2 h 15 min.
 */
export const RESERVATION_GRACE_SECONDS = 3 * 60 * 60; // PROPOSAL (Task 0) — not approved
/** Presigned GET lifetime; a download already running is not cut when it expires (Task 1b). */
export const DOWNLOAD_URL_TTL_SECONDS = 10 * 60; // Task 0: approved 2026-09-13

export type CloudAssetKind = "recording" | "screenshot";

export function maxBytesForKind(kind: CloudAssetKind): number {
  return kind === "screenshot" ? MAX_SCREENSHOT_BYTES : MAX_VIDEO_BYTES;
}

/** "350 MB", "1.25 GB" — decimal, at most two decimals, no trailing zeros. */
export function formatDecimalBytes(bytes: number): string {
  if (bytes >= BYTES_PER_GB) return `${trim(bytes / BYTES_PER_GB)} GB`;
  return `${trim(bytes / BYTES_PER_MB)} MB`;
}

function trim(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * Decimal byte formatting for the capacity views (1 GB = 1,000,000,000 bytes), as the product
 * states quotas: B, KB, MB, GB, TB with at most one decimal. Desktop and web share it so they
 * print identical numbers. `formatDecimalBytes` above is the two-decimal MB/GB variant.
 */
export function formatBytesDecimal(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const decimals = unit === 0 || value >= 10 || Number.isInteger(value) ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[unit]}`;
}
