/**
 * Measures the web app's Core Web Vitals against a PRODUCTION build.
 *
 * The method is the point. A number is only comparable to the previous number
 * if it was taken the same way, so this script — not a remembered command —
 * is the instrument, and every row in the baseline doc cites the commit of the
 * script that produced it.
 *
 * Two profiles, because they answer different questions:
 *   - `local`    — no throttling. Tells you what the server and the build do.
 *   - `throttled`— Slow 4G + 4x CPU, Lighthouse's mobile profile. Tells you what
 *                  a visitor experiences. This is the one that decides whether
 *                  the page is fast; the local one only explains why.
 *
 * Usage, from the repo root:
 *   cd apps/web-hono && bun run build && bun run serve --port 4173 &
 *   node scripts/measure-web-vitals.mjs            # both profiles, dark + light
 *   node scripts/measure-web-vitals.mjs --url http://localhost:4173/
 *
 * Never measure this on the dev server. Vite serves CSS as modules there, so
 * the page flashes unstyled in dev and does not in production — a dev
 * impression tells you nothing about what visitors get.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Playwright is a devDependency of the desktop app, not of the root. Resolve it
 * from there explicitly and, if it is missing, say what to run — this repo
 * checks for tools and never installs them.
 */
function loadPlaywright() {
  const require = createRequire(path.join(ROOT, "apps/kaipu-record/package.json"));
  try {
    // `@playwright/test`, not `playwright`: the desktop app depends on the test
    // runner, and bun's isolated layout does not expose the bare driver here.
    // The runner re-exports the same browser handles.
    return require("@playwright/test");
  } catch {
    console.error(
      "playwright is not installed.\n" +
        "  bun install                       # it ships with the desktop app's devDependencies\n" +
        "  bunx playwright install chromium  # once per machine, for the browser binary",
    );
    process.exit(1);
  }
}

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const URL_UNDER_TEST = flag("url", "http://localhost:4173/");
const THEME_COOKIE = "kaipu_landing_theme";

/** Lighthouse's mobile profile: Slow 4G, 150ms RTT, 4x CPU slowdown. */
const SLOW_4G = {
  offline: false,
  latency: 150,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
};

/** The thresholds Google calls "good". Printed beside every run so a number is never read alone. */
const GOOD = { fcp: 1800, lcp: 2500, cls: 0.1, tbt: 200 };

const observers = () => {
  window.__v = { lcp: 0, cls: 0, tbt: 0 };
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__v.lcp = e.startTime;
  }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (!e.hadRecentInput) window.__v.cls += e.value;
  }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__v.tbt += Math.max(0, e.duration - 50);
  }).observe({ type: "longtask", buffered: true });
};

async function measure(browser, { theme, throttle }) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([
    { name: THEME_COOKIE, value: theme, domain: new URL(URL_UNDER_TEST).hostname, path: "/" },
  ]);
  const page = await ctx.newPage();

  if (throttle) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", SLOW_4G);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  }

  const bytes = new Map();
  page.on("response", async (r) => {
    const type = r.headers()["content-type"] ?? "";
    const kind = /javascript/.test(type)
      ? "js"
      : /css/.test(type)
        ? "css"
        : /font/.test(type)
          ? "font"
          : /image\//.test(type)
            ? "img"
            : null;
    if (!kind) return;
    try {
      bytes.set(r.url(), { kind, n: (await r.body()).length });
    } catch {
      /* a response with no retrievable body tells us nothing; skip it */
    }
  });

  await page.addInitScript(observers);
  await page.goto(URL_UNDER_TEST, { waitUntil: "load" });
  // Long tasks and late LCP candidates keep arriving after load; throttled runs
  // need the longer wait or TBT reads lower than it is.
  await page.waitForTimeout(throttle ? 6000 : 2500);

  const v = await page.evaluate(() => {
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    const nav = performance.getEntriesByType("navigation")[0];
    return {
      fcp: Math.round(fcp?.startTime ?? -1),
      lcp: Math.round(window.__v.lcp),
      cls: Number(window.__v.cls.toFixed(4)),
      tbt: Math.round(window.__v.tbt),
      load: Math.round(nav.loadEventEnd),
    };
  });

  const sum = (k) =>
    [...bytes.values()].filter((b) => b.kind === k).reduce((s, b) => s + b.n, 0) / 1024;
  const count = (k) => [...bytes.values()].filter((b) => b.kind === k).length;
  const weight = Object.fromEntries(
    ["js", "css", "font", "img"].map((k) => [k, { kb: +sum(k).toFixed(1), files: count(k) }]),
  );

  await ctx.close();
  return { ...v, weight };
}

const mark = (value, limit, lowerIsBetter = true) =>
  (lowerIsBetter ? value <= limit : value >= limit) ? "good" : "OVER";

const { chromium } = loadPlaywright();
const browser = await chromium.launch();

console.log(`url: ${URL_UNDER_TEST}`);
console.log(
  `good: FCP <${GOOD.fcp}ms · LCP <${GOOD.lcp}ms · CLS <${GOOD.cls} · TBT <${GOOD.tbt}ms\n`,
);

for (const throttle of [false, true]) {
  for (const theme of ["dark", "light"]) {
    const r = await measure(browser, { theme, throttle });
    const label = `${throttle ? "throttled" : "local    "} ${theme.padEnd(5)}`;
    console.log(
      `${label}  FCP ${String(r.fcp).padStart(5)}ms [${mark(r.fcp, GOOD.fcp)}]` +
        ` · LCP ${String(r.lcp).padStart(5)}ms [${mark(r.lcp, GOOD.lcp)}]` +
        ` · CLS ${String(r.cls).padEnd(6)} [${mark(r.cls, GOOD.cls)}]` +
        ` · TBT ${String(r.tbt).padStart(4)}ms [${mark(r.tbt, GOOD.tbt)}]` +
        ` · load ${r.load}ms`,
    );
    console.log(
      `${" ".repeat(label.length)}  JS ${r.weight.js.kb}KB/${r.weight.js.files}` +
        ` · CSS ${r.weight.css.kb}KB/${r.weight.css.files}` +
        ` · fonts ${r.weight.font.kb}KB/${r.weight.font.files}` +
        ` · img ${r.weight.img.kb}KB/${r.weight.img.files}`,
    );
  }
}

await browser.close();
