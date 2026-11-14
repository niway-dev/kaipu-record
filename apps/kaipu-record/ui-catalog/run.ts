import { test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { dismissOnboarding, launchApp } from "../e2e/helpers/launch";
import {
  ALL_AREA_IDS,
  UI_MAP,
  areaGates,
  areaStates,
  type AreaId,
  type ScreenId,
  type ScreenSpec,
  type WindowKind,
} from "../src/shared/ui-map";
import { presetForPath } from "../src/shared/window-size";
import { CATALOGS, KNOWN_VARIABLE } from "./catalog";
import { compareCrops, describeDifference, type CropComparison } from "./compare";
import { NATIVE_NOT_CAPTURABLE } from "./catalog/not-capturable";
import { FIXTURE_FILES, FIXTURES_DIR } from "./fixtures/make-fixtures";
import { SECOND_WORKSPACE, seedCatalogVault } from "./fixtures/seed-vault";
import {
  gateLabel,
  MANIFEST_VERSION,
  type Manifest,
  type ManifestProfile,
  type ManifestScreen,
  type ManifestState,
  type ShotArea,
} from "./manifest";
import { decodePng, dominantColorFraction } from "./png";
import { PROFILE_ORDER, PROFILES, type Profile, type ProfileName } from "./profiles";
import type { NotCapturable } from "./catalog/not-capturable";
import { renderReadme } from "./readme";
import { RUN_ENV } from "./run-env";
import {
  WINDOW_SIZES,
  WINDOW_SIZE_OF_PRESET,
  describeStep,
  wheelTurns,
  flattenCatalog,
  isKnownVariable,
  matchesOnly,
  type CatalogEntry,
  type PermissionName,
  type Part,
  type Step,
  type Target,
  type WaitTarget,
  type WindowSize,
} from "./types";

/*
 * The UI catalog run (spec "How a state is reached in the real app"), as a Playwright test
 * file because `_electron.launch` and the launch helper's bounded quit are built for its
 * runner. Start it with `bun run ui-catalog` (cli.ts): the host guard runs there, before
 * anything imports Playwright.
 *
 * One test per profile, then a `report` test. A profile test never fails: Playwright
 * restarts the worker after a failed test, which would lose the run's state, so each state's
 * result is appended to `.states.jsonl` and the report test reads it back, writes
 * `manifest.json` and `README.md`, and fails with every problem named.
 */

const APP_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(APP_ROOT, "..", "..");
const STARTED_AT = Number(process.env[RUN_ENV.startedAt]) || Date.now();
const ONLY = process.env[RUN_ENV.only] || undefined;
const TWICE = process.env[RUN_ENV.twice] === "1";
const DEFAULT_STATE_TIMEOUT_MS = 20_000;
/** Chromium switches of a profile with a backdrop: a window under it must keep painting. */
const BACKDROP_ARGS = [
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
];
/** A screen's main-window route when it has no route of its own (chrome, overlays). */
const HOME_ROUTE = "/";
/** A route the router does not know: navigating through it remounts the target page. */
const RESET_ROUTE = "/__ui-catalog-reset";
/**
 * Floating windows whose open drawers and cards outlive a state (they are not remounted):
 * Escape closes them before the next state. Not the control bar or the shade, where Escape
 * belongs to the take, nor the capture overlay: main keeps a hidden spare of it, and an
 * Escape there answers a pick that has not opened yet.
 */
const ESCAPE_RESETS: readonly WindowKind[] = [
  "capture-panel",
  "capture-overlay",
  "recording-ready",
];
/**
 * A full-window shot with this share of pixels (or more) in one colour is blank: nothing
 * painted. The emptiest real window of the first full runs, the Export "not found" page, is
 * 83% one colour. Crops are not checked: an empty lane or an empty-state card is legitimately
 * flat (99.8% in the first runs), so a crop check would fail good shots.
 */
const BLANK_WINDOW_FRACTION = 0.995;
/** Windows that are flat by design: the shade is a dim with one countdown digit (99.1-99.7%). */
const FLAT_WINDOWS: readonly WindowKind[] = ["recording-shade"];

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

const SHA = process.env[RUN_ENV.sha] || git(["rev-parse", "HEAD"]);
const SHORT_SHA = SHA.slice(0, 8);
const OUT_DIR =
  process.env[RUN_ENV.outDir] || path.join(REPO_ROOT, ".evidence", "ui-catalog", SHORT_SHA);
const STATES_FILE = path.join(OUT_DIR, ".states.jsonl");
const PROFILES_FILE = path.join(OUT_DIR, ".profiles.jsonl");
const LOG_FILE = path.join(OUT_DIR, "run.log");

const HOME = os.homedir();
/** Paths in the log name the runner's user; keep them relative to home. */
function scrub(text: string): string {
  return text.split(HOME).join("~");
}

function log(line: string): void {
  const stamped = `${new Date().toISOString()} ${scrub(line)}`;
  console.log(stamped);
  mkdirSync(OUT_DIR, { recursive: true });
  appendFileSync(LOG_FILE, `${stamped}\n`);
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** One crop's two shots: identical bytes, or compared pixel by pixel. */
function compareShots(first: string, second: string): CropComparison {
  try {
    return compareCrops(decodePng(readFileSync(first)), decodePng(readFileSync(second)));
  } catch (error) {
    // Cannot tell noise from a change: report it, never excuse it.
    const reason = scrub(String(error instanceof Error ? error.message : error)).split("\n")[0];
    return {
      kind: "differs",
      reason: "size",
      first: "bytes differ",
      second: `undecodable: ${reason}`,
    };
  }
}

const SCREENS = UI_MAP as Readonly<Record<ScreenId, ScreenSpec>>;

function screenAreas(screen: ScreenId): AreaId[] {
  return ALL_AREA_IDS.filter((id) => id.startsWith(`${screen}.`));
}

// ── Pages and windows ──────────────────────────────────────────────────────

function isMainUrl(url: string): boolean {
  return url.startsWith("file:") && !url.includes("?") && url.includes("/out/renderer/");
}

/** The URL fragment that tells a window apart; `?` alone marks "no query" (the main window). */
function windowQuery(kind: WindowKind | "main"): string {
  if (kind === "main") return "?";
  const spec = Object.values(SCREENS).find((s) => s.kind === "window" && s.window === kind);
  if (!spec || spec.kind !== "window") throw new Error(`no window screen for ${kind}`);
  return spec.query;
}

async function poll<T>(
  fn: () => T | undefined | Promise<T | undefined>,
  timeoutMs: number,
  what: string,
): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > until) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function mainPage(app: ElectronApplication, timeoutMs = 15_000): Promise<Page> {
  return poll(() => app.windows().find((p) => isMainUrl(p.url())), timeoutMs, "the main window");
}

/**
 * The page of a floating window. Main keeps a hidden spare of some (the capture overlay) next
 * to the one it is showing, so a visible window wins over a hidden one, and a newer one over
 * an older one.
 */
async function floatingPage(
  app: ElectronApplication,
  kind: WindowKind,
  timeoutMs: number,
): Promise<Page> {
  const query = windowQuery(kind);
  return poll(
    async () => {
      const pages = app.windows().filter((p) => p.url().includes(query) && !p.isClosed());
      if (pages.length <= 1) return pages[0];
      const visible = await app.evaluate(
        ({ BrowserWindow }, urls) =>
          urls.map((url) =>
            BrowserWindow.getAllWindows().some(
              (w) => w.webContents.getURL() === url && w.isVisible(),
            ),
          ),
        pages.map((p) => p.url()),
      );
      return pages.filter((_, i) => visible[i]).at(-1) ?? pages.at(-1);
    },
    timeoutMs,
    `the ${kind} window`,
  );
}

/** Show a floating window without focus, as the tray shows the panel. True when it was hidden. */
async function showWindow(app: ElectronApplication, kind: WindowKind | "main"): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }, query) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      query === "?"
        ? /^file:[^?]*\/out\/renderer\/[^?]*$/.test(w.webContents.getURL())
        : w.webContents.getURL().includes(query),
    );
    if (!win || win.isVisible()) return false;
    win.showInactive();
    // Above the neutral backdrop: macOS stops painting a covered window, and a screenshot
    // of one never returns.
    win.moveTop();
    return true;
  }, windowQuery(kind));
}

