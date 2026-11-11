import { test, expect, type Locator } from "@playwright/test";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dismissOnboarding, SCREENSHOT_ASSET_ID } from "../e2e/helpers/launch";
import { startScenario, type Scenario } from "./helpers";

// image-inspect (NIW2-699): hover a known swatch in the real app and compare the chip with the
// swatch's known sRGB value. Fixtures come from the M0 spike (scripts/spikes/image-editor-m0):
// sRGB swatches tagged sRGB, Display P3 swatches tagged P3, and the sRGB swatches converted into
// a monitor profile. Every swatch goes into results.json; only the assertions listed in the
// test fail the run.

const FIXTURE_DIR = path.join(__dirname, "fixtures", "inspect");
const SCENARIO = "image-inspect";
const HUD = '[data-ui-area="editorImage.inspectHud"]';
const FLAGS = (inspect: boolean, canvas: boolean): Record<string, string> => ({
  // Pinned explicitly: an inherited `KAIPU_FLAG_OVERRIDES` must not change a side.
  KAIPU_FLAG_OVERRIDES: JSON.stringify({ "image-inspect": inspect, "image-canvas": canvas }),
});

type Triple = [number, number, number];
interface Swatch {
  name: string;
  x: number;
  y: number;
  expected: Triple;
  /** Value outside the sRGB gamut: `expected` is the clipped reference, not asserted. */
  outOfGamut: boolean;
  /** Raw P3 or sRGB bytes from the fixture, for failure reports. */
  source: { p3?: number[]; srgb?: number[] };
}
interface FixtureDef {
  id: "srgb" | "p3" | "monitor";
  file: string;
  /** Max per-channel delta that fails the run; null = record only. */
  tolerance: number | null;
}
const FIXTURES: FixtureDef[] = [
  { id: "srgb", file: "srgb-swatches", tolerance: 0 },
  { id: "p3", file: "p3-swatches", tolerance: 1 },
  { id: "monitor", file: "monitor-profile-swatches", tolerance: null },
];

// CSS Color 4 reference: Display P3 8-bit -> linear -> XYZ D65 -> linear sRGB -> sRGB 8-bit.
const P3_TO_XYZ = [
  [0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
  [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
  [0.0, 0.04511338185890264, 1.043944368900976],
];
const XYZ_TO_SRGB = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];
const toLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const toGamma = (c: number): number =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
const mul = (m: number[][], v: number[]): number[] =>
  m.map((r) => r[0]! * v[0]! + r[1]! * v[1]! + r[2]! * v[2]!);
const clamp01 = (c: number): number => Math.min(1, Math.max(0, c));
function p3ToSrgb(p3: number[]): Triple {
  const lin = mul(
    XYZ_TO_SRGB,
    mul(
      P3_TO_XYZ,
      p3.map((v) => toLinear(v / 255)),
    ),
  );
  return lin.map((c) => Math.round(toGamma(clamp01(c)) * 255)) as Triple;
}

async function loadSwatches(def: FixtureDef): Promise<Swatch[]> {
  const doc = JSON.parse(await readFile(path.join(FIXTURE_DIR, `${def.file}.json`), "utf-8")) as {
    swatches: {
      name: string;
      x: number;
      y: number;
      srgb?: number[];
      p3?: number[];
      outOfSrgbGamut?: boolean;
    }[];
  };
  return doc.swatches.map((s) => ({
    name: s.name,
    x: s.x,
    y: s.y,
    expected: (s.srgb ?? p3ToSrgb(s.p3 ?? [0, 0, 0])) as Triple,
    outOfGamut: s.outOfSrgbGamut === true,
    source: { p3: s.p3, srgb: s.srgb },
  }));
}

const toHex = (t: Triple): string => `#${t.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
function parseHex(text: string): Triple | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(text.trim());
  return m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : null;
}

interface SwatchResult {
  run: string;
  fixture: string;
  canvas: boolean;
  swatch: string;
  pixel: string;
  expectedHex: string;
  read: string | null;
  delta: Triple | null;
  maxDelta: number | null;
  outOfGamut: boolean;
  outOfSrgbMark: boolean;
  pass: boolean | null;
}
const results: SwatchResult[] = [];
const extras: Record<string, unknown> = {};
const failures: string[] = [];

function seedFixture(fixture: FixtureDef) {
  return async (vaultDir: string): Promise<void> => {
    await mkdir(path.join(vaultDir, ".kaipu"), { recursive: true });
    await copyFile(
      path.join(FIXTURE_DIR, `${fixture.file}.png`),
      path.join(vaultDir, "inspect-fixture.png"),
    );
    await writeFile(
      path.join(vaultDir, ".kaipu", "inspect-fixture.json"),
      JSON.stringify({
        sidecarVersion: 2,
        assetId: SCREENSHOT_ASSET_ID,
        title: `Inspect ${fixture.id}`,
        createdAt: 1_700_000_000_000,
      }),
    );
  };
}

async function openImageEditor(s: Scenario): Promise<void> {
  await dismissOnboarding(s.page);
  await s.page.evaluate((id) => (location.hash = `#/editor/image/${id}`), SCREENSHOT_ASSET_ID);
  await expect(s.page.getByRole("button", { name: /^Save/ })).toBeEnabled({ timeout: 15_000 });
}

