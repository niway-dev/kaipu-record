import { test, expect, type Page } from "@playwright/test";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { dismissOnboarding, launchApp } from "../e2e/helpers/launch";
import { measureAudioStart, type AudioStartReport } from "../e2e/helpers/av-sync";

/**
 * Where a real take's microphone audio starts (NIW2-807). The microphone plays a continuous
 * tone, so every recorded instant should be loud: a late first loud window means the recorder
 * lost the take's first samples, and quiet windows after it mean holes.
 *
 * mediabunny 1.66 measures the AAC encoder's priming delay with an encode-and-decode probe when
 * the first audio encoder starts, and while that runs its MediaStream sources count the samples
 * waiting for the encoder and drop new ones past 8. The probe is cached per renderer, so the
 * session's first take is the cold case and the second the warm one: the scenario records both.
 *
 * The tone is an oscillator handed to the recorder in place of the microphone stream. Chromium's
 * `--use-file-for-fake-audio-capture` delivered digital silence on the Mac mini (peak 0 read
 * straight from the device, outside the recorder, with the audio service in process and
 * unsandboxed), and the fake device's own beep is too sparse to time a start. From the
 * `MediaStreamTrack` on, the path is the real one: the recorder's AudioContext mix, mediabunny's
 * MediaStream source, the AAC encoder and the MP4 writer.
 *
 * Opt-in: this records real screen pixels. Run on the Mac mini, as a launchd job (screen
 * recording permission), never on the laptop.
 */
test("a take's microphone audio starts with the take, cold and warm", async () => {
  test.skip(process.env.KAIPU_VERIFY_RECORDING !== "1", "Mac mini real-recording opt-in only");
  test.setTimeout(5 * 60_000);
  const out = path.resolve("test-results/verify/recording-audio-start");
  await mkdir(out, { recursive: true });

  const { app, page, teardown } = await launchApp({
    disableScreenCapture: false,
    settings: { recordingCountdownSeconds: 3 },
    extraArgs: [
      // Lists microphones, so the app selects one and opens it through getUserMedia.
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
  const recordings = async () =>
    (await page.evaluate(() => window.electronAPI.listLocalRecordings())).filter(
      (r) => r.kind === "recording",
    );
  const toneCalls = () =>
    page.evaluate(() => (window as unknown as { __toneCalls: number }).__toneCalls);

  const takes: Record<string, AudioStartReport & { file: string; toneCalls: number }> = {};
  let failed = false;
  try {
    await dismissOnboarding(page);
    const display = await app.evaluate(({ screen }) => screen.getAllDisplays()[0]!.id);
    await page.evaluate(() =>
      window.electronAPI.updateRecordingSettings({
        isMicrophoneEnabled: true,
        isSystemAudioEnabled: false,
        isCameraEnabled: false,
      }),
    );
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.electronAPI.getRecordingSettings())).selectedMicrophone,
        { timeout: 10_000 },
      )
      .not.toBeNull();

    // Audio-only getUserMedia (the microphone) gets a fresh clone of a running 440 Hz tone at
    // -12 dBFS; everything else (the screen) goes to Chromium as before.
    await page.evaluate(async () => {
      const ctx = new AudioContext({ sampleRate: 48_000 });
      await ctx.resume();
      const osc = new OscillatorNode(ctx, { frequency: 440 });
      const gain = new GainNode(ctx, { gain: 0.25 });
      const dest = ctx.createMediaStreamDestination();
      osc.connect(gain).connect(dest);
      osc.start();
      const w = window as unknown as { __toneCalls: number; __toneCtx: AudioContext };
      w.__toneCalls = 0;
      w.__toneCtx = ctx;
      const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        if (constraints?.audio && !constraints.video) {
          w.__toneCalls += 1;
          return new MediaStream([dest.stream.getAudioTracks()[0]!.clone()]);
        }
        return real(constraints);
      };
    });

    const watch = (p: Page) =>
      p.on("console", (msg) => {
        if (/microphone|output\.start|countdown ended/i.test(msg.text())) {
          console.log(`[recording-audio-start console] ${msg.text()}`);
        }
      });
    app.windows().forEach(watch);
    app.on("window", watch);

    for (const [index, name] of ["cold", "warm"].entries()) {
      await page.evaluate(() => window.electronAPI.requestRecordSelector("frame"));
      await expect
        .poll(() =>
          app.windows().some((p) => p.url().includes(`window=capture-overlay&display=${display}`)),
        )
        .toBe(true);
      const overlay = app
        .windows()
        .find((p) => p.url().includes(`window=capture-overlay&display=${display}`))!;
      await expect(overlay.locator('[data-ui-area="captureOverlay.frameBox"]')).toBeVisible();
      await overlay.evaluate(
        (id) =>
          window.electronAPI.captureOverlay.answer({
            kind: "rect",
            mode: "frame",
            action: "record",
            displayId: id,
            rect: { x: 40, y: 40, width: 320, height: 200 },
          }),
        display,
      );
      await expect.poll(async () => (await activity()).active, { timeout: 30_000 }).toBe(true);
      const bar = await control();
      await bar.waitForTimeout(4000);
      await bar.getByRole("button", { name: "Stop", exact: true }).click();
      await expect.poll(async () => (await activity()).active, { timeout: 30_000 }).toBe(false);
      await expect
        .poll(async () => (await recordings()).length, { timeout: 30_000 })
        .toBe(index + 1);
      const take = (await recordings()).sort((a, b) => b.createdAt - a.createdAt)[0]!;
      const kept = path.join(out, `take-${name}.mp4`);
      await copyFile(take.filePath, kept);
      takes[name] = {
        ...(await measureAudioStart(kept)),
        file: path.basename(kept),
        // 0 would mean the recorder opened its microphone somewhere else: the take is not
        // measuring the tone.
        toneCalls: await toneCalls(),
      };
      console.log(`[recording-audio-start] ${name}: ${JSON.stringify(takes[name])}`);
    }
    await writeFile(path.join(out, "result.json"), JSON.stringify(takes, null, 2));
    for (const [index, name] of ["cold", "warm"].entries()) {
      const take = takes[name]!;
      expect(take.toneCalls, `${name}: the recorder opened the tone`).toBe(index + 1);
      // Audible within half a frame at 30 fps of the first frame. mediabunny 1.61.4 left the
      // AAC encoder's 2112 priming samples in the timeline and measured 48-51 ms here.
      expect(take.firstLoudSec, `${name}: audio starts with the take`).toBeLessThan(0.017);
      expect(take.silentAfterStartMs, `${name}: no holes in the audio`).toBeLessThanOrEqual(5);
    }
  } catch (error) {
    failed = true;
    console.error("[recording-audio-start proof]", error);
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
      console.error("[recording-audio-start teardown]", error);
    });
  }
});