async function hideWindow(app: ElectronApplication, kind: WindowKind | "main"): Promise<void> {
  await app.evaluate(({ BrowserWindow }, query) => {
    BrowserWindow.getAllWindows()
      .find((w) =>
        query === "?"
          ? /^file:[^?]*\/out\/renderer\/[^?]*$/.test(w.webContents.getURL())
          : w.webContents.getURL().includes(query),
      )
      ?.hide();
  }, windowQuery(kind));
}

async function isWindowVisible(app: ElectronApplication, url: string): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }, target) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === target);
    return win ? win.isVisible() : false;
  }, url);
}

async function windowBounds(app: ElectronApplication, url: string) {
  return app.evaluate(({ BrowserWindow }, target) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === target);
    return win ? win.getBounds() : null;
  }, url);
}

async function resizeMain(app: ElectronApplication, page: Page, size: WindowSize): Promise<void> {
  const { width, height } = WINDOW_SIZES[size];
  await app.evaluate(
    ({ BrowserWindow }, { url, width, height }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === url);
      win?.setSize(width, height);
    },
    { url: page.url(), width, height },
  );
  // A timeout fails the state: a window that did not reach its size is not the size the
  // README promises (a display smaller than the preset clamps it).
  await page
    .waitForFunction(
      ({ width, height }) =>
        Math.abs(window.outerWidth - width) <= 2 && Math.abs(window.outerHeight - height) <= 2,
      { width, height },
      { timeout: 5_000 },
    )
    .catch(async () => {
      const now = await page.evaluate(() => `${window.outerWidth}×${window.outerHeight}`);
      throw new Error(`the window did not reach ${size} (${width}×${height}); it is ${now}`);
    });
}

/**
 * A window over the whole primary display, playing the countdown fixture, floating above
 * every other app's windows but never focused. It stands in for the runner's desktop in takes
 * and screen captures, which otherwise record whatever the runner has open. Its URL is not
 * the app's (`backdrop.html` in the fixtures folder has no `?window=`), and it carries no
 * `data-ui-area`, so the runner never takes it for an app window.
 *
 * The app's own main window ends up under it; the profile launches Chromium with
 * `--disable-backgrounding-occluded-windows`, so a covered window keeps painting and its
 * screenshot still returns.
 */
async function coverDesktop(app: ElectronApplication): Promise<void> {
  const html = path.join(FIXTURES_DIR, "backdrop.html");
  writeFileSync(
    html,
    `<!doctype html><body style="margin:0;background:#1c1d21;overflow:hidden">` +
      `<video src="${FIXTURE_FILES.countdown}" autoplay loop muted playsinline ` +
      `style="width:100vw;height:100vh;object-fit:cover"></video></body>`,
  );
  await app.evaluate(async ({ BrowserWindow, screen }, html) => {
    const { bounds } = screen.getPrimaryDisplay();
    const backdrop = new BrowserWindow({
      ...bounds,
      title: "ui-catalog backdrop",
      frame: false,
      show: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      enableLargerThanScreen: true,
      backgroundColor: "#1c1d21",
    });
    backdrop.setAlwaysOnTop(true, "floating");
    await backdrop.loadFile(html);
    backdrop.showInactive();
  }, html);
}

// ── Locating areas ─────────────────────────────────────────────────────────

function partLocator(scope: Locator, part: Part): Locator {
  if ("role" in part) {
    return scope.getByRole(part.role as Parameters<Locator["getByRole"]>[0], {
      ...(part.name !== undefined ? { name: part.name } : {}),
      ...(part.exact ? { exact: true } : {}),
    });
  }
  if ("css" in part) return scope.locator(part.css);
  return scope.getByText(part.text, { exact: part.exact ?? false });
}

