/**
 * Tiny static server on 127.0.0.1 with Range support, for the decode benchmark. It serves the
 * page and the bundle from --dir and one media file at /media.mp4 (Range requests only
 * touch the bytes asked for; the file is never read whole).
 *
 *   bun server.ts --dir <bundle dir> --media <file.mp4> [--port 0]
 */
import { join } from "node:path";

export function startServer(dir: string, mediaPath: string, port = 0) {
  const media = Bun.file(mediaPath);
  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/") return new Response(Bun.file(join(import.meta.dir, "page.html")));
      if (url.pathname === "/bundle.js") return new Response(Bun.file(join(dir, "bundle.js")));
      if (url.pathname !== "/media.mp4") return new Response("not found", { status: 404 });

      const size = media.size;
      const headers = { "Accept-Ranges": "bytes", "Content-Type": "video/mp4" };
      const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
      if (!range)
        return new Response(media, { headers: { ...headers, "Content-Length": String(size) } });
      let start = range[1] ? Number(range[1]) : size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      if (!range[1] && !range[2]) return new Response("bad range", { status: 416 });
      start = Math.max(0, start);
      end = Math.min(size - 1, end);
      if (start > end) return new Response("bad range", { status: 416 });
      return new Response(media.slice(start, end + 1), {
        status: 206,
        headers: {
          ...headers,
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Content-Length": String(end - start + 1),
        },
      });
    },
  });
}

if (import.meta.main) {
  const get = (name: string): string => {
    const i = process.argv.indexOf(`--${name}`);
    const value = i >= 0 ? process.argv[i + 1] : undefined;
    if (!value) throw new Error(`missing --${name}`);
    return value;
  };
  const portIndex = process.argv.indexOf("--port");
  const server = startServer(
    get("dir"),
    get("media"),
    portIndex >= 0 ? Number(process.argv[portIndex + 1]) || 0 : 0,
  );
  console.log(`serving on http://127.0.0.1:${server.port}`);
}
