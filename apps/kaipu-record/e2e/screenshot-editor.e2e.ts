import { test, expect } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, PDFName, PDFNumber, PDFRawStream } from "pdf-lib";
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

// PDF signature — the first 5 bytes of every PDF file.
const PDF_MAGIC = Buffer.from("%PDF-");

test("exporting a screenshot as PDF writes a one-page PDF to the chosen path", async () => {
  const { app, page, vaultDir, teardown } = await launchApp();
  try {
    // The export goes through a native save dialog, which no test can drive. Replace
    // it in the main process with a stub that "picks" a path inside the temp vault —
    // everything else (SVG → high-DPI canvas raster → pdf-lib → fs.writeFile) is real.
    const target = path.join(vaultDir, "exported.pdf");
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, target);

    await openScreenshotEditor(page);

    const exportButton = page.getByRole("button", { name: /^PDF/ });
    await expect(exportButton).toBeEnabled({ timeout: 15_000 });
    await exportButton.click();

    // The button flips to "Exported" once the file is on disk.
    await expect(page.getByRole("button", { name: /^Exported/ })).toBeVisible({
      timeout: 30_000,
    });

    const bytes = await readFile(target);
    expect(bytes.subarray(0, 5).equals(PDF_MAGIC)).toBe(true);
    // One page sized to the fixture's 1× pixels in points (320×240, re-opened shots are
    // unframed) — no paper pagination.
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getSize()).toEqual({ width: 320, height: 240 });
    // The raster inside is the high-DPI one: 3× the page, which is what makes the page
    // zoomable. (Two image XObjects: the bitmap and its alpha SMask — both at 3×.)
    const imageWidths = doc.context
      .enumerateIndirectObjects()
      .map(([, obj]) => obj)
      .filter((obj): obj is PDFRawStream => obj instanceof PDFRawStream)
      .filter((stream) => stream.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"))
      .map((stream) => (stream.dict.get(PDFName.of("Width")) as PDFNumber).asNumber());
    expect(imageWidths.length).toBeGreaterThan(0);
    expect(imageWidths.every((w) => w === 320 * 3)).toBe(true);
    // An export is not a library save: the vault still holds only the seeded PNG.
    expect(await pngFiles(vaultDir)).toEqual([`${SCREENSHOT_ID}.png`]);
  } finally {
    await teardown();
  }
});
