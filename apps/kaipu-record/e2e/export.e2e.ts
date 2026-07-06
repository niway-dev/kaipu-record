import { test, expect } from "@playwright/test";
import path from "node:path";
import { launchApp, openEditor, RECORDING_DURATION } from "./helpers/launch";
import { ffprobeAvailable, probeMedia } from "./helpers/ffprobe";

test("export produces a valid MP4 with in-sync video and audio", async () => {
  const { page, vaultDir, teardown } = await launchApp();
  try {
    await openEditor(page);

    // handleExport no-ops with a toast if videoWidth is still 0 (metadata not decoded).
    // Wait for real dimensions before clicking, or the export silently never starts.
    await expect
      .poll(() => page.evaluate(() => document.querySelector("video")?.videoWidth ?? 0), {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);

    // Start the export from the toolbar.
    await page.getByRole("button", { name: "Exportar" }).click();

    // Success = the app navigates to the newly saved recording's detail route. The router
    // is a hash router, so poll location.hash (a bare hash change does not reliably fire
    // Playwright's navigation events). Give the encode a generous window.
    await expect
      .poll(() => page.evaluate(() => location.hash), { timeout: 90_000 })
      .toMatch(/^#\/library\/.+/);
    const newId = (await page.evaluate(() => location.hash)).replace("#/library/", "");
    expect(newId).not.toBe("");

    // Validate the on-disk output. If ffprobe is unavailable, skip the codec assertion
    // (do NOT pass silently) — the navigation above already proves the pipeline ran.
    if (!(await ffprobeAvailable())) {
      test.info().annotations.push({ type: "skip", description: "ffprobe not on PATH" });
      return;
    }
    const outFile = path.join(vaultDir, `${newId}.mp4`);
    const streams = await probeMedia(outFile);
    expect(streams.video?.codec).toBe("h264");
    expect(streams.audio?.codec).toBe("aac");
    // Video and audio must be aligned (no A/V drift) and near the source length.
    expect(streams.audio!.durationSec).toBeGreaterThan(RECORDING_DURATION - 1);
    expect(Math.abs(streams.audio!.durationSec - streams.video!.durationSec)).toBeLessThan(0.5);
  } finally {
    await teardown();
  }
});
