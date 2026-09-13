import { describe, expect, it } from "vitest";
import {
  BYTES_PER_GB,
  DOWNLOAD_URL_TTL_SECONDS,
  FREE_CLOUD_CAPACITY_BYTES,
  MAX_PENDING_UPLOADS_PER_ACCOUNT,
  MAX_SCREENSHOT_BYTES,
  MAX_VIDEO_BYTES,
  PRO_CLOUD_CAPACITY_BYTES,
  UPLOAD_TICKET_TTL_SECONDS,
  formatDecimalBytes,
  maxBytesForKind,
} from "./cloud-limits";

describe("cloud limits", () => {
  it("uses decimal units: 1 GB is exactly 1,000,000,000 bytes", () => {
    expect(BYTES_PER_GB).toBe(1_000_000_000);
    expect(FREE_CLOUD_CAPACITY_BYTES).toBe(1_000_000_000);
    expect(PRO_CLOUD_CAPACITY_BYTES).toBe(25_000_000_000);
    expect(MAX_VIDEO_BYTES).toBe(1_000_000_000);
  });

  it("carries the approved Task 0 values", () => {
    expect(MAX_SCREENSHOT_BYTES).toBe(25_000_000);
    expect(MAX_PENDING_UPLOADS_PER_ACCOUNT).toBe(3);
    expect(UPLOAD_TICKET_TTL_SECONDS).toBe(300);
    expect(DOWNLOAD_URL_TTL_SECONDS).toBe(600);
  });

  it("caps each kind independently", () => {
    expect(maxBytesForKind("recording")).toBe(MAX_VIDEO_BYTES);
    expect(maxBytesForKind("screenshot")).toBe(MAX_SCREENSHOT_BYTES);
    expect(MAX_SCREENSHOT_BYTES).toBeLessThan(MAX_VIDEO_BYTES);
  });

  it("formats bytes in decimal MB/GB, never binary", () => {
    expect(formatDecimalBytes(350_000_000)).toBe("350 MB");
    expect(formatDecimalBytes(1_000_000_000)).toBe("1 GB");
    expect(formatDecimalBytes(1_250_000_000)).toBe("1.25 GB");
    expect(formatDecimalBytes(999_999)).toBe("1 MB");
    expect(formatDecimalBytes(0)).toBe("0 MB");
  });
});