function targetLocator(page: Page, target: Target): Locator {
  let locator = page.locator(`[data-ui-area="${target.area}"]`);
  if (target.hasText) locator = locator.filter({ hasText: target.hasText });
  if (target.part) locator = partLocator(locator, target.part);
  return locator.nth(target.nth ?? 0);
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Every present instance of each area, as viewport rects. An area wrapped in
 * `display: contents` has no box of its own; its rect is the union of its children's.
 */
async function areaRects(page: Page, ids: readonly string[]): Promise<Record<string, Rect[]>> {
  return page.evaluate((ids) => {
    const rectOf = (el: Element): DOMRect | null => {
      if (getComputedStyle(el).display === "contents") {
        const boxes = [...el.children].map(rectOf).filter((r): r is DOMRect => r !== null);
        if (boxes.length === 0) return null;
        const left = Math.min(...boxes.map((b) => b.left));
        const top = Math.min(...boxes.map((b) => b.top));
        const right = Math.max(...boxes.map((b) => b.right));
        const bottom = Math.max(...boxes.map((b) => b.bottom));
        return new DOMRect(left, top, right - left, bottom - top);
      }
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") return null;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? r : null;
    };
    const out: Record<string, { x: number; y: number; width: number; height: number }[]> = {};
    for (const id of ids) {
      out[id] = [...document.querySelectorAll(`[data-ui-area="${id}"]`)]
        .map(rectOf)
        .filter((r): r is DOMRect => r !== null)
        .map((r) => {
          const x = Math.max(0, Math.floor(r.left));
          const y = Math.max(0, Math.floor(r.top));
          const right = Math.min(window.innerWidth, Math.ceil(r.right));
          const bottom = Math.min(window.innerHeight, Math.ceil(r.bottom));
          return { x, y, width: right - x, height: bottom - y };
        })
        .filter((r) => r.width >= 2 && r.height >= 2);
    }
    return out;
  }, ids);
}

async function waitForArea(
  page: Page,
  area: string,
  timeoutMs: number,
  hidden = false,
): Promise<void> {
  await page.waitForFunction(
    ({ area, hidden }) => {
      const els = [...document.querySelectorAll(`[data-ui-area="${area}"]`)];
      const visible = els.some((el) => {
        const boxes = getComputedStyle(el).display === "contents" ? [...el.children] : [el];
        return boxes.some((b) => {
          const r = b.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
      });
      return hidden ? !visible : visible;
    },
    { area, hidden },
    { timeout: timeoutMs, polling: 100 },
  );
}

/**
 * At rest: no status that says it is loading, nothing `aria-busy`, then two animation
 * frames so the last layout has painted (spec failure 3).
 */
async function settle(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll('[role="status"], [aria-busy="true"]')].some(
        (el) =>
          el.getAttribute("aria-busy") === "true" || /\bloading\b/i.test(el.textContent ?? ""),
      ) &&
      // Not every loader is a status ("Loading sources…" is plain text): any visible
      // "Loading …" line counts. The catalog pins English, so the word is reliable.
      !/(^|\n)[^\n]*\bLoading\b[^\n]*…/.test(document.body.innerText),
    undefined,
    { timeout: timeoutMs, polling: 100 },
  );
  // A web font that arrives after the first paint changes glyph widths by a pixel.
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // Thumbnails and posters load on their own clock; a shot must not catch one half-way.
  await page.waitForFunction(
    () =>
      [...document.images].every(
        (img) => img.complete && (img.naturalWidth > 0 || !img.currentSrc),
      ),
    undefined,
    { timeout: timeoutMs, polling: 100 },
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

// ── Steps ──────────────────────────────────────────────────────────────────

interface Ctx {
  app: ElectronApplication;
  main: Page;
  profile: ProfileName;
  vaultDir: string;
  /** A copy of the workspace folder taken once the profile was up (`restoreVault`). */
  vaultSnapshot: string;
  /** Windows a step or the reset showed; hidden again after the state. */
  shown: Set<WindowKind | "main">;
  target: WindowKind | undefined;
  timeoutMs: number;
}

async function pageFor(ctx: Ctx, on: "main" | "target" | WindowKind | undefined): Promise<Page> {
  if (on === "main") return ctx.main;
  if (on && on !== "target") return floatingPage(ctx.app, on, ctx.timeoutMs);
  if (!ctx.target) return ctx.main;
  return floatingPage(ctx.app, ctx.target, ctx.timeoutMs);
}

async function navigate(page: Page, route: string): Promise<void> {
  await page.evaluate((hash) => {
    location.hash = hash;
  }, `#${route}`);
  await page.waitForFunction((hash) => location.hash === hash, `#${route}`, { timeout: 5_000 });
}

/**
 * A player that autoplays shows whichever frame the clock reached. Like a user pressing
 * pause and going back to the start: pause, seek to 0:00, and wait until that frame has
 * been presented.
 */
async function pauseVideosAtStart(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const within = (ms: number, promise: Promise<unknown>) =>
      Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);
    for (const video of document.querySelectorAll("video")) {
      video.pause();
      const seeked = new Promise((resolve) =>
        video.addEventListener("seeked", resolve, { once: true }),
      );
      video.currentTime = 0;
      await within(5_000, seeked);
      await within(
        2_000,
        new Promise((resolve) => video.requestVideoFrameCallback(() => resolve(undefined))),
      );
      // The native controls animate (the scrubber thumb fades) when the state changes.
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  });
}

async function waitFor(ctx: Ctx, page: Page, target: WaitTarget, timeoutMs: number): Promise<void> {
  if ("video" in target) {
    await page.waitForFunction(
      () => {
        if (![...document.querySelectorAll("video")].some((v) => v.readyState >= 2)) return false;
        // The editor decodes its thumbnails after the video is ready and publishes them all
        // at once: the timeline's, and the webcam lane's when the recording has a webcam.
        if (!document.querySelector('[data-testid="ruler"]')) return true;
        if (!document.querySelector('[data-ui-area="editorVideo.timeline"] img')) return false;
        const webcam =
          document.querySelector('[data-testid="webcam-slot"]') ||
          document.querySelector('[data-testid="webcam-lane"]');
        return !webcam || !!document.querySelector("[data-webcam-filmstrip] img");
      },
      undefined,
      { timeout: timeoutMs, polling: 100 },
    );
    if (target.video === "paused-at-start") await pauseVideosAtStart(page);
  } else if ("window" in target) {
    await floatingPage(ctx.app, target.window, timeoutMs);
  } else if (target.part) {
    await targetLocator(page, target).waitFor({
      state: target.state === "hidden" ? "hidden" : "visible",
      timeout: timeoutMs,
    });
  } else {
    await waitForArea(page, target.area, timeoutMs, target.state === "hidden");
  }
}

async function callApi(page: Page, method: string, args: readonly unknown[]): Promise<unknown> {
  return page.evaluate(
    async ({ method, args }) => {
      const parts = method.split(".");
      let owner: unknown = window.electronAPI;
      for (const part of parts.slice(0, -1)) owner = (owner as Record<string, unknown>)[part];
      const fn = (owner as Record<string, unknown>)[parts[parts.length - 1]];
      if (typeof fn !== "function") throw new Error(`electronAPI.${method} is not a function`);
      const result = await (fn as (...a: unknown[]) => unknown).apply(owner, args);
      // Only JSON comes back across the bridge.
      return result === undefined ? null : JSON.parse(JSON.stringify(result));
    },
    { method, args: [...args] },
  );
}

interface Activity {
  active: boolean;
  status: string;
  pending?: boolean;
  elapsedSeconds?: number;
}

async function recordingActivity(page: Page): Promise<Activity> {
  return (await callApi(page, "getRecordingState", [])) as Activity;
}

async function waitForActivity(
  page: Page,
  done: (a: Activity) => boolean,
  timeoutMs: number,
  what: string,
): Promise<void> {
  await poll(async () => (done(await recordingActivity(page)) ? true : undefined), timeoutMs, what);
}

async function runAction(ctx: Ctx, name: string): Promise<void> {
  const page = ctx.main;
  switch (name) {
    case "selectFirstScreen": {
      await page.evaluate(async () => {
        const sources = await window.electronAPI.getScreenSources({ withThumbnails: false });
        const screen = sources.find((s) => s.id.startsWith("screen:"));
        if (!screen)
          throw new Error("no screen source: is Screen Recording granted to the runner?");
        window.electronAPI.updateRecordingSettings({
          selectedSource: { id: screen.id, name: screen.name, type: "screen" },
          area: null,
        });
      });
      return;
    }
    case "cancelPick": {
      const query = windowQuery("capture-overlay");
      for (const open of ctx.app.windows().filter((p) => p.url().includes(query))) {
        // The overlay can close on its own between the lookup and the key.
        await open.keyboard.press("Escape").catch(() => undefined);
      }
      await poll(
        async () =>
          (await ctx.app.evaluate(
            ({ BrowserWindow }, q) =>
              !BrowserWindow.getAllWindows().some(
                (w) => w.webContents.getURL().includes(q) && w.isVisible(),
              ),
            query,
          ))
            ? true
            : undefined,
        ctx.timeoutMs,
        "the capture overlay to close",
      );
      return;
    }
    case "reloadMain":
      await ctx.main.reload();
      await ctx.main.waitForFunction(() => !!window.electronAPI, undefined, { timeout: 15_000 });
      return;
    case "restoreVault": {
      // A save the app started on leaving the editor can still be writing into
      // `.kaipu`; the retries ride out ENOTEMPTY from a file landing mid-delete.
      for (const entry of readdirSync(ctx.vaultDir)) {
        rmSync(path.join(ctx.vaultDir, entry), {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 200,
        });
      }
      cpSync(ctx.vaultSnapshot, ctx.vaultDir, { recursive: true });
      return;
    }
    case "forgetRedactionNotice":
      // The key literal is the renderer's REDACTION_NOTICE_KEY
      // (src/renderer/src/features/screenshots/canvas/redaction-notice-store.ts); a test pins it.
      await page.evaluate(() => localStorage.removeItem("kaipu.imageEditor.redactionNoticeSeen"));
      return;
    case "lockVault":
      chmodSync(ctx.vaultDir, 0o000);
      return;
    case "unlockVault":
      chmodSync(ctx.vaultDir, 0o755);
      return;
    case "clearClipboard":
      await ctx.app.evaluate(({ clipboard }) => clipboard.clear());
      return;
    case "requestTake":
      await waitForActivity(
        page,
        (a) => !a.active && !a.pending,
        60_000,
        "the previous take to end",
      );
      await callApi(page, "requestStartRecording", []);
      return;
    case "startTake":
      // A take still saving from the previous state would swallow this request.
      await waitForActivity(
        page,
        (a) => !a.active && !a.pending,
        60_000,
        "the previous take to end",
      );
      await callApi(page, "requestStartRecording", []);
      await waitForActivity(page, (a) => a.active, ctx.timeoutMs, "the take to start");
      return;
    case "pauseTake": {
      // The recorder ignores a pause until its engine runs: during the countdown and while it
      // starts, "active" is already true but nothing would pause. Its ticks carry the elapsed
      // seconds, so a tick past 0 proves the engine is running and a pause will hold.
      await waitForActivity(
        page,
        (a) => a.active && a.status === "recording" && (a.elapsedSeconds ?? 0) >= 1,
        ctx.timeoutMs,
        "the take to report its first second",
      ).catch(async (error) => {
        throw new Error(
          `${String(error.message ?? error)}; last activity ${JSON.stringify(await recordingActivity(page))}`,
        );
      });
      const until = Date.now() + ctx.timeoutMs;
      for (;;) {
        await callApi(page, "controlCommand", ["pause"]);
        const paused = await waitForActivity(page, (a) => a.status === "paused", 3_000, "a pause")
          .then(() => true)
          .catch(() => false);
        if (paused) return;
        if (Date.now() > until) {
          throw new Error(
            `the take never paused; last activity ${JSON.stringify(await recordingActivity(page))}`,
          );
        }
      }
    }
    case "resumeTake":
      await callApi(page, "controlCommand", ["resume"]);
      await waitForActivity(
        page,
        (a) => a.status === "recording",
        ctx.timeoutMs,
        "the take to resume",
      );
      return;
    case "stopTake":
      await callApi(page, "controlCommand", ["stop"]);
      await waitForActivity(page, (a) => !a.active && !a.pending, 60_000, "the take to end");
      return;
    default:
      throw new Error(`unknown action ${name}`);
  }
}

async function runStep(ctx: Ctx, step: Step): Promise<void> {
  const t = ctx.timeoutMs;
  if ("navigate" in step) return navigate(ctx.main, step.navigate);
  if ("show" in step) {
    if (step.show !== "main") await floatingPage(ctx.app, step.show, t);
    if (await showWindow(ctx.app, step.show)) ctx.shown.add(step.show);
    return;
  }
  if ("hide" in step) return hideWindow(ctx.app, step.hide);
  if ("action" in step) return runAction(ctx, step.action);
  if ("waitMs" in step) return new Promise((r) => setTimeout(r, step.waitMs));
  if ("window" in step && typeof step.window === "string")
    return resizeMain(ctx.app, ctx.main, step.window);
  const page = await pageFor(ctx, "on" in step ? step.on : undefined);
  if ("click" in step || "hover" in step) {
    const target = "click" in step ? step.click : step.hover;
    const locator = targetLocator(page, target);
    if (step.at) {
      const box = await locator.boundingBox({ timeout: t });
      if (!box) throw new Error("the target has no box to aim at");
      const x = box.x + box.width * step.at.x;
      const y = box.y + box.height * step.at.y;
      await page.mouse.move(x, y);
      if ("click" in step) await page.mouse.click(x, y);
      return;
    }
    return "click" in step ? locator.click({ timeout: t }) : locator.hover({ timeout: t });
  }
  if ("wheel" in step) {
    const turns = wheelTurns(step);
    await targetLocator(page, step.wheel).hover({ timeout: t });
    for (const [dx, dy] of turns) await page.mouse.wheel(dx, dy);
    // The viewport applies each turn on the next frame; let the last one land.
    await page.waitForTimeout(300);
    return;
  }
  if ("drag" in step) {
    const box = await targetLocator(page, step.drag).boundingBox({ timeout: t });
    if (!box) throw new Error("the drag target has no box");
    const at = (p: { x: number; y: number }) => ({
      x: box.x + box.width * p.x,
      y: box.y + box.height * p.y,
    });
    const from = at(step.from);
    const to = at(step.to);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
    return;
  }
  if ("fill" in step) return targetLocator(page, step.fill).fill(step.value, { timeout: t });
  if ("scrollTo" in step) {
    return targetLocator(page, step.scrollTo).scrollIntoViewIfNeeded({ timeout: t });
  }
  if ("press" in step) {
    if (step.target) return targetLocator(page, step.target).press(step.press, { timeout: t });
    return page.keyboard.press(step.press);
  }
  if ("waitFor" in step) return waitFor(ctx, page, step.waitFor, step.timeoutMs ?? t);
  if ("call" in step) {
    const result = await callApi(page, step.call, step.args ?? []);
    // Kept in run.log: what main answered is often the reason a state looks as it does.
    if (result !== null) log(`    ${step.call} → ${JSON.stringify(result).slice(0, 300)}`);
    return;
  }
  throw new Error(`unknown step ${JSON.stringify(step)}`);
}

// ── One state ──────────────────────────────────────────────────────────────

interface ProfileRun {
  app: ElectronApplication;
  main: Page;
  vaultDir: string;
  vaultSnapshot: string;
  name: ProfileName;
  profile: Profile;
  permissions: Record<PermissionName, boolean>;
  baselineToggles: Record<string, unknown>;
  /** The app's settings once the profile was up; every state starts from these. */
  baselineSettings: Record<string, unknown>;
  pageErrors: string[];
}

/**
 * Routes that read router state: opened bare they redirect (`/editor/capture` goes to
 * Screenshots), so the reset does not open them and a state's steps reach them the way the
 * app does.
 */
const STATE_ONLY_ROUTES: readonly string[] = ["/editor/capture"];

function routeOf(screen: ScreenSpec): string | undefined {
  if (screen.kind === "chrome" || screen.kind === "overlay") return HOME_ROUTE;
  if (screen.kind !== "route") return undefined;
  if (STATE_ONLY_ROUTES.includes(screen.route)) return undefined;
  return screen.route.includes(":") ? undefined : screen.route;
}

function missingPermission(run: ProfileRun, entry: CatalogEntry): string | undefined {
  const requires = { ...run.profile.requires, ...entry.spec.requires };
  for (const [name, wanted] of Object.entries(requires) as [PermissionName, boolean][]) {
    if (run.permissions[name] !== wanted) {
      return wanted
        ? `needs ${name} granted; the runner does not grant it`
        : `needs ${name} denied; the runner grants it, so this side cannot be produced`;
    }
  }
  return undefined;
}

function howOf(entry: CatalogEntry): string {
  if (entry.spec.how) return entry.spec.how;
  const steps = (entry.spec.steps ?? []).map(describeStep);
  const size = entry.spec.window
    ? `, window ${WINDOW_SIZES[entry.spec.window].width}×${WINDOW_SIZES[entry.spec.window].height}`
    : "";
  const profile = `profile \`${entry.spec.profile}\`${size}`;
  const sentence = steps
    .map((step, i) => (i === 0 ? step : step.charAt(0).toLowerCase() + step.slice(1)))
    .join(", then ");
  return steps.length > 0 ? `${sentence} (${profile}).` : `Open the screen (${profile}).`;
}

/**
 * Put back every app setting a state changed (`updateSettings` in its steps), whether or not
 * its `after` undid it. Only the keys that differ are patched, so a reset of nothing writes
 * nothing.
 */
async function restoreSettings(run: ProfileRun): Promise<void> {
  const now = (await callApi(run.main, "getSettings", [])) as Record<string, unknown>;
  const changed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(run.baselineSettings)) {
    if (JSON.stringify(now[key]) !== JSON.stringify(value)) changed[key] = value;
  }
  if (Object.keys(changed).length === 0) return;
  log(`    settings restored to the profile's: ${Object.keys(changed).join(", ")}`);
  await callApi(run.main, "updateSettings", [changed]);
}

