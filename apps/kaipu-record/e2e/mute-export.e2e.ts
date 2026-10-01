import { test, expect } from "@playwright/test";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import {
  launchApp,
  localIdForAssetId,
  openEditor,
  RECORDING_DURATION,
  RECORDING_ID,
} from "./helpers/launch";
import { ffprobeAvailable, probeMedia } from "./helpers/ffprobe";

/**
 * Muting the whole video must produce a file with NO audio track, not a silent
 * one. That distinction is the reason `audioMuted` is its own flag rather than a
 * range covering everything, and it is invisible to a unit test: only a real
 * encode and a real probe can tell "no stream" from "a stream of zeros".
 *
 * The session is seeded on disk rather than driven through the UI, because the
 * timeline control does not exist yet — this proves the engine, and the UI test
 * comes with the UI.
 *
 * NOT YET GREEN on the machine it was written on: it times out, and so does the
 * pre-existing `export.e2e.ts` on a clean `main`, which is how we know the cause
 * is the environment and not this feature. Run it somewhere idle before trusting
 * either result.
 */
test("a muted recording exports with no audio track at all", async () => {
  // Same gate as export.e2e.ts: headless Linux CI has no working WebCodecs H.264
  // encoder, and `isConfigSupported` there falsely reports support.
  test.skip(
    process.platform === "linux" && !!process.env.CI,
    "WebCodecs H.264/AAC encoding unavailable on headless Linux CI",
  );

  const { page, vaultDir, teardown } = await launchApp();
  try {
    // A saved session that mutes everything, written before the editor opens.
    await writeFile(
      path.join(vaultDir, ".kaipu", `${RECORDING_ID}.edit.json`),
      JSON.stringify({
        version: 1,
        scene: {
          items: [{ id: "clip-1", kind: "clip", sourceStart: 0, sourceEnd: RECORDING_DURATION }],
          overlays: [],
          audioMuted: true,
        },
      }),
    );

    await openEditor(page);
    await expect
      .poll(() => page.evaluate(() => document.querySelector("video")?.videoWidth ?? 0), {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);

    await page.getByRole("button", { name: "Export" }).click();
    await expect
      .poll(() => page.evaluate(() => location.hash), { timeout: 90_000 })
      .toMatch(/^#\/library\/.+/);

    const newAssetId = (await page.evaluate(() => location.hash)).replace("#/library/", "");
    const newId = await localIdForAssetId(vaultDir, newAssetId);

    if (!(await ffprobeAvailable())) {
      test.info().annotations.push({ type: "skip", description: "ffprobe not on PATH" });
      return;
    }

    const streams = await probeMedia(path.join(vaultDir, `${newId}.mp4`));
    // The video is untouched…
    expect(streams.video?.codec).toBe("h264");
    expect(streams.video!.durationSec).toBeGreaterThan(RECORDING_DURATION - 1);
    // …and there is no audio stream to find. A silent AAC track would fail here,
    // which is exactly the outcome this guards against.
    expect(streams.audio).toBeUndefined();
  } finally {
    await teardown();
  }
});
