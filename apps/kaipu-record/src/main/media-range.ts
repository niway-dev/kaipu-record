/**
 * HTTP Range parsing for the kaipu-media protocol. Chromium's media stack seeks by
 * issuing `Range: bytes=<offset>-` requests; a server that answers 200/full-body to
 * those leaves the <video> element stuck in `seeking` forever (it fires `error` on the
 * resource and never recovers until the page reloads). Pure module so it can be
 * unit-tested without Electron.
 */

export interface ByteRange {
  /** First byte offset, inclusive. */
  start: number;
  /** Last byte offset, inclusive. */
  end: number;
}

/**
 * Parse a request's Range header against a resource of `size` bytes.
 *
 * - `null` → no/unsupported Range: serve the full body with 200. Per RFC 9110 a
 *   server MUST ignore range units it doesn't understand, and MAY ignore complex
 *   ranges (Chromium's media stack only ever sends a single `bytes=` range).
 * - `"unsatisfiable"` → syntactically valid but out of bounds: answer 416.
 * - `ByteRange` → serve that slice with 206.
 */
export function parseByteRange(
  header: string | null,
  size: number,
): ByteRange | "unsatisfiable" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startText, endText] = match;
  if (startText === "" && endText === "") return null;

  if (startText === "") {
    // Suffix form `bytes=-N`: the last N bytes.
    const suffix = Number(endText);
    if (suffix === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(startText);
  if (start >= size) return "unsatisfiable";
  const end = endText === "" ? size - 1 : Math.min(Number(endText), size - 1);
  if (end < start) return "unsatisfiable";
  return { start, end };
}