async function blurFocus(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    })
    .catch(() => undefined);
}

async function shoot(
  run: ProfileRun,
  entry: CatalogEntry,
  outRoot: string,
): Promise<ManifestState> {
  const started = Date.now();
  const { spec, screen, name } = entry;
  const screenSpec = SCREENS[screen];
  const timeoutMs = spec.timeoutMs ?? run.profile.stateTimeoutMs ?? DEFAULT_STATE_TIMEOUT_MS;
  const target: WindowKind | undefined =
    screenSpec.kind === "window" ? screenSpec.window : undefined;
  const ctx: Ctx = {
    app: run.app,
    main: run.main,
    vaultDir: run.vaultDir,
    vaultSnapshot: run.vaultSnapshot,
    profile: run.name,
    shown: new Set(),
    target,
    timeoutMs,
  };
  const errorsBefore = run.pageErrors.length;
  const base = {
    id: entry.id,
    screen,
    name,
    profile: run.name,
    demonstrates: spec.demonstrates,
    embedsScreen: spec.embedsScreen === true,
    ...(spec.unpublished ? { unpublished: spec.unpublished } : {}),
    how: howOf(entry),
    gates: (spec.gates ?? []).map((g) => ({ label: gateLabel(g), side: g.side })),
  };
  const finish = (rest: Partial<ManifestState> & Pick<ManifestState, "status">): ManifestState => ({
    ...base,
    areasFound: [],
    areasAbsent: [],
    pageErrors: run.pageErrors.slice(errorsBefore),
    durationMs: Date.now() - started,
    ...rest,
  });

  const missing = missingPermission(run, entry);
  if (missing)
    return finish({ status: "notCapturable", reason: missing, reasonKind: "permission" });

  let page: Page = run.main;
  /** The size a main-window state asked for; its shot must be exactly this big. */
  let mainSize: WindowSize | undefined;
  try {
    // Reset (spec failure 9): close whatever is open, put the recording toggles back, and
    // remount the screen by routing through a page that does not exist.
    // Escape would also close a kept onboarding takeover for good.
    if (screenSpec.kind !== "overlay" && run.profile.onboarding !== "keep") {
      await run.main.keyboard.press("Escape").catch(() => undefined);
    }
    // Closing a menu hands focus back to its button, with the keyboard focus ring: the next
    // state would be shot with a ring the previous one left. Focus starts nowhere, as on launch.
    await blurFocus(run.main);
    await callApi(run.main, "updateRecordingSettings", [run.baselineToggles]);
    await restoreSettings(run);
    const route = routeOf(screenSpec);
    if (target && ESCAPE_RESETS.includes(target)) {
      const leftover = run.app
        .windows()
        .find((p) => p.url().includes(windowQuery(target)) && !p.isClosed());
      await leftover?.keyboard.press("Escape").catch(() => undefined);
      if (leftover) await blurFocus(leftover);
    }
    if (screenSpec.kind === "overlay") {
      // Escape would close the takeover for good; a reload brings it back at its first step.
      await run.main.reload();
      await waitForArea(run.main, `${screen}.root`, timeoutMs);
    } else if (!target) {
      await navigate(run.main, RESET_ROUTE);
      if (route) await navigate(run.main, route);
      // A page opens at the top; the previous state's scroll must not carry over.
      await run.main.evaluate(() => {
        for (const el of document.querySelectorAll("*")) if (el.scrollTop > 0) el.scrollTop = 0;
        window.scrollTo(0, 0);
      });
    }

    for (const step of spec.steps ?? []) await runStep(ctx, step);

    if (target) {
      // Main shows its floating windows itself (or a `show` step does, for the prewarmed
      // panel). Showing one behind main's back confuses its own show/hide handshake.
      page = await floatingPage(run.app, target, timeoutMs);
      await poll(
        async () => ((await isWindowVisible(run.app, page.url())) ? true : undefined),
        timeoutMs,
        `the ${target} window to be shown`,
      );
    } else {
      const path = await run.main.evaluate(() => location.hash.slice(1));
      mainSize = spec.window ?? WINDOW_SIZE_OF_PRESET[presetForPath(path.split("?")[0])];
      await resizeMain(run.app, run.main, mainSize);
    }

    const readyArea =
      spec.ready && "area" in spec.ready
        ? spec.ready.area
        : (spec.demonstrates[0].split(":")[0] as AreaId);
    if (spec.ready && "video" in spec.ready) await waitFor(ctx, page, spec.ready, timeoutMs);
    await waitForArea(page, readyArea, timeoutMs);
  } catch (error) {
    const message = scrub(String(error instanceof Error ? error.message : error)).split("\n")[0];
    await debugShot(page, entry);
    const undone = await runAfter(ctx, entry, run);
    return finish({
      status: "failed",
      reasonKind: "runFailure",
      reason:
        `could not reach the state: ${message}` +
        (undone.length > 0 ? `; its after-step failed too: ${undone.join(" | ")}` : ""),
    });
  }

  try {
    // A toast a step caused ("Restored your previous edit") covers the corner of the window
    // for five seconds; it is not part of the state, so it is closed like a user would,
    // unless the state says the toast is what it shows.
    if (!target && !spec.keepToasts) {
      await page.evaluate(() => {
        for (const close of document.querySelectorAll<HTMLButtonElement>(
          '[role="alert"] button[aria-label="Close"]',
        ))
          close.click();
      });
    }
    await settle(page, 10_000);
    // A freshly rasterised page draws translucent-layer text (a badge with backdrop-filter)
    // heavier than the same page after it was invalidated once, which is what the second shot
    // of every state sees. Invalidate before the first one too.
    // Not in a floating window: its live video (the camera bubble) must not restart.
    if (!target)
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            document.body.style.display = "none";
            void document.body.offsetHeight;
            document.body.style.display = "";
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }),
      );
    const viewport = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio,
    }));
    if (!spec.keepPointer) await page.mouse.move(viewport.width - 1, viewport.height - 1);

    const windowFile = path.join("screens", screen, `${name}.png`);
    const windowPath = path.join(outRoot, windowFile);
    mkdirSync(path.dirname(windowPath), { recursive: true });
    await page.screenshot({ path: windowPath, animations: "disabled", caret: "hide" });
    const png = pngSize(windowPath);
    const problems: string[] = [];
    // A main-window shot is the size it asked for times the display's scale: comparing it
    // with the live viewport could never fail. A floating window has no asked size, so it
    // can only be checked against its own viewport.
    const asked = mainSize ? WINDOW_SIZES[mainSize] : viewport;
    const expected = {
      width: Math.round(asked.width * viewport.dpr),
      height: Math.round(asked.height * viewport.dpr),
    };
    if (png.width !== expected.width || png.height !== expected.height) {
      problems.push(
        `window PNG is ${png.width}×${png.height}, expected ${expected.width}×${expected.height}`,
      );
    }
    if (!target || !FLAT_WINDOWS.includes(target)) {
      const flat = dominantColorFraction(decodePng(readFileSync(windowPath)));
      if (flat >= BLANK_WINDOW_FRACTION) {
        problems.push(`window PNG is ${(flat * 100).toFixed(1)}% one colour: blank capture`);
      }
    }

    const areas = screenAreas(screen);
    const rects = await areaRects(page, areas);
    const found: ShotArea[] = [];
    const absent: string[] = [];
    for (const area of areas) {
      const choice = spec.crops?.[area as keyof typeof spec.crops];
      let rect: Rect | undefined = rects[area]?.[choice?.nth ?? 0];
      if (choice?.part || choice?.hasText) {
        const box = await targetLocator(page, { area, ...choice })
          .boundingBox()
          .catch(() => null);
        // Clipped to the window: a card below the fold has no pixels to crop.
        if (box) {
          const x = Math.max(0, Math.floor(box.x));
          const y = Math.max(0, Math.floor(box.y));
          const width = Math.min(viewport.width, Math.ceil(box.x + box.width)) - x;
          const height = Math.min(viewport.height, Math.ceil(box.y + box.height)) - y;
          rect = width >= 2 && height >= 2 ? { x, y, width, height } : undefined;
        } else {
          rect = undefined;
        }
      }
      if (!rect) {
        absent.push(area);
        continue;
      }
      const file = path.join("areas", screen, area.slice(screen.length + 1), `${name}.png`);
      const full = path.join(outRoot, file);
      mkdirSync(path.dirname(full), { recursive: true });
      await page.screenshot({ path: full, clip: rect, animations: "disabled", caret: "hide" });
      found.push({ id: area, file, rect, sha256: sha256(full) });
    }

    if (spec.stillOnScreen) {
      const here = await targetLocator(page, spec.stillOnScreen).count();
      if (here === 0) {
        problems.push(
          `${describeStep({ waitFor: spec.stillOnScreen })} no longer held when the shot was taken: the state moved on`,
        );
      }
    }

    // A kept toast still closes on its own timer: one gone by the end of the shot means the
    // image may show the state without it, so the state fails instead of keeping that image.
    // A toast is an alert with a Close button; inline error alerts have none.
    if (
      spec.keepToasts &&
      (await page.locator('[role="alert"]:has(button[aria-label="Close"])').count()) === 0
    )
      problems.push("keepToasts: no toast was still open when the shot was taken");

    // The image must show what it claims, and nothing the state did not ask for.
    for (const claim of spec.demonstrates) {
      const area = claim.split(":")[0];
      if (!found.some((f) => f.id === area))
        problems.push(`claims ${claim} but ${area} is not on screen`);
    }
    for (const unasked of ["shell.notFound", "shell.routeError"]) {
      const shown = (await areaRects(page, [unasked]))[unasked]?.length > 0;
      if (shown && !spec.demonstrates.some((d) => d.startsWith(`${unasked}:`))) {
        problems.push(`${unasked} rendered without being asked for`);
      }
    }
    const bounds = await windowBounds(run.app, page.url());
    for (const failed of await runAfter(ctx, entry, run)) problems.push(`after-step: ${failed}`);
    const pageErrors = run.pageErrors.slice(errorsBefore);
    if (pageErrors.length > 0) problems.push(`page errors: ${pageErrors.join(" | ")}`);
    return finish({
      status: problems.length > 0 ? "failed" : "shot",
      ...(problems.length > 0 ? { reasonKind: "runFailure" as const } : {}),
      ...(problems.length > 0 ? { reason: problems.join("; ") } : {}),
      window: {
        file: windowFile,
        kind: target ?? "main",
        width: png.width,
        height: png.height,
        bounds,
        sha256: sha256(windowPath),
      },
      areasFound: found,
      areasAbsent: absent,
    });
  } catch (error) {
    const undone = await runAfter(ctx, entry, run);
    const message = scrub(String(error instanceof Error ? error.message : error)).split("\n")[0];
    return finish({
      status: "failed",
      reasonKind: "runFailure",
      reason:
        `shot failed: ${message}` +
        (undone.length > 0 ? `; its after-step failed too: ${undone.join(" | ")}` : ""),
    });
  }
}

