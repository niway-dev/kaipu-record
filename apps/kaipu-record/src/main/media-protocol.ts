import { protocol } from "electron";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { Readable } from "node:stream";
import { recordingFilePath, screenshotFilePath, thumbnailFilePath } from "./library";
import { parseByteRange } from "./media-range";
import { MEDIA_SCHEME, parseMediaUrl } from "@shared/media-url";

/**
 * Privileged, streamable protocol for local vault media.
 *   kaipu-media://recording/<id>  → the video file (Range-aware, for seeking)
 *   kaipu-media://thumb/<id>      → the poster jpg
 * `registerMediaScheme()` must run BEFORE `app.whenReady`; `registerMediaProtocol()` after.
 */
export { MEDIA_SCHEME };

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        stream: true,
        supportFetchAPI: true,
        bypassCSP: true,
        // The renderer reads the source video with `fetch()` for export (a cross-origin
        // request: the page origin is not kaipu-media://). Without corsEnabled the fetch
        // is refused before it reaches the handler ("Failed to fetch"); element loads
        // (<video>/<img>) are unaffected. streamFile echoes Access-Control-Allow-Origin.
        corsEnabled: true,
      },
    },
  ]);
}

const MIME_BY_EXTENSION: Record<string, string> = {
  ".mp4": "video/mp4",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
};

/**
 * Serve a vault file honoring the request's Range header. Delegating to
 * `net.fetch(file://…)` is NOT enough here: it ignores Range and answers 200 with the
 * full body, which Chromium's media stack accepts for the initial `bytes=0-` load but
 * treats as a fatal resource error for the `bytes=<offset>-` request it issues when
 * seeking outside the buffered range — leaving the <video> permanently stuck in
 * `seeking` (the "timeline scrub kills playback" bug).
 */
async function streamFile(target: string, rangeHeader: string | null): Promise<Response> {
  const { size } = await stat(target);
  const range = parseByteRange(rangeHeader, size);
  if (range === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  }
  const headers: Record<string, string> = {
    "content-type": MIME_BY_EXTENSION[extname(target).toLowerCase()] ?? "application/octet-stream",
    "accept-ranges": "bytes",
    // The export path reads the source with a cross-origin `fetch()` (page origin is not
    // kaipu-media://). Paired with the scheme's `corsEnabled` privilege, this lets the
    // renderer read the response body; element loads (<video>/<img>) don't need it.
    "access-control-allow-origin": "*",
    // Cross-origin readers (mediabunny's UrlSource) learn the file size from these. CORS hides
    // every response header outside the safelist unless it is listed here; without
    // Content-Range the size stays unknown and a moov-at-end MP4 cannot be read by range.
    "access-control-expose-headers": "content-range, content-length, accept-ranges",
  };
  const body = (stream: Readable): BodyInit =>
    // Node's web-stream type and the DOM ReadableStream type are structurally
    // compatible but nominally distinct — bridge them for Response.
    Readable.toWeb(stream) as unknown as BodyInit;
  if (!range) {
    headers["content-length"] = String(size);
    return new Response(body(createReadStream(target)), { status: 200, headers });
  }
  headers["content-length"] = String(range.end - range.start + 1);
  headers["content-range"] = `bytes ${range.start}-${range.end}/${size}`;
  return new Response(body(createReadStream(target, { start: range.start, end: range.end })), {
    status: 206,
    headers,
  });
}

export function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    // Decoded exactly once (ids are titles: `#`, `?`, `%` are legal); a malformed escape
    // or an id reaching outside the vault is a 400, never a thrown handler.
    const parsed = parseMediaUrl(request.url);
    if (!parsed) return new Response("Invalid recording id", { status: 400 });
    const { kind: hostname, id } = parsed;

    // Screenshots are overwritten in place; freshness is handled by the `?v=<mtime>`
    // version token on the URL (see LibraryVault.describe), so normal caching is fine.
    const target =
      hostname === "screenshot"
        ? await screenshotFilePath(id)
        : hostname === "thumb"
          ? thumbnailFilePath(id)
          : await recordingFilePath(id);
    try {
      return await streamFile(target, request.headers.get("range"));
    } catch {
      // stat/read failure — the file is gone or unreadable.
      return new Response("Not found", { status: 404 });
    }
  });
}
