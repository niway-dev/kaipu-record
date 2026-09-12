import { test, expect } from "@playwright/test";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { launchApp, localIdForAssetId, openEditor, RECORDING_DURATION } from "./helpers/launch";
import { ffprobeAvailable, probeMedia } from "./helpers/ffprobe";

test("export produces a valid MP4 with in-sync video and audio", async () => {
  // The export encodes H.264 + AAC via WebCodecs (mediabunny). Headless Linux CI runners
  // (GitHub `ubuntu-latest`) have no working WebCodecs H.264 encoder — the export throws at
  // runtime ("No pudimos exportar el video"), confirmed empirically. `isConfigSupported`
  // there falsely reports support, so we gate on the environment, not the config. Skip
  // visibly (never a silent pass); the export runs in full on macOS/dev machines, where the
  // regression it guards was fixed. The `corsEnabled` + Range fixes stay guarded in CI by the
  // playback Range-fetch test (that cross-origin fetch requires `corsEnabled`).
  test.skip(
    process.platform === "linux" && !!process.env.CI,
    "WebCodecs H.264/AAC encoding unavailable on headless Linux CI",
  );

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
    await page.getByRole("button", { name: "Export" }).click();

    // Success = the app navigates to the newly saved recording's detail route. The router
    // is a hash router, so poll location.hash (a bare hash change does not reliably fire
    // Playwright's navigation events). Give the encode a generous window.
    await expect
      .poll(() => page.evaluate(() => location.hash), { timeout: 90_000 })
      .toMatch(/^#\/library\/.+/);
    const newAssetId = (await page.evaluate(() => location.hash)).replace("#/library/", "");
    expect(newAssetId).not.toBe("");
    // The route carries the asset id; the vault names its files after the local id, so resolve
    // one to the other before asserting on disk.
    const newId = await localIdForAssetId(vaultDir, newAssetId);

    // Regression guard (PR-A): the edited recording must get a poster thumbnail.
    // The previous <video>-seek capture always resolved null — no `.kaipu/<id>.jpg`
    // was ever written — so every edit landed with a generic film-strip icon. This
    // exercises the real mediabunny decode (the jsdom unit tests can only mock it).
    const posterPath = path.join(vaultDir, ".kaipu", `${newId}.jpg`);
    const poster = await readFile(posterPath);
    expect(poster.byteLength).toBeGreaterThan(0);

    // The edited title's suffix is localized (the UI locale is seeded to English),
    // not the hardcoded Spanish "(editado)".
    const meta = JSON.parse(
      await readFile(path.join(vaultDir, ".kaipu", `${newId}.json`), "utf-8"),
    ) as { title: string };
    expect(meta.title).toMatch(/\(edited\)$/);

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