/**
 * What the window looked like when a state could not be reached, for whoever fixes the
 * catalog. Kept out of `screens/` and the README.
 */
async function debugShot(page: Page, entry: CatalogEntry): Promise<void> {
  const file = path.join(OUT_DIR, "debug", entry.screen, `${entry.name}.png`);
  mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, timeout: 5_000 }).catch(() => undefined);
}

/**
 * The state's own undo, then hide what the state showed. Returns what failed: an undo that
 * did not run leaves the next state in a place nobody checked, so it fails this state.
 */
async function runAfter(ctx: Ctx, entry: CatalogEntry, run: ProfileRun): Promise<string[]> {
  const failed: string[] = [];
  for (const step of entry.spec.after ?? []) {
    await runStep(ctx, step).catch((error) => {
      const message = scrub(String(error)).split("\n")[0];
      log(`  after-step of ${entry.id} failed: ${message}`);
      failed.push(`${describeStep(step)}: ${message}`);
    });
  }
  for (const kind of ctx.shown) await hideWindow(run.app, kind).catch(() => undefined);
  return failed;
}

// ── One profile ────────────────────────────────────────────────────────────

const ENTRIES = flattenCatalog(CATALOGS).filter((e) => matchesOnly(e.id, ONLY));

function appendJsonl(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(value)}\n`);
}

function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

async function runProfile(name: ProfileName, entries: CatalogEntry[]): Promise<void> {
  const profile: Profile = PROFILES[name];
  log(`profile ${name}: ${entries.length} state(s)`);
  const flags = profile.flags ?? {};
  const record: {
    -readonly [K in keyof ManifestProfile]: ManifestProfile[K];
  } = {
    name,
    description: profile.description,
    launched: false,
    flags,
    rendererFlags: null,
    permissions: null,
    display: null,
  };
  let launched: Awaited<ReturnType<typeof launchApp>> | undefined;
  let vaultSnapshot = "";
  removeSecondWorkspaceFolder();
  try {
    launched = await launchApp({
      settings: profile.settings,
      seedVault: (dir) =>
        seedCatalogVault(dir, {
          now: STARTED_AT,
          content: profile.seed,
          cursorRecording: profile.cursorRecording,
          floatingImages: profile.floatingImages,
          textScreenshot: profile.textScreenshot,
          colorsScreenshots: profile.colorsScreenshots,
          lockedRedaction: profile.lockedRedaction,
          mockShots: profile.mockShots,
          inspectShots: profile.inspectShots,
          corruptCanvas: profile.corruptCanvas,
          reconcile: profile.reconcile,
        }),
      env: {
        ...profile.env,
        ...(Object.keys(flags).length > 0 ? { KAIPU_FLAG_OVERRIDES: JSON.stringify(flags) } : {}),
      },
      // The runner has no camera and no audio input; Chromium's synthetic devices stand in.
      extraArgs: [
        "--use-fake-device-for-media-stream",
        // Chromium draws text on a translucent layer (a badge with backdrop-filter, an
        // initials tile) with or without font smoothing depending on compositing history, so
        // two launches shoot the same glyphs with different weight (delta up to 169).
        "--disable-lcd-text",
        ...(profile.neutralBackdrop ? BACKDROP_ARGS : []),
      ],
      disableScreenCapture: profile.disableScreenCapture ?? true,
      launchAppDir: true,
    });
    const { app } = launched;
    const pageErrors: string[] = [];
    const watch = (page: Page): void => {
      page.on("pageerror", (error) =>
        pageErrors.push(scrub(`${page.url().split("/").pop()}: ${error.message}`).slice(0, 400)),
      );
    };
    app.windows().forEach(watch);
    app.on("window", watch);
    const main = await mainPage(app);
    if (profile.neutralBackdrop) await coverDesktop(app);
    if (profile.onboarding === "keep") {
      await waitForArea(main, "onboarding.root", 15_000);
    } else {
      await dismissOnboarding(main);
    }
    record.launched = true;
    record.display = await app.evaluate(({ screen }) => {
      const d = screen.getPrimaryDisplay();
      return { scaleFactor: d.scaleFactor, size: `${d.size.width}×${d.size.height}` };
    });

    const status = (await main.evaluate(async () => ({
      ...(await window.electronAPI.checkPermissions()),
      accessibility: await window.electronAPI.getAccessibilityStatus(),
    }))) as Record<string, boolean | string>;
    record.permissions = status;
    record.rendererFlags = (await main.evaluate(() => ({
      ...window.electronAPI.flagOverrides,
    }))) as Record<string, boolean>;
    const permissions: Record<PermissionName, boolean> = {
      screen: status.screen === true,
      microphone: status.microphone === true,
      camera: status.camera === true,
      accessibility: status.accessibility === "granted",
    };
    log(
      `  permissions ${JSON.stringify(status)}; renderer flags ${JSON.stringify(record.rendererFlags)}`,
    );
    const settings = (await callApi(main, "getRecordingSettings", [])) as Record<string, unknown>;
    const baselineToggles = {
      isMicrophoneEnabled: settings.isMicrophoneEnabled === true,
      isSystemAudioEnabled: settings.isSystemAudioEnabled === true,
      isCameraEnabled: settings.isCameraEnabled === true,
      // An area an overlay take chose must not leak into the next take.
      area: (settings.area ?? null) as unknown,
    };
    // Not connected (the folder is gone): nothing to snapshot, nothing a state can restore.
    vaultSnapshot = path.join(os.tmpdir(), `kaipu-ui-catalog-vault-${process.pid}-${name}`);
    rmSync(vaultSnapshot, { recursive: true, force: true });
    if (existsSync(launched.vaultDir))
      cpSync(launched.vaultDir, vaultSnapshot, { recursive: true });
    const baselineSettings = (await callApi(main, "getSettings", [])) as Record<string, unknown>;
    const run: ProfileRun = {
      app,
      main,
      vaultDir: launched.vaultDir,
      vaultSnapshot,
      name,
      profile,
      permissions,
      baselineToggles,
      baselineSettings,
      pageErrors,
    };

    for (const entry of entries) {
      for (let attempt = 1; attempt <= (TWICE ? 2 : 1); attempt++) {
        const outRoot = attempt === 1 ? OUT_DIR : path.join(OUT_DIR, ".twice");
        const result = await shoot(run, entry, outRoot);
        log(
          `  ${entry.id}${attempt === 2 ? " (second shot)" : ""}: ${result.status}` +
            `${result.reason ? ` — ${result.reason}` : ""} (${result.durationMs} ms)`,
        );
        appendJsonl(STATES_FILE, { attempt, result });
      }
    }
  } catch (error) {
    record.error = scrub(String(error instanceof Error ? error.message : error)).split("\n")[0];
    log(`  profile ${name} failed: ${record.error}`);
  } finally {
    appendJsonl(PROFILES_FILE, record);
    // A state that locked the vault and died before its undo must not stop the teardown from
    // deleting the folder.
    if (launched) {
      try {
        chmodSync(launched.vaultDir, 0o755);
      } catch {
        // The folder is gone (the disconnected profile): nothing to unlock.
      }
    }
    if (launched) {
      await launched.teardown().catch((error) => {
        log(`  quit of profile ${name} failed: ${scrub(String(error)).split("\n")[0]}`);
        appendJsonl(PROFILES_FILE, { ...record, error: `quit: ${String(error).split("\n")[0]}` });
      });
    }
    removeSecondWorkspaceFolder();
    if (vaultSnapshot) rmSync(vaultSnapshot, { recursive: true, force: true });
  }
}

/** The folder `workspaces.create` made in the temp dir (it would make the next run say "exists"). */
function removeSecondWorkspaceFolder(): void {
  rmSync(path.join(os.tmpdir(), SECOND_WORKSPACE.folder), { recursive: true, force: true });
}

for (const name of PROFILE_ORDER) {
  const entries = ENTRIES.filter((e) => e.spec.profile === name);
  if (entries.length === 0) continue;
  test(`profile ${name}`, async () => {
    // Launch, each state (twice under --twice), and the bounded quit.
    test.setTimeout(90_000 + entries.length * (TWICE ? 2 : 1) * 75_000);
    await runProfile(name, entries);
  });
}

// ── Report ─────────────────────────────────────────────────────────────────

function manifestScreens(): ManifestScreen[] {
  const ran = new Set(ENTRIES.map((e) => e.id));
  return (Object.entries(SCREENS) as [ScreenId, ScreenSpec][])
    .filter(([, s]) => "areas" in s)
    .map(([id, s]) => {
      const cat = CATALOGS.find((c) => c.screen === id);
      const all = cat ? Object.keys(cat.states).map((n) => `${id}/${n}`) : [];
      const where =
        s.kind === "route"
          ? `#${s.route}`
          : s.kind === "window"
            ? `?${s.query}`
            : s.kind === "chrome"
              ? "Around every route; shot over the Record page"
              : "Over the Record page on first launch";
      const preset =
        s.kind === "route" ? presetForPath(s.route) : s.kind === "window" ? null : "main";
      return {
        id,
        kind: s.kind,
        where,
        windowSize: preset
          ? `${WINDOW_SIZES[WINDOW_SIZE_OF_PRESET[preset]].width}×${WINDOW_SIZES[WINDOW_SIZE_OF_PRESET[preset]].height}`
          : null,
        areas: screenAreas(id).map((area) => ({
          id: area,
          states: [...areaStates(area)],
          gates: areaGates(area).map(gateLabel),
        })),
        notCapturable: Object.fromEntries(
          Object.entries(cat?.notCapturable ?? {}).map(([claim, d]) => [
            claim,
            (d as NotCapturable).why,
          ]),
        ),
        notCapturableKinds: Object.fromEntries(
          Object.entries(cat?.notCapturable ?? {}).map(([claim, d]) => [
            claim,
            (d as NotCapturable).kind,
          ]),
        ),
        oneSided: { ...cat?.oneSided } as Record<string, string>,
        complete: all.length > 0 && all.every((stateId) => ran.has(stateId)),
        covered: screenAreas(id).every((area) =>
          areaStates(area).every((st) => {
            const claim = `${area}:${st}`;
            return (
              claim in (cat?.notCapturable ?? {}) ||
              flattenCatalog(cat ? [cat] : []).some((e) =>
                (e.spec.demonstrates as readonly string[]).includes(claim),
              )
            );
          }),
        ),
        notRun: [
          ...new Set(
            flattenCatalog(cat ? [cat] : [])
              .filter((e) => !ran.has(e.id))
              .flatMap((e) => e.spec.demonstrates as readonly string[]),
          ),
        ],
      };
    });
}

