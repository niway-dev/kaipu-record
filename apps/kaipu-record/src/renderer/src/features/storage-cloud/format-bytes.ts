/**
 * Decimal byte formatting for cloud capacity (1 GB = 1,000,000,000 bytes), matching how the
 * product states quotas. The library's `formatSize` is binary and stays for on-disk sizes.
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

/** Per-video upload ceiling — the same constant the server enforces (see the plan table). */
export { MAX_VIDEO_BYTES } from "@kaipu/domain/constants";
