import { test, expect, type ElectronApplication, type Page } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { launchApp, openScreenshotEditor, SCREENSHOT_ID } from "./helpers/launch";

// PNG signature — the first 8 bytes of every valid PNG file.
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function pngFiles(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((f) => f.endsWith(".png"));
}

test("editing a screenshot and saving writes a valid PNG to the vault", async () => {
  const { page, vaultDir, teardown } = await launchApp();
  try {
    // Only the seeded screenshot exists to start with.
    const before = await pngFiles(vaultDir);
    expect(before).toEqual([`${SCREENSHOT_ID}.png`]);

    await openScreenshotEditor(page);

    // Save is disabled until the source image has decoded (imageReady).
    const saveButton = page.getByRole("button", { name: /^Save/ });
    await expect(saveButton).toBeEnabled({ timeout: 15_000 });

    // Opening a screenshot from the library carries its existing vault id, so Save asks
    // whether to overwrite the original or branch a copy. Choose "Save copy" to get an
    // unambiguous new file. Either path runs the canvas→PNG export (compositeScene →
    // <canvas>.toBlob("image/png")) — the reason this flow is headless-testable, unlike the
    // WebCodecs H.264 video export.
    await saveButton.click();
    await page.getByRole("button", { name: "Save copy" }).click();

    // Assert at the deterministic boundary: a new PNG lands in the vault (poll, rather than
    // the transient "Saved" toast).
    await expect
      .poll(async () => (await pngFiles(vaultDir)).length, { timeout: 15_000 })
      .toBe(before.length + 1);

    const [newPng] = (await pngFiles(vaultDir)).filter((f) => !before.includes(f));
    expect(newPng).toBeTruthy();

    // The saved file must be a real, non-empty PNG.
    const bytes = await readFile(path.join(vaultDir, newPng!));
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
  } finally {
    await teardown();
  }
});

/** Everything a resize of the toolbar could break, measured in the renderer. */
interface ToolbarLayout {
  /** `data-compact` on the row: "true" once the action labels have been dropped. */
  compact: string | null;
  /** The toolbar's own scroll width exceeds its box — a control ran past the edge. */
  overflows: boolean;
  /** Pairs of controls whose boxes intersect. */
  overlaps: string[];
  /** Controls whose box pokes outside the toolbar's box. */
  outside: string[];
  /** Greatest vertical distance between control centres — > 0 means a second row. */
  rowSpread: number;
}

async function measureToolbar(page: Page): Promise<ToolbarLayout> {
  return page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>('[role="toolbar"]');
    if (!bar) throw new Error("editor toolbar not found");
    const controls = [...bar.querySelectorAll<HTMLElement>("button")];
    const name = (el: HTMLElement): string =>
      el.getAttribute("aria-label") ?? el.title ?? el.textContent?.trim() ?? "?";
    const rects = controls.map((el) => el.getBoundingClientRect());
    const box = bar.getBoundingClientRect();
    const overlaps: string[] = [];
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!;
        const b = rects[j]!;
        const apart =
          a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
        if (!apart) overlaps.push(`${name(controls[i]!)} × ${name(controls[j]!)}`);
      }
    }
    const outside = controls
      .filter((_, i) => rects[i]!.left < box.left || rects[i]!.right > box.right)
      .map(name);
    const centres = rects.map((r) => r.top + r.height / 2);
    return {
      compact: bar.getAttribute("data-compact"),
      overflows: bar.scrollWidth > bar.clientWidth,
      overlaps,
      outside,
      rowSpread: Math.round(Math.max(...centres) - Math.min(...centres)),
    };
  });
}

/**
 * Resize the editor's own window (`app.browserWindow(page)` — the capture panel is a
 * BrowserWindow too, so "the first window" is not reliably this one). `belowFloor`
 * clears the minimum size first, to reach a width the app itself would refuse.
 */
async function resizeWindow(
  app: ElectronApplication,
  page: Page,
  width: number,
  { belowFloor = false } = {},
): Promise<void> {
  const win = await app.browserWindow(page);
  await win.evaluate(
    (w: Electron.BrowserWindow, args: { width: number; belowFloor: boolean }) => {
      if (args.belowFloor) w.setMinimumSize(0, 0);
      const [, height] = w.getContentSize();
      w.setContentSize(args.width, height);
    },
    { width, belowFloor },
  );
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width);
}

const ONE_CLEAN_ROW = { overflows: false, overlaps: [], outside: [], rowSpread: 0 };

// The window the editor lives in: WINDOW_PRESETS.main (shared/window-size.ts) names 1040
// as its starting width and 900 as the floor the window refuses to shrink below. Both
// must hold one clean row, and with room to spare the action labels stay.
for (const width of [1040, 900]) {
  test(`the editor toolbar keeps one row, labels on, at ${width}px`, async () => {
    const { app, page, teardown } = await launchApp();
    try {
      await openScreenshotEditor(page);
      await resizeWindow(app, page, width);
      expect(await measureToolbar(page)).toEqual<ToolbarLayout>({
        ...ONE_CLEAN_ROW,
        compact: "false",
      });
      await expect(page.getByRole("toolbar").getByText("Save", { exact: true })).toBeVisible();
    } finally {
      await teardown();
    }
  });
}

// Narrower than the app allows — a display too small for the floor, or a control added
// later — the row gives up the action labels rather than overlapping.
test("below the window floor the editor toolbar drops the action labels instead of overlapping", async () => {
  const { app, page, teardown } = await launchApp();
  try {
    await openScreenshotEditor(page);
    await resizeWindow(app, page, 680, { belowFloor: true });
    expect(await measureToolbar(page)).toEqual<ToolbarLayout>({
      ...ONE_CLEAN_ROW,
      compact: "true",
    });
    const save = page.getByRole("button", { name: "Save", exact: true });
    await expect(save).toBeVisible();
    await expect(save.getByText("Save")).toBeHidden();
  } finally {
    await teardown();
  }
});