/** Per screen: a declared area found in no shot state fails the run (spec failure 5). */
function missingAreas(screens: ManifestScreen[], states: ManifestState[]): string[] {
  const failures: string[] = [];
  // Only where the catalog is finished: a screen still being catalogued has areas no state
  // reaches yet, and the coverage test already names those.
  for (const screen of screens.filter((s) => s.complete && s.covered)) {
    const mine = states.filter((s) => s.screen === screen.id);
    const shot = mine.filter((s) => s.status === "shot");
    for (const area of screen.areas) {
      if (shot.some((s) => s.areasFound.some((f) => f.id === area.id))) continue;
      // Excused only when nothing that would show it could be shot this run: every state of
      // it is declared not capturable, or every catalog state claiming it was not capturable.
      const claiming = mine.filter((s) => s.demonstrates.some((d) => d.startsWith(`${area.id}:`)));
      const allDeclared = area.states.every((st) => `${area.id}:${st}` in screen.notCapturable);
      const allRuntime = claiming.length > 0 && claiming.every((s) => s.status === "notCapturable");
      if (allDeclared || allRuntime) continue;
      failures.push(`${screen.id}: area ${area.id} was found in no state of its screen`);
    }
  }
  return failures;
}

function appBuiltAt(): string | null {
  const entry = path.join(APP_ROOT, "out", "main", "index.js");
  return existsSync(entry) ? statSync(entry).mtime.toISOString() : null;
}

