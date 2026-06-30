import { net, protocol } from "electron";
import { pathToFileURL } from "node:url";
import { recordingFilePath, screenshotFilePath, thumbnailFilePath } from "./library";

/**
 * Privileged, streamable protocol for local vault media.
 *   kaipu-media://recording/<id>  → the video file (Range-aware, for seeking)
 *   kaipu-media://thumb/<id>      → the poster jpg
 * `registerMediaScheme()` must run BEFORE `app.whenReady`; `registerMediaProtocol()` after.
 */
export const MEDIA_SCHEME = "kaipu-media";

function isUnsafeId(id: string): boolean {
  return id.length === 0 || id.includes("/") || id.includes("\\") || id.includes("..");
}

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, stream: true, supportFetchAPI: true, bypassCSP: true },
    },
  ]);
}

export function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const url = new URL(request.url);
    const id = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    if (isUnsafeId(id)) return new Response("Invalid recording id", { status: 400 });

    // Screenshots are overwritten in place; freshness is handled by the `?v=<mtime>`
    // version token on the URL (see LibraryVault.describe), so normal caching is fine.
    const { hostname } = url;
    const target =
      hostname === "screenshot"
        ? await screenshotFilePath(id)
        : hostname === "thumb"
          ? thumbnailFilePath(id)
          : await recordingFilePath(id);
    return net.fetch(pathToFileURL(target).toString());
  });
}
