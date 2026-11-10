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
    settings: { recordingCountdownSeconds: 3 },
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
  let failed = false;
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
    await page.evaluate(() => {
      window.electronAPI.updateRecordingSettings({
        isMicrophoneEnabled: false,
        isSystemAudioEnabled: false,
        isCameraEnabled: false,
      });
      window.electronAPI.requestRecordSelector("frame");
    });
    await expect
      .poll(() =>
        app.windows().some((p) => p.url().includes(`window=capture-overlay&display=${display.id}`)),
      )
      .toBe(true);
    const overlay = app
      .windows()
      .find((p) => p.url().includes(`window=capture-overlay&display=${display.id}`))!;
    await expect(overlay.locator('[data-ui-area="captureOverlay.frameBox"]')).toBeVisible();
    await overlay.evaluate(
      (d) =>
        window.electronAPI.captureOverlay.answer({
          kind: "rect",
          mode: "frame",
          action: "record",
          displayId: d.id,
          rect: { x: 40, y: 40, width: 320, height: 200 },
        }),
      display,
    );
    await expect.poll(async () => (await activity()).active).toBe(true);
    const bar = await control();
    const shot = bar.getByRole("button", { name: "Take screenshot" });
    await expect(shot).toBeVisible();
    await expect(bar.locator('[data-testid="control-bar-mode"]')).toHaveText(/Frame/);
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
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some(
          (w) => w.isVisible() && w.webContents.getURL().includes("window=capture-overlay"),
        ),
      ),
    ).toBe(false);

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
  } catch (error) {
    failed = true;
    console.error("[recording-widget proof]", error);
    throw error;
  } finally {
    if ((await activity().catch(() => null))?.active) {
      await page.evaluate(() => window.electronAPI.controlCommand("stop")).catch(() => {});
    }
    await expect
      .poll(async () => (await activity().catch(() => null))?.active ?? false, { timeout: 30_000 })
      .toBe(false)
      .catch(() => {});
    await teardown().catch((error) => {
      if (!failed) throw error;
      console.error("[recording-widget teardown]", error);
    });
  }
});
