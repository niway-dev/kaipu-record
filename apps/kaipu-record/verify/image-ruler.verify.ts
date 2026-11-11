import { test, expect, type Locator } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { dismissOnboarding, SCREENSHOT_ASSET_ID } from "../e2e/helpers/launch";
import { startScenario, type Scenario } from "./helpers";

// image-ruler (NIW2-702): Inspect's ruler in the real app. The fixture is generated here with
// known geometry, so every expected length is exact: a 240x120 blue fill with a 2 px black
// border on a white 1200x800 image. Run for `image-canvas` off and on; every reading goes into
// results.json and only the assertions below fail the run.

const SCENARIO = "image-ruler";
const W = 1200;
const H = 800;
const FILL = { x: 500, y: 300, w: 240, h: 120 };
const BORDER = 2;
const BLUE: [number, number, number] = [40, 90, 200];
const EXPECT = { inner: { x: 240, y: 120 }, outer: { x: 244, y: 124 } };

const FLAGS = (canvas: boolean): Record<string, string> => ({
  // Pinned explicitly: an inherited `KAIPU_FLAG_OVERRIDES` must not change a side.
  KAIPU_FLAG_OVERRIDES: JSON.stringify({ "image-inspect": true, "image-canvas": canvas }),
});

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** White W x H RGB PNG with a BLUE fill inside a black BORDER-px frame. Deterministic. */
function makeFixturePng(): Buffer {
  const raw = Buffer.alloc((W * 3 + 1) * H, 255);
  for (let y = 0; y < H; y++) {
    const row = y * (W * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < W; x++) {
      const inFill = x >= FILL.x && x < FILL.x + FILL.w && y >= FILL.y && y < FILL.y + FILL.h;
      const inFrame =
        x >= FILL.x - BORDER &&
        x < FILL.x + FILL.w + BORDER &&
        y >= FILL.y - BORDER &&
        y < FILL.y + FILL.h + BORDER;
      const c = inFill ? BLUE : inFrame ? [0, 0, 0] : null;
      if (c) for (let k = 0; k < 3; k++) raw[row + 1 + x * 3 + k] = c[k]!;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function seedVault(vaultDir: string): Promise<void> {
  await mkdir(path.join(vaultDir, ".kaipu"), { recursive: true });
  await writeFile(path.join(vaultDir, "ruler-fixture.png"), makeFixturePng());
  await writeFile(
    path.join(vaultDir, ".kaipu", "ruler-fixture.json"),
    JSON.stringify({
      sidecarVersion: 2,
      assetId: SCREENSHOT_ASSET_ID,
      title: "Ruler fixture",
      createdAt: 1_700_000_000_000,
    }),
  );
}

async function openImageEditor(s: Scenario): Promise<void> {
  await dismissOnboarding(s.page);
  await s.page.evaluate((id) => (location.hash = `#/editor/image/${id}`), SCREENSHOT_ASSET_ID);
  await expect(s.page.getByRole("button", { name: /^Save/ })).toBeEnabled({ timeout: 15_000 });
}

const imgLocator = (s: Scenario): Locator =>
  s.page.locator('[data-ui-area="editorImage.canvas"] img').first();
const label = (s: Scenario): Locator => s.page.getByTestId("inspect-ruler-length");

async function png(s: Scenario, name: string): Promise<void> {
  await s.page.screenshot({ path: path.join(s.outDir, `${name}.png`) });
}

/** Client point of the centre of image pixel (px, py), from the shown `<img>`'s box. */
async function pixelPoint(img: Locator, px: number, py: number): Promise<{ x: number; y: number }> {
  return img.evaluate(
    (el, p) => {
      const i = el as HTMLImageElement;
      const r = i.getBoundingClientRect();
      return {
        x: r.left + ((p.px + 0.5) * r.width) / i.naturalWidth,
        y: r.top + ((p.py + 0.5) * r.height) / i.naturalHeight,
      };
    },
    { px, py },
  );
}

async function hoverPixel(s: Scenario, px: number, py: number): Promise<{ x: number; y: number }> {
  const p = await pixelPoint(imgLocator(s), px, py);
  await s.page.mouse.move(p.x - 4, p.y - 4);
  await s.page.mouse.move(p.x, p.y, { steps: 2 });
  return p;
}

/** Make `axis` the ruler's axis (the keys toggle, so press only when it is not already). */
async function ensureAxis(s: Scenario, axis: "x" | "y"): Promise<void> {
  const layer = s.page.getByTestId("inspect-layer");
  if ((await layer.getAttribute("data-ruler")) !== axis)
    await s.page.keyboard.press(axis === "x" ? "1" : "2");
  await expect(layer).toHaveAttribute("data-ruler", axis);
}

async function readLabel(s: Scenario, text: string): Promise<string> {
  // A mismatch is recorded by the caller; this only waits for a value to settle.
  try {
    await expect(label(s)).toHaveText(text, { timeout: 8_000 });
  } catch {
    /* fall through to the actual value */
  }
  return label(s)
    .innerText({ timeout: 2_000 })
    .then((t) => t.trim())
    .catch(() => "(no label)");
}

const results: Record<string, unknown> = {};
const failures: string[] = [];

async function rulerRun(canvas: boolean): Promise<void> {
  const run = `canvas-${canvas ? "on" : "off"}`;
  const r: Record<string, unknown> = {};
  results[run] = r;
  const check = (name: string, actual: unknown, expected: unknown): void => {
    r[name] = { actual, expected, pass: actual === expected };
    if (actual !== expected)
      failures.push(
        `${run} ${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
      );
  };
  const s = await startScenario(SCENARIO, {
    env: FLAGS(canvas),
    keepOutput: true,
    videoName: `video-${run}`,
    seedVault,
  });
  try {
    await openImageEditor(s);
    const img = imgLocator(s);
    await expect(img).toBeVisible();
    await expect
      .poll(() => img.evaluate((e) => (e as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    r.natural = await img.evaluate((e) => [
      (e as HTMLImageElement).naturalWidth,
      (e as HTMLImageElement).naturalHeight,
    ]);
    r.windowSize = s.page.viewportSize();
    r.imgBox = await img.boundingBox();

    const toggle = s.page.getByRole("button", { name: /^Inspect/ });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(s.page.locator('[data-ui-area="editorImage.inspectRuler"]')).toBeVisible();

    const cx = FILL.x + FILL.w / 2;
    const cy = FILL.y + FILL.h / 2;

    // Margin: a point inside the canvas area but outside the shown image, if any is visible.
    const margin = await img.evaluate((el) => {
      const i = el as HTMLImageElement;
      const ir = i.getBoundingClientRect();
      const host = i.closest('[data-ui-area="editorImage.canvas"]')!.getBoundingClientRect();
      const gaps = [
        { name: "left", w: ir.left - host.left, pt: [ir.left - 6, ir.top + ir.height / 2] },
        { name: "right", w: host.right - ir.right, pt: [ir.right + 6, ir.top + ir.height / 2] },
        { name: "top", w: ir.top - host.top, pt: [ir.left + ir.width / 2, ir.top - 6] },
        { name: "bottom", w: host.bottom - ir.bottom, pt: [ir.left + ir.width / 2, ir.bottom + 6] },
      ];
      const g = gaps.sort((a, b) => b.w - a.w)[0]!;
      return g.w > 12 ? { side: g.name, x: g.pt[0]!, y: g.pt[1]!, gap: g.w } : null;
    });
    r.margin = margin;
    if (margin) {
      await s.page.mouse.move(margin.x - 3, margin.y - 3);
      await s.page.mouse.move(margin.x, margin.y, { steps: 2 });
      await s.page.keyboard.press("1");
      await s.page.waitForTimeout(800);
      check("marginLabelCount", await label(s).count(), 0);
      await s.page.keyboard.press("1"); // hide again
      await expect(s.page.getByTestId("inspect-layer")).toHaveAttribute("data-ruler", "off");
    }

    // Horizontal run, inner then outer.
    await hoverPixel(s, cx, cy);
    await ensureAxis(s, "x");
    check("x-inner", await readLabel(s, `${EXPECT.inner.x} px`), `${EXPECT.inner.x} px`);
    await png(s, `${run}-a-run-x`);
    await s.page.keyboard.down("Shift");
    check("x-outer-shift", await readLabel(s, `${EXPECT.outer.x} px`), `${EXPECT.outer.x} px`);
    r.xOuterAttr = await label(s).getAttribute("data-outer");
    await png(s, `${run}-b-outer-x`);
    await s.page.keyboard.up("Shift");
    check("x-back-to-inner", await readLabel(s, `${EXPECT.inner.x} px`), `${EXPECT.inner.x} px`);

    // Vertical run.
    await ensureAxis(s, "y");
    check("y-inner", await readLabel(s, `${EXPECT.inner.y} px`), `${EXPECT.inner.y} px`);
    r.yAxisAttr = await label(s).getAttribute("data-axis");
    await s.page.keyboard.down("Shift");
    check("y-outer-shift", await readLabel(s, `${EXPECT.outer.y} px`), `${EXPECT.outer.y} px`);
    await png(s, `${run}-b2-outer-y`);
    await s.page.keyboard.up("Shift");
    await readLabel(s, `${EXPECT.inner.y} px`);

    // Tolerance: the default and the wheel (plain wheel over the canvas, run shown).
    const tol = s.page.getByTestId("inspect-tolerance");
    r.toleranceDefault = (await tol.innerText()).trim();
    const p = await pixelPoint(img, cx, cy);
    await s.page.mouse.move(p.x, p.y);
    await s.page.mouse.wheel(0, -50);
    await s.page.waitForTimeout(300);
    r.toleranceAfterWheelUp50 = (await tol.innerText()).trim();
    await s.page.mouse.wheel(0, 50);
    await s.page.waitForTimeout(300);
    r.toleranceAfterWheelDown50 = (await tol.innerText()).trim();
    check("tolerance-wheel-up", r.toleranceAfterWheelUp50, "12");
    check("tolerance-wheel-down", r.toleranceAfterWheelDown50, "10");

    // Pin the horizontal run with a click.
    await ensureAxis(s, "x");
    await readLabel(s, `${EXPECT.inner.x} px`);
    const pin = await hoverPixel(s, cx, cy);
    await ensureAxis(s, "x");
    await readLabel(s, `${EXPECT.inner.x} px`);
    await s.page.mouse.click(pin.x, pin.y);
    const measure = s.page.locator('[data-kind="measure"]');
    await expect(measure).toHaveCount(1, { timeout: 5_000 });
    check("pinned-length", await measure.first().getAttribute("data-measure-length"), "240");

    // Leave Inspect and select the measure with the Select tool.
    await s.page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await measure.first().click({ force: true });
    await s.page.waitForTimeout(300);
    // Selected = its two endpoint handles are drawn (nothing was selected before the click).
    check("measure-selected-handles", await s.page.getByTestId("resize-handle").count(), 2);
    await png(s, `${run}-c-pinned-selected`);

    // Zoom in and measure the same fill again: still image pixels.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    const zoomIn = s.page.getByRole("button", { name: "Zoom in", exact: true });
    const before = await img.boundingBox();
    await zoomIn.click();
    await zoomIn.click();
    await s.page.waitForTimeout(400);
    const after = await img.boundingBox();
    r.zoom = { widthBefore: before?.width, widthAfter: after?.width };
    if (!after || !before || after.width <= before.width)
      failures.push(`${run}: image did not grow after Zoom in`);
    // The fill may be partly off screen when zoomed; hover its centre if it is visible.
    await hoverPixel(s, cx, cy);
    await ensureAxis(s, "x");
    check("zoomed-x-inner", await readLabel(s, `${EXPECT.inner.x} px`), `${EXPECT.inner.x} px`);
    await png(s, `${run}-d-zoomed-run-x`);
    await ensureAxis(s, "y");
    check("zoomed-y-inner", await readLabel(s, `${EXPECT.inner.y} px`), `${EXPECT.inner.y} px`);
    await s.page.keyboard.down("Shift");
    check("zoomed-y-outer", await readLabel(s, `${EXPECT.outer.y} px`), `${EXPECT.outer.y} px`);
    await s.page.keyboard.up("Shift");
    // Pin again while zoomed.
    await readLabel(s, `${EXPECT.inner.y} px`);
    const pin2 = await hoverPixel(s, cx, cy);
    await ensureAxis(s, "y");
    await readLabel(s, `${EXPECT.inner.y} px`);
    await s.page.mouse.click(pin2.x, pin2.y);
    await expect(measure).toHaveCount(2, { timeout: 5_000 });
    check("zoomed-pinned-length", await measure.last().getAttribute("data-measure-length"), "120");
    await s.page.keyboard.press("Escape");
  } finally {
    await s.finish();
  }
}

test("image-ruler: run lengths, outer, zoom and pin, canvas off and on", async () => {
  test.setTimeout(600_000);
  const outDir = path.resolve(__dirname, "..", "test-results", "verify", SCENARIO);
  await mkdir(outDir, { recursive: true });
  try {
    await rulerRun(false);
    await rulerRun(true);
  } finally {
    // Readings survive a thrown expect.
    await writeFile(
      path.join(outDir, "results.json"),
      JSON.stringify({ expected: EXPECT, fill: FILL, results, failures }, null, 2),
    );
    console.log(`[verify] image-ruler: ${JSON.stringify({ failures })}`);
  }
  expect(failures, failures.join("\n")).toEqual([]);
});