async function png(s: Scenario, name: string): Promise<void> {
  await s.page.screenshot({ path: path.join(s.outDir, `${name}.png`) });
}

const imgLocator = (s: Scenario): Locator =>
  s.page.locator('[data-ui-area="editorImage.canvas"] img').first();

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

const markLocator = (s: Scenario): Locator => s.page.locator(`${HUD} > span`).nth(1);

/**
 * Whether the "Out of sRGB" mark shows for the hovered pixel, read once the HUD says the
 * captured tile is in (`data-probed`). null when the probe never finished.
 */
async function readMark(s: Scenario): Promise<boolean | null> {
  try {
    await expect(s.page.locator(`${HUD}[data-probed="true"]`)).toBeVisible({ timeout: 5_000 });
  } catch {
    return null;
  }
  return markLocator(s).isVisible();
}

const chipText = (s: Scenario): Locator =>
  s.page.locator(`${HUD} > div:nth-child(2) > span:nth-child(2)`);
const coordsText = (s: Scenario): Locator => s.page.locator(`${HUD} > span`).first();

/** Hover pixel (px, py) and wait until the HUD reports exactly that pixel with a value. */
async function hoverPixel(s: Scenario, img: Locator, px: number, py: number): Promise<string> {
  const p = await pixelPoint(img, px, py);
  await s.page.mouse.move(p.x - 3, p.y - 3);
  await s.page.mouse.move(p.x, p.y, { steps: 2 });
  await expect(coordsText(s)).toHaveText(`${px}, ${py}`, { timeout: 20_000 });
  await expect(chipText(s)).not.toHaveText("…", { timeout: 20_000 });
  return (await chipText(s).innerText()).trim();
}

