// Isolated editor/export proof. Build first. Creates its own profile, vault and owned process.
const { _electron } = require("@playwright/test");
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
(async () => {
  const evidence = path.resolve("../../.evidence/editable-cursor");
  await fs.mkdir(evidence, { recursive: true });
  const profile = await fs.mkdtemp("/tmp/kaipu-cursor-profile-");
  const vault = await fs.mkdtemp("/tmp/kaipu-cursor-vault-");
  const id = "Editable cursor proof",
    assetId = "c172b2ba-c1bc-4c10-880c-1778b53f4bf4";
  await fs.mkdir(path.join(vault, ".kaipu"));
  execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x202030:s=1920x1080:r=30:d=4",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    path.join(vault, id + ".mp4"),
  ]);
  await fs.writeFile(
    path.join(vault, ".kaipu", id + ".json"),
    JSON.stringify({
      sidecarVersion: 2,
      assetId,
      createdAt: Date.now(),
      title: id,
      durationSeconds: 4,
      capture: { mode: "screen", width: 1920, height: 1080, ratio: null, cursorPixels: "excluded" },
      derivedFromAssetId: null,
    }),
  );
  const t = Array.from({ length: 501 }, (_, i) => i * 8);
  await fs.writeFile(
    path.join(vault, ".kaipu", id + ".cursor.json"),
    JSON.stringify({
      version: 1,
      display: { id: "proof", width: 1920, height: 1080, scaleFactor: 1 },
      anchor: "exact",
      clicksAvailable: true,
      t,
      x: t.map(() => 0.6),
      y: t.map(() => 0.5),
      clicks: [{ t: 1000, x: 0.6, y: 0.5, button: 0 }],
    }),
  );
  await fs.writeFile(
    path.join(profile, "preferences.json"),
    JSON.stringify({ vaultDirectory: vault }),
  );
  await fs.writeFile(path.join(profile, "settings.json"), JSON.stringify({ locale: "en" }));
  // Optional prior native lifecycle artifact: copied, never mutated in place.
  let nativeSeed = null;
  if (process.env.KAIPU_CURSOR_NATIVE_RESULT) {
    const prior = JSON.parse(await fs.readFile(process.env.KAIPU_CURSOR_NATIVE_RESULT, "utf8"));
    const item = prior.library.items.find((x) => x.capture?.cursorPixels === "excluded" && x.local);
    if (!item) throw new Error("prior proof has no excluded native recording");
    const nativeId = "Native recorded cursor proof";
    await fs.copyFile(item.local.filePath, path.join(vault, nativeId + ".mp4"));
    const originalDir = path.join(path.dirname(item.local.filePath), ".kaipu");
    await fs.copyFile(
      path.join(originalDir, item.local.id + ".cursor.json"),
      path.join(vault, ".kaipu", nativeId + ".cursor.json"),
    );
    await fs.writeFile(
      path.join(vault, ".kaipu", nativeId + ".json"),
      JSON.stringify({
        sidecarVersion: 2,
        assetId: item.assetId,
        createdAt: Date.now(),
        title: nativeId,
        durationSeconds: item.durationSeconds,
        capture: item.capture,
        derivedFromAssetId: null,
      }),
    );
    nativeSeed = { id: nativeId, assetId: item.assetId, original: item.local.filePath };
  }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath:
      process.env.KAIPU_PROOF_ELECTRON ||
      "/tmp/kaipu-native-electron-runtime/Electron.app/Contents/MacOS/Electron",
    args: [path.resolve("."), `--user-data-dir=${profile}`],
    env,
    timeout: 30000,
  });
  const result = {
    profile,
    vault,
    pid: app.process().pid,
    nativeSeed,
    seed: "generated solid slate, synthetic deterministic positions/click; exclusion provenance is a fixture, not a native capture claim",
  };
  app
    .process()
    .stderr.on("data", (d) =>
      require("node:fs").appendFileSync(path.join(evidence, "runtime.log"), d),
    );
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
    const onboarding = page.getByRole("dialog", { name: "Onboarding" });
    await onboarding.waitFor({ state: "visible", timeout: 15000 });
    await page.keyboard.press("Escape");
    await onboarding.waitFor({ state: "detached" });
    await page.evaluate(
      async ({ id }) => {
        await window.electronAPI.saveVideoEditSession(
          id,
          JSON.stringify({
            version: 1,
            scene: {
              items: [{ id: "clip", kind: "clip", sourceStart: 0.5, sourceEnd: 3.5 }],
              overlays: [],
              zoomSegments: [
                {
                  id: "zoom",
                  start: 0,
                  end: 4,
                  scale: 2,
                  mode: "fixed",
                  anchor: { x: 0.5, y: 0.5 },
                  smoothing: 0,
                  origin: "manual",
                  trigger: null,
                },
              ],
              redactions: [],
              zoomSensitivity: 55,
              audioMuted: false,
              mutedRanges: [],
              webcam: null,
            },
          }),
          [],
        );
      },
      { id },
    );
    await page.evaluate((assetId) => {
      location.hash = `/editor/video/${assetId}`;
    }, assetId);
    await page.getByTestId("cursor-layer").waitFor();
    await page.waitForFunction(() => document.querySelector("video")?.videoWidth === 1920);
    await page.getByRole("button", { name: "Cursor", exact: true }).click();
    await page.getByRole("slider", { name: "Size", exact: true }).fill("64");
    await page.getByRole("slider", { name: "Smoothing", exact: true }).fill("65");
    await page.getByRole("combobox", { name: "Click effect", exact: true }).selectOption("ripple");
    await page.getByRole("checkbox", { name: "Click bounce", exact: true }).check();
    await page.evaluate(() => {
      const v = document.querySelector("video");
      v.pause();
      v.currentTime = 1.1;
    });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(evidence, "editor-arrow.png") });
    const png = await page.getByTestId("cursor-layer").evaluate((c) => c.toDataURL("image/png"));
    await fs.writeFile(
      path.join(evidence, "preview-cursor.png"),
      Buffer.from(png.split(",")[1], "base64"),
    );
    result.saved = await page.evaluate((id) => window.electronAPI.loadVideoEditSession(id), id);
    if (JSON.parse(result.saved.sessionJson).scene.cursor.size !== 64)
      throw new Error("inspector autosave failed");
    await page.getByRole("combobox", { name: "Pointer style", exact: true }).selectOption("dot");
    await page.screenshot({ path: path.join(evidence, "editor-dot.png") });
    await page
      .getByRole("combobox", { name: "Pointer style", exact: true })
      .selectOption("spotlight");
    await page.screenshot({ path: path.join(evidence, "editor-spotlight.png") });
    await page.getByRole("combobox", { name: "Pointer style", exact: true }).selectOption("arrow");
    await page.waitForTimeout(1000);
    // Reopen through the real route, proving persisted inspector state is loaded.
    await page.reload();
    await page.getByTestId("cursor-layer").waitFor();
    await page.getByRole("button", { name: "Cursor", exact: true }).click();
    if ((await page.getByRole("slider", { name: "Size", exact: true }).inputValue()) !== "64")
      throw new Error("reopen lost size");
    await page.evaluate(() => {
      const v = document.querySelector("video");
      v.pause();
      v.currentTime = 1.1;
    });
    await page.waitForTimeout(300);
    console.log("EDITOR BUTTONS", await page.getByRole("button").allTextContents());
    await page.getByRole("button", { name: /^Export$/ }).click();
    console.log("EXPORT SHEET", await page.locator("body").innerText());
    // The default preset retains this 1080p fixture; prefer Full size when offered.
    const full = page.getByRole("button", { name: /Full size/ });
    if (await full.count()) await full.first().click();
    console.log("EXPORT BUTTONS", await page.getByRole("button").allTextContents());
    const exportButton = page.getByRole("button", { name: /^Export (full size|~|\d)/i });
    await exportButton.click();
    let exported;
    for (let i = 0; i < 90; i++) {
      const items = await page.evaluate(() => window.electronAPI.listLibraryItems());
      exported = items.items.find(
        (x) => x.derivedFromAssetId === assetId && x.local?.filePath?.endsWith(".mp4"),
      );
      if (exported) break;
      await page.waitForTimeout(500);
    }
    if (!exported) throw new Error("export did not save");
    result.exported = exported;
    await fs.copyFile(exported.local.filePath, path.join(evidence, "export.mp4"));
    execFileSync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      "0.6",
      "-i",
      exported.local.filePath,
      "-frames:v",
      "1",
      "-y",
      path.join(evidence, "export-frame.png"),
    ]);
    result.parity = await page.evaluate(
      async ({ preview, output }) => {
        const measure = async (url) => {
          const image = new Image();
          image.src = url;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(image, 0, 0);
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let left = canvas.width,
            top = canvas.height,
            right = -1,
            bottom = -1,
            count = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            if (
              pixels[i] > 180 &&
              pixels[i + 1] > 180 &&
              pixels[i + 2] > 180 &&
              pixels[i + 3] > 128
            ) {
              const x = (i / 4) % canvas.width,
                y = Math.floor(i / 4 / canvas.width);
              left = Math.min(left, x);
              right = Math.max(right, x);
              top = Math.min(top, y);
              bottom = Math.max(bottom, y);
              count++;
            }
          }
          return {
            width: canvas.width,
            height: canvas.height,
            bounds: [left, top, right, bottom],
            count,
          };
        };
        return { preview: await measure(preview), exported: await measure(output) };
      },
      {
        preview: png,
        output:
          "data:image/png;base64," +
          (await fs.readFile(path.join(evidence, "export-frame.png"))).toString("base64"),
      },
    );
    const a = result.parity.preview,
      z = result.parity.exported;
    if (
      !a.count ||
      !z.count ||
      a.width !== z.width ||
      a.height !== z.height ||
      a.bounds.some((v, i) => Math.abs(v - z.bounds[i]) > 2) ||
      Math.abs(a.count - z.count) / a.count > 0.05
    )
      throw new Error("decoded cursor parity exceeded 2px / 5% white-mask tolerance");
    const privateScene = JSON.parse(result.saved.sessionJson);
    privateScene.scene.redactions = [
      {
        id: "privacy",
        kind: "cover",
        start: 0.5,
        end: 2,
        rect: { x: 0.5, y: 0.4, w: 0.2, h: 0.2 },
        fill: "#18181b",
        label: "Private",
      },
    ];
    await page.evaluate(
      async ({ id, session }) =>
        window.electronAPI.saveVideoEditSession(id, JSON.stringify(session), []),
      { id, session: privateScene },
    );
    await page.reload();
    await page.getByTestId("cursor-layer").waitFor();
    await page.waitForFunction(() => document.querySelector("video")?.videoWidth === 1920);
    await page.evaluate(() => {
      document.querySelector("video").currentTime = 1.1;
    });
    await page.waitForTimeout(300);
    const alpha = await page.getByTestId("cursor-layer").evaluate((c) =>
      c
        .getContext("2d")
        .getImageData(0, 0, c.width, c.height)
        .data.some((v, i) => i % 4 === 3 && v > 0),
    );
    if (alpha) throw new Error("private span revealed cursor overlay");
    result.privacyCursorTransparent = true;
    await page.screenshot({ path: path.join(evidence, "editor-privacy.png") });
    // Change only fixture provenance and reload the real resolver: no doubled cursor.
    const metadataPath = path.join(vault, ".kaipu", id + ".json");
    const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
    metadata.capture.cursorPixels = "embedded";
    await fs.writeFile(metadataPath, JSON.stringify(metadata));
    await page.reload();
    // An embedded-cursor recording has no Cursor control at all; wait for the editor first.
    await page.getByRole("button", { name: "Select", exact: true }).waitFor();
    if (await page.getByRole("button", { name: "Cursor", exact: true }).count())
      throw new Error("embedded cursor control shown");
    if (await page.getByTestId("cursor-layer").count()) throw new Error("embedded cursor overlaid");
    result.embeddedHasNoOverlay = true;
    await page.screenshot({ path: path.join(evidence, "editor-embedded.png") });
    if (nativeSeed) {
      await page.evaluate((assetId) => {
        location.hash = `/editor/video/${assetId}`;
      }, nativeSeed.assetId);
      await page.getByTestId("cursor-layer").waitFor();
      await page.waitForFunction(() => document.querySelector("video")?.videoWidth === 1920);
      await page.getByRole("button", { name: "Cursor", exact: true }).click();
      await page.evaluate(() => {
        document.querySelector("video").currentTime = 0;
      });
      await page.waitForTimeout(300);
      result.nativeDefaultSize = await page
        .getByRole("slider", { name: "Size", exact: true })
        .inputValue();
      result.nativeCursorPainted = await page.getByTestId("cursor-layer").evaluate((c) =>
        c
          .getContext("2d")
          .getImageData(0, 0, c.width, c.height)
          .data.some((v, i) => i % 4 === 3 && v > 0),
      );
      if (!result.nativeCursorPainted) throw new Error("native default cursor did not paint");
      result.nativeDefaultVisible = await page
        .getByRole("checkbox", { name: "Show cursor", exact: true })
        .isChecked();
      await page.screenshot({ path: path.join(evidence, "editor-native-default.png") });
    }
    await fs.writeFile(path.join(evidence, "result.json"), JSON.stringify(result, null, 2));
    console.log("PROOF", JSON.stringify(result));
  } catch (e) {
    const page = app.windows()[0];
    if (page) {
      await page.screenshot({ path: path.join(evidence, "failure.png") }).catch(() => {});
      console.log(
        await page
          .locator("body")
          .innerText()
          .catch(() => ""),
      );
    }
    throw e;
  } finally {
    const child = app.process();
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 5000);
    timer.unref();
    await app.close().catch(() => {});
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
