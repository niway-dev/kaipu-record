import { test, expect } from "@playwright/test";
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
