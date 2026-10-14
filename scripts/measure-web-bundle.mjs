#!/usr/bin/env node
// Measures what the web app ships to a visitor: every file under
// apps/web-hono/dist/client/assets, raw and brotli (what Cloudflare serves), grouped by
// kind, plus the landing's critical set — the files a first visit to `/` downloads before
// it can paint. Run after `bun run build` in apps/web-hono. Prints a Markdown table for the
// log in /frontend/web-bundle-size/ and, with --json, the same numbers as JSON.
//
// Why brotli and not gzip: production answers `content-encoding: br` (or zstd, which lands
// within a few percent of brotli), so brotli is the number a visitor actually pays for.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";

const root = new URL("..", import.meta.url).pathname;
const assets = join(root, "apps/web-hono/dist/client/assets");
if (!existsSync(assets)) {
  console.error(
    "No build at apps/web-hono/dist/client — run `bun run build` in apps/web-hono first.",
  );
  process.exit(1);
}

const KIND = {
  ".js": "script",
  ".css": "stylesheet",
  ".woff2": "font",
  ".woff": "font",
  ".svg": "image",
  ".png": "image",
  ".jpg": "image",
  ".webp": "image",
  ".avif": "image",
};
const kib = (n) => (n / 1024).toFixed(1);
const br = (buf) =>
  brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;

const files = readdirSync(assets)
  .filter((f) => statSync(join(assets, f)).isFile())
  .map((f) => {
    const buf = readFileSync(join(assets, f));
    return { name: f, kind: KIND[extname(f)] ?? "other", raw: buf.length, br: br(buf) };
  })
  .sort((a, b) => b.br - a.br);

// The landing's critical set: what a first visit to `/` downloads before it can paint and
// hydrate — the root's entry chunk, the `/` route's chunks, the stylesheet the route
// declares and the root's own stylesheets. It is read from the manifest TanStack Start
// emits into the server build (the same one it serialises into the HTML as `preloads` +
// `assets`). Fonts are left out: `font-display: swap` keeps them off the first paint.
const critical = new Set();
const serverAssets = join(root, "apps/web-hono/dist/server/assets");
const manifestFile = existsSync(serverAssets)
  ? readdirSync(serverAssets).find((f) => f.startsWith("_tanstack-start-manifest"))
  : undefined;
if (manifestFile) {
  const src = readFileSync(join(serverAssets, manifestFile), "utf8");
  const start = src.indexOf("({") + 1;
  // Walk to the brace that closes the manifest object; the file is `() => ({ ... })`.
  let depth = 0;
  let end = start;
  for (; end < src.length; end++) {
    if (src[end] === "{") depth++;
    else if (src[end] === "}" && --depth === 0) break;
  }
  const routes = JSON.parse(src.slice(start, end + 1)).routes;
  const name = (href) => basename(href);
  const routeCss = (r) =>
    (r.assets ?? [])
      .filter((a) => a.tag === "link" && a.attrs?.rel === "stylesheet")
      .map((a) => name(a.attrs.href));
  for (const href of routes.__root__?.preloads ?? []) critical.add(name(href));
  for (const href of routes["/"]?.preloads ?? []) critical.add(name(href));
  for (const css of routeCss(routes["/"] ?? {})) critical.add(css);
  // The root's stylesheets are imported from __root.tsx rather than declared on a route, so
  // they appear in no route's `assets`: every stylesheet that no other route claims is root's.
  const claimed = new Set(
    Object.entries(routes)
      .filter(([k]) => k !== "/" && k !== "__root__")
      .flatMap(([, r]) => routeCss(r)),
  );
  for (const f of readdirSync(assets)) if (f.endsWith(".css") && !claimed.has(f)) critical.add(f);
}

const byKind = {};
for (const f of files) {
  const k = (byKind[f.kind] ??= { n: 0, raw: 0, br: 0 });
  k.n++;
  k.raw += f.raw;
  k.br += f.br;
}
const total = files.reduce((s, f) => ({ raw: s.raw + f.raw, br: s.br + f.br }), { raw: 0, br: 0 });
const crit = files.filter((f) => critical.has(f.name));
const critTotal = crit.reduce((s, f) => ({ raw: s.raw + f.raw, br: s.br + f.br }), {
  raw: 0,
  br: 0,
});
const main = files.find((f) => /^main-.*\.js$/.test(f.name));

const result = {
  total_kib: { raw: +kib(total.raw), br: +kib(total.br) },
  by_kind: Object.fromEntries(
    Object.entries(byKind).map(([k, v]) => [
      k,
      { files: v.n, raw_kib: +kib(v.raw), br_kib: +kib(v.br) },
    ]),
  ),
  main_bundle: main ? { name: main.name, raw_kib: +kib(main.raw), br_kib: +kib(main.br) } : null,
  landing_critical: {
    files: crit.map((f) => f.name),
    raw_kib: +kib(critTotal.raw),
    br_kib: +kib(critTotal.br),
  },
  largest: files
    .slice(0, 8)
    .map((f) => ({ name: f.name, kind: f.kind, raw_kib: +kib(f.raw), br_kib: +kib(f.br) })),
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log("| What | Files | Raw | Brotli |");
  console.log("| --- | ---: | ---: | ---: |");
  for (const [k, v] of Object.entries(byKind))
    console.log(`| ${k} | ${v.n} | ${kib(v.raw)} KiB | **${kib(v.br)} KiB** |`);
  console.log(
    `| **everything in assets/** | ${files.length} | ${kib(total.raw)} KiB | **${kib(total.br)} KiB** |`,
  );
  console.log(
    `| landing critical (entry + \`/\` chunks + CSS) | ${crit.length} | ${kib(critTotal.raw)} KiB | **${kib(critTotal.br)} KiB** |`,
  );
  if (main)
    console.log(
      `| main bundle (\`${main.name}\`) | 1 | ${kib(main.raw)} KiB | **${kib(main.br)} KiB** |`,
    );
  console.log("\nLargest files (brotli):");
  for (const f of result.largest)
    console.log(
      `  ${f.br_kib.toFixed(1).padStart(7)} KiB  ${f.kind.padEnd(10)} ${basename(f.name)}`,
    );
}