function macosVersion(): string {
  try {
    return execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).trim();
  } catch {
    return os.release();
  }
}

test("report", async () => {
  const lines = readJsonl<{ attempt: number; result: ManifestState }>(STATES_FILE);
  const states = lines.filter((l) => l.attempt === 1).map((l) => l.result);
  const second = new Map(lines.filter((l) => l.attempt === 2).map((l) => [l.result.id, l.result]));
  const profiles = readJsonl<ManifestProfile>(PROFILES_FILE);
  const screens = manifestScreens();

  const failures: string[] = [];
  for (const p of profiles) if (p.error) failures.push(`profile ${p.name}: ${p.error}`);
  for (const s of states) if (s.status === "failed") failures.push(`${s.id}: ${s.reason}`);
  failures.push(...missingAreas(screens, states));
  const ranIds = new Set(states.map((s) => s.id));
  for (const e of ENTRIES)
    if (!ranIds.has(e.id)) failures.push(`${e.id}: never ran (its profile did not launch)`);

  const nondeterministic: string[] = [];
  const twiceCounts = { identical: 0, noise: 0, differs: 0, knownVariable: 0 };
  for (const first of states) {
    const again = second.get(first.id);
    if (!again) {
      // The profile died between the two shots (or the second never ran): not a comparison.
      if (TWICE && first.status === "shot") nondeterministic.push(`${first.id}: no second shot`);
      continue;
    }
    // The second shot is a run of its own: a state that shot once and failed (or was lost,
    // or lost an area) the second time is nondeterministic, whatever its crops look like.
    if (again.status !== first.status) {
      nondeterministic.push(
        `${first.id}: first shot ${first.status}, second ${again.status}` +
          `${again.reason ? ` (${again.reason})` : ""}`,
      );
      continue;
    }
    const firstAreas = first.areasFound.map((a) => a.id);
    const secondAreas = again.areasFound.map((a) => a.id);
    const lost = firstAreas.filter((id) => !secondAreas.includes(id));
    const gained = secondAreas.filter((id) => !firstAreas.includes(id));
    if (lost.length > 0 || gained.length > 0) {
      nondeterministic.push(
        `${first.id}: areas differ between the shots` +
          `${lost.length > 0 ? `; only in the first: ${lost.join(", ")}` : ""}` +
          `${gained.length > 0 ? `; only in the second: ${gained.join(", ")}` : ""}`,
      );
    }
    for (const area of first.areasFound) {
      const other = again.areasFound.find((a) => a.id === area.id);
      if (!other) continue;
      if (other.sha256 === area.sha256) {
        twiceCounts.identical += 1;
        continue;
      }
      if (isKnownVariable(KNOWN_VARIABLE, first.id, area.id)) {
        twiceCounts.knownVariable += 1;
        continue;
      }
      const result = compareShots(
        path.join(OUT_DIR, area.file),
        path.join(OUT_DIR, ".twice", other.file),
      );
      if (result.kind === "noise") {
        twiceCounts.noise += 1;
      } else {
        twiceCounts.differs += 1;
        nondeterministic.push(`${first.id} ${area.id}: ${describeDifference(result)}`);
      }
    }
  }

  // A nondeterministic state fails the run: its image cannot be trusted to be the same twice.
  for (const n of nondeterministic) failures.push(`nondeterministic ${n}`);

  const version = JSON.parse(readFileSync(path.join(APP_ROOT, "package.json"), "utf8")).version;
  const dirty = git(["status", "--porcelain", "--untracked-files=no"]).length > 0;
  const display = profiles.find((p) => p.display)?.display ?? null;
  const manifest: Manifest = {
    manifestVersion: MANIFEST_VERSION,
    app: {
      name: "kaipu-record",
      version,
      sha: SHA,
      shortSha: SHORT_SHA,
      dirty,
      builtAt: appBuiltAt(),
    },
    generatedAt: new Date(STARTED_AT).toISOString(),
    runner: {
      label: process.env[RUN_ENV.runnerLabel] || "macmini",
      macos: macosVersion(),
      scaleFactor: display?.scaleFactor ?? null,
      display: display?.size ?? null,
    },
    options: { only: ONLY ?? null, twice: TWICE },
    profiles,
    screens,
    states,
    knownVariable: KNOWN_VARIABLE,
    nondeterministic,
    failures,
    nativeNotCapturable: NATIVE_NOT_CAPTURABLE,
  };
  writeFileSync(path.join(OUT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(path.join(OUT_DIR, "README.md"), renderReadme(manifest));

  const shot = states.filter((s) => s.status === "shot").length;
  const notCapturable = states.filter((s) => s.status === "notCapturable");
  log(
    `report: ${shot} shot, ${notCapturable.length} not capturable, ${failures.length} failure(s)`,
  );
  for (const s of notCapturable) log(`  not capturable ${s.id}: ${s.reason}`);
  if (TWICE) {
    log(
      `twice: ${twiceCounts.identical} crops identical, ${twiceCounts.noise} noise-only, ` +
        `${twiceCounts.differs} differ, ${twiceCounts.knownVariable} known-variable and differing; ` +
        `${nondeterministic.length} nondeterministic in all (each fails the run)`,
    );
  }
  for (const n of nondeterministic) log(`  differs between two shots: ${n}`);
  for (const f of failures) log(`  FAIL ${f}`);
  if (failures.length > 0)
    throw new Error(`ui-catalog: ${failures.length} failure(s):\n${failures.join("\n")}`);
});