async function inspectRun(
  fixture: FixtureDef,
  canvas: boolean,
  opts: { keepOutput: boolean; shotsTag: string | null },
): Promise<void> {
  const run = `${fixture.id}-canvas-${canvas ? "on" : "off"}`;
  const swatches = await loadSwatches(fixture);
  const s = await startScenario(SCENARIO, {
    env: FLAGS(true, canvas),
    keepOutput: opts.keepOutput,
    videoName: `video-${run}`,
    seedVault: seedFixture(fixture),
  });
  const tag = opts.shotsTag;
  try {
    await openImageEditor(s);
    const img = imgLocator(s);
    await expect(img).toBeVisible();
    await expect
      .poll(() => img.evaluate((e) => (e as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    const toggle = s.page.getByRole("button", { name: /^Inspect/ });
    await expect(toggle).toBeVisible();
    if (tag) await png(s, `${tag}-a-inspect-off`);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    for (const sw of swatches) {
      const readText = await hoverPixel(s, img, sw.x, sw.y);
      const read = parseHex(readText);
      // Out-of-sRGB mark: final once the pointer rests and the tile is read (data-probed).
      // Out-of-gamut swatches must show it; every other swatch must not.
      const mark = await readMark(s);
      if (fixture.id !== "monitor" && mark !== sw.outOfGamut)
        failures.push(
          `${run} ${sw.name}: out-of-sRGB mark ${mark === null ? "never settled (probe did not finish)" : mark ? "shown" : "missing"} (outOfGamut=${sw.outOfGamut}, pixel ${sw.x}, ${sw.y}, source ${JSON.stringify(sw.source)})`,
        );
      const delta = read ? (read.map((v, i) => v - sw.expected[i]!) as Triple) : null;
      const maxDelta = delta ? Math.max(...delta.map(Math.abs)) : null;
      const asserted = fixture.tolerance !== null && !sw.outOfGamut;
      const pass = asserted ? maxDelta !== null && maxDelta <= fixture.tolerance! : null;
      results.push({
        run,
        fixture: fixture.id,
        canvas,
        swatch: sw.name,
        pixel: `${sw.x}, ${sw.y}`,
        expectedHex: toHex(sw.expected),
        read: readText,
        delta,
        maxDelta,
        outOfGamut: sw.outOfGamut,
        outOfSrgbMark: mark,
        pass,
      });
      if (pass === false)
        failures.push(`${run} ${sw.name}: read ${readText}, expected ${toHex(sw.expected)}`);
    }

    // Pick a reference swatch: #10b981 (sRGB, monitor) or p3-eq-10b981.
    const ref = swatches.find((sw) => sw.name === "#10b981" || sw.name === "p3-eq-10b981")!;
    const oog = swatches.find((sw) => sw.outOfGamut);
    const hud = s.page.locator(HUD);
    const extra: Record<string, unknown> = {};

    // Clipboard: `c` copies exactly what the chip shows.
    const chip = await hoverPixel(s, img, ref.x, ref.y);
    await s.app.evaluate(({ clipboard }) => clipboard.clear());
    await s.page.keyboard.press("c");
    await expect
      .poll(() => s.app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 5_000 })
      .toBe(chip);
    extra.clipboard = {
      chip,
      clipboard: await s.app.evaluate(({ clipboard }) => clipboard.readText()),
    };

    // Formats on the reference swatch.
    const formats: Record<string, string> = {};
    for (const [label, key] of [
      ["HEX", "hex"],
      ["RGB", "rgb"],
      ["HSL", "hsl"],
      ["OKLCH", "oklch"],
    ] as const) {
      await s.page.getByRole("button", { name: label, exact: true }).click();
      await expect(s.page.locator('[data-ui-area="editorImage.inspectBar"]')).toHaveAttribute(
        "data-format",
        key,
      );
      formats[key] = await hoverPixel(s, img, ref.x, ref.y);
      if (tag && key === "rgb") await png(s, `${tag}-rgb-format`);
    }
    extra.formats = formats;
    await s.page.getByRole("button", { name: "HEX", exact: true }).click();

    // Hero shots: HUD over the reference swatch, loupe visible.
    await hoverPixel(s, img, ref.x, ref.y);
    const loupe = s.page.getByTestId("inspect-loupe");
    await expect(loupe).toBeVisible();
    extra.loupe = await loupe.evaluate((el) => {
      const c = el as HTMLCanvasElement;
      const r = c.getBoundingClientRect();
      return {
        canvasPx: [c.width, c.height],
        shownPx: [Math.round(r.width), Math.round(r.height)],
        imageRendering: getComputedStyle(c).imageRendering,
        smoothingAttr: c.dataset.smoothing,
      };
    });
    if (tag) {
      await png(s, `${tag}-b-inspect-on-hud`);
      await hud.screenshot({ path: path.join(s.outDir, `${tag}-c-hud-crop.png`) });
      const dataUrl = await loupe.evaluate((el) =>
        (el as HTMLCanvasElement).toDataURL("image/png"),
      );
      await writeFile(
        path.join(s.outDir, `${tag}-c-loupe-raw-15x15.png`),
        Buffer.from(dataUrl.split(",")[1]!, "base64"),
      );
    }

    // Out-of-sRGB mark on a wide-gamut swatch (screenshot; asserted per swatch above).
    if (oog) {
      await hoverPixel(s, img, oog.x, oog.y);
      const markVisible = (await readMark(s)) === true;
      extra.outOfGamutProbe = {
        swatch: oog.name,
        markVisible,
        chip: (await chipText(s).innerText()).trim(),
      };
      if (tag) await png(s, `${tag}-out-of-srgb`);
    }

    // As captured on the reference swatch.
    const asCaptured = s.page.getByRole("button", { name: "As captured" });
    await asCaptured.click();
    await expect(asCaptured).toHaveAttribute("aria-pressed", "true");
    await hoverPixel(s, img, ref.x, ref.y);
    await expect(chipText(s)).not.toHaveText("…", { timeout: 10_000 });
    extra.asCaptured = {
      swatch: ref.name,
      format: await s.page
        .locator('[data-ui-area="editorImage.inspectBar"]')
        .getAttribute("data-format"),
      chip: (await chipText(s).innerText()).trim(),
    };
    if (tag) await png(s, `${tag}-d-as-captured`);
    await asCaptured.click();

    // Zoom invariance (canvas on): same pixel and same hex after Zoom in twice.
    if (canvas) {
      const before = {
        hex: await hoverPixel(s, img, ref.x, ref.y),
        box: await img.boundingBox(),
      };
      const zoomIn = s.page.getByRole("button", { name: "Zoom in", exact: true });
      await zoomIn.click();
      await zoomIn.click();
      await s.page.waitForTimeout(300);
      const after = await hoverPixel(s, img, ref.x, ref.y);
      const coords = (await coordsText(s).innerText()).trim();
      const afterBox = await img.boundingBox();
      extra.zoom = {
        swatch: ref.name,
        coords,
        chipBefore: before.hex,
        chipAfter: after,
        widthBefore: before.box?.width,
        widthAfter: afterBox?.width,
      };
      if (tag) await png(s, `${tag}-e-zoomed-in-twice`);
      if (after !== before.hex)
        failures.push(`${run}: chip changed after zoom (${before.hex} -> ${after})`);
      if (!afterBox || !before.box || afterBox.width <= before.box.width)
        failures.push(`${run}: image did not grow after Zoom in`);
    }

    // Esc leaves Inspect.
    await s.page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    extras[run] = extra;
  } finally {
    await s.finish();
  }
}

test("image-inspect: swatch readout, formats, copy, as captured, zoom, flag off", async () => {
  test.setTimeout(600_000);

  // Launch 1: flag off. The "before": the same image and no Inspect button.
  const off = await startScenario(SCENARIO, {
    env: FLAGS(false, false),
    videoName: "video-flag-off",
    seedVault: seedFixture(FIXTURES[0]!),
  });
  try {
    await openImageEditor(off);
    await expect(off.page.locator('[data-ui-area="editorImage.canvas"] img').first()).toBeVisible();
    await off.page.waitForTimeout(500);
    const buttons = await off.page.getByRole("button", { name: /^Inspect/ }).count();
    extras["flag-off"] = { inspectButtons: buttons };
    await png(off, "flag-off-editor");
    if (buttons !== 0) failures.push(`flag off: ${buttons} Inspect button(s) rendered`);
  } finally {
    await off.finish();
  }

  try {
    // Launches 2-7: flag on, canvas off and on, one fixture per launch (3 fixtures x 2).
    await inspectRun(FIXTURES[0]!, false, { keepOutput: true, shotsTag: "canvas-off" });
    await inspectRun(FIXTURES[1]!, false, { keepOutput: true, shotsTag: "p3-canvas-off" });
    await inspectRun(FIXTURES[2]!, false, { keepOutput: true, shotsTag: "monitor-canvas-off" });
    await inspectRun(FIXTURES[0]!, true, { keepOutput: true, shotsTag: "canvas-on" });
    await inspectRun(FIXTURES[1]!, true, { keepOutput: true, shotsTag: "p3-canvas-on" });
    await inspectRun(FIXTURES[2]!, true, { keepOutput: true, shotsTag: "monitor-canvas-on" });
  } finally {
    // Readings survive a thrown expect.
    const asserted = results.filter((r) => r.pass !== null);
    const summary = {
      swatchesAsserted: asserted.length,
      swatchesPassed: asserted.filter((r) => r.pass).length,
      maxDeltaByFixture: Object.fromEntries(
        FIXTURES.map((f) => [
          f.id,
          Math.max(
            0,
            ...results
              .filter((r) => r.fixture === f.id && !r.outOfGamut)
              .map((r) => r.maxDelta ?? 99),
          ),
        ]),
      ),
      failures,
    };
    await writeFile(
      path.join(off.outDir, "results.json"),
      JSON.stringify({ summary, extras, swatches: results }, null, 2),
    );
    console.log(`[verify] image-inspect: ${JSON.stringify(summary)}`);
  }
  expect(failures, failures.join("\n")).toEqual([]);
});
