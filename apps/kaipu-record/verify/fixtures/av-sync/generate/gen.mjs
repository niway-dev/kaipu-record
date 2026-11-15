// Regenerates mb161.mp4 and mb166.mp4: serves gen.html, opens it in system Chrome once per
// mediabunny version, and writes each uploaded MP4 into <out-dir>. See ../README.md.
//
// Usage: node gen.mjs <path to @playwright/test> <pkgs-dir> <out-dir>
// <pkgs-dir> holds v161/package and v166/package (extracted `npm pack` tarballs).
import http from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const [playwrightPath, pkgsDir, outDir] = process.argv.slice(2);
if (!playwrightPath || !pkgsDir || !outDir) {
  console.error("usage: node gen.mjs <@playwright/test path> <pkgs-dir> <out-dir>");
  process.exit(2);
}
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKGS = path.resolve(pkgsDir);
const { chromium } = createRequire(import.meta.url)(playwrightPath);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "POST" && url.pathname === "/upload") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    await writeFile(
      path.join(outDir, path.basename(url.searchParams.get("name"))),
      Buffer.concat(chunks),
    );
    res.end("ok");
    return;
  }
  const file =
    url.pathname === "/gen.html"
      ? path.join(HERE, "gen.html")
      : path.join(PKGS, path.normalize(url.pathname.replace(/^\/pkgs\//, "")));
  if (file !== path.join(HERE, "gen.html") && !file.startsWith(PKGS))
    return res.writeHead(403).end();
  let body;
  try {
    body = await readFile(file);
  } catch {
    return res.writeHead(404).end();
  }
  const type = file.endsWith(".html") ? "text/html" : "text/javascript";
  res.writeHead(200, { "content-type": type }).end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

const browser = await chromium.launch({ channel: "chrome", headless: true });
console.log("chrome", browser.version());
for (const v of ["161", "166"]) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log(`[v${v}] pageerror`, e.message));
  await page.goto(`http://127.0.0.1:${port}/gen.html?v=${v}`);
  await page.waitForFunction(() => document.title === "done", null, { timeout: 120_000 });
  console.log(`fixture-mb${v}.mp4 written`);
  await page.close();
}
await browser.close();
server.close();
