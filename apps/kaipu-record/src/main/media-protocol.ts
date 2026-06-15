import { net, protocol } from "electron";
import { pathToFileURL } from "node:url";
import { recordingFilePath } from "./library";

/**
 * A privileged, streamable protocol so the renderer can play local vault files
 * without exposing `file://` to the page. The renderer loads
 * `kaipu-media://recording/<id>`; we map the id to the vault file and stream it
 * via `net.fetch`, which honours Range requests (so seeking works).
 *
 * `registerMediaScheme()` must run BEFORE `app.whenReady`; `registerMediaProtocol()`
 * after, once the default session exists.
 */

export const MEDIA_SCHEME = "kaipu-media";

/** Reject anything that could escape the vault directory. */
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
  protocol.handle(MEDIA_SCHEME, (request) => {
    const id = decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, ""));
    if (isUnsafeId(id)) return new Response("Invalid recording id", { status: 400 });
    return net.fetch(pathToFileURL(recordingFilePath(id)).toString());
  });
}
