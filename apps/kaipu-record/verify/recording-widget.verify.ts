import { test, expect, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ALL_FORMATS, BufferSource, Input } from "mediabunny";
import { dismissOnboarding, launchApp } from "../e2e/helpers/launch";

// Opt-in: this scenario records real screen pixels. Run on the Mac mini, never the laptop.
test("recording widget captures the recorded region and starts the camera mid-take", async () => {
  test.skip(process.env.KAIPU_VERIFY_RECORDING !== "1", "Mac mini real-recording opt-in only");
  const out = path.resolve("test-results/verify/recording-widget");
  await mkdir(out, { recursive: true });
  const { app, page, vaultDir, teardown } = await launchApp({
    disableScreenCapture: false,
    settings: { recordingCountdownSeconds: 0 },
    env: { KAIPU_FLAG_OVERRIDES: JSON.stringify({ "capture-while-recording": true }) },
    extraArgs: [
      "--use-fake-device-for-media-stream",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
    ],
    seedVault: async () => {},
  });
  const activity = () => page.evaluate(() => window.electronAPI.getRecordingState());
  const control = async (): Promise<Page> => {
    await expect
      .poll(() => app.windows().some((p) => p.url().includes("window=control-bar")))
      .toBe(true);
    return app.windows().find((p) => p.url().includes("window=control-bar"))!;
  };
  try {
    await dismissOnboarding(page);
    const display = await app.evaluate(({ screen }) => {
      const d = screen.getAllDisplays()[0]!;
      return {
        id: d.id,
        size: { width: d.bounds.width, height: d.bounds.height },
        scale: d.scaleFactor,
      };
    });
    await page.evaluate(async (d) => {
      const sources = await window.electronAPI.getScreenSources({ withThumbnails: false });
      const source =
        sources.find((s) => s.id.startsWith(`screen:${d.id}:`)) ??
        sources.find((s) => s.id.startsWith("screen:"));
      if (!source) throw new Error("No screen source on the recording runner");
      window.electronAPI.updateRecordingSettings({
        selectedSource: { id: source.id, name: source.name, type: "screen" },
        area: {
          displayId: d.id,
          displaySize: d.size,
          rect: { x: 40, y: 40, width: 320, height: 200 },
        },
        isMicrophoneEnabled: false,
        isSystemAudioEnabled: false,
        isCameraEnabled: false,
      });
      window.electronAPI.requestStartRecording();
    }, display);
    await expect.poll(async () => (await activity()).active).toBe(true);
    const bar = await control();
    const shot = bar.getByRole("button", { name: "Take screenshot" });
    await expect(shot).toBeVisible();
    await bar.screenshot({ path: path.join(out, "01-recording.png") });
    await shot.click();
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.electronAPI.listLocalRecordings())).filter(
            (r) => r.kind === "screenshot",
          ).length,
      )
      .toBe(1);
    const image = (await page.evaluate(() => window.electronAPI.listLocalRecordings())).find(
      (r) => r.kind === "screenshot",
    )!;
    const png = await readFile(image.filePath);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([
      320 * display.scale,
      200 * display.scale,
    ]);
    expect(app.windows().some((p) => p.url().includes("window=capture-overlay"))).toBe(false);

    // Activate the camera for the first time while paused, then off/on while recording.
    await bar.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(bar.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
    await bar.getByRole("button", { name: "Camera", exact: true }).click();
    await expect(bar.getByRole("button", { name: "Camera", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await bar.waitForTimeout(1200); // Encode real camera frames; a paused start must survive resume.
    await bar.getByRole("button", { name: "Resume", exact: true }).click();
    await bar.waitForTimeout(1200);
    await bar.getByRole("button", { name: "Camera", exact: true }).click();
    await bar.waitForTimeout(400);
    await bar.getByRole("button", { name: "Camera", exact: true }).click();
    await bar.waitForTimeout(1200);
    await bar.screenshot({ path: path.join(out, "02-camera-on.png") });
    await bar.getByRole("button", { name: "Stop", exact: true }).click();
    await expect.poll(async () => (await activity()).active, { timeout: 30_000 }).toBe(false);
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.electronAPI.listLocalRecordings())).filter(
            (r) => r.kind === "recording",
          ).length,
        { timeout: 30_000 },
      )
      .toBe(1);
    const recording = (await page.evaluate(() => window.electronAPI.listLocalRecordings())).find(
      (r) => r.kind === "recording",
    )!;
    expect(recording.webcam).toBeTruthy();
    expect(recording.webcam!.gaps!.length).toBeGreaterThan(0);
    const webcamPath = path.join(vaultDir, ".kaipu", `${recording.id}.webcam.mp4`);
    const webcamBytes = await readFile(webcamPath);
    const input = new Input({ source: new BufferSource(webcamBytes), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    expect(track).not.toBeNull();
    const duration = await input.computeDuration();
    expect(duration).toBeGreaterThan(1);
    input.dispose();
    await writeFile(
      path.join(out, "result.json"),
      JSON.stringify(
        {
          screenshotSize: [png.readUInt32BE(16), png.readUInt32BE(20)],
          webcam: recording.webcam,
          webcamBytes: webcamBytes.length,
          webcamDuration: duration,
        },
        null,
        2,
      ),
    );
  } finally {
    if ((await activity().catch(() => null))?.active) {
      await page.evaluate(() => window.electronAPI.controlCommand("stop")).catch(() => {});
    }
    await teardown();
  }
});
