// Opt-in isolated Electron proof. Run from app root after build; preserves the installed app.
const { _electron } = require("@playwright/test");
const fs = require("node:fs/promises");
const path = require("node:path");
(async () => {
  const evidence = "/tmp/kaipu-native-recorder-proof";
  await fs.mkdir(evidence, { recursive: true });
  const profile = await fs.mkdtemp("/tmp/kaipu-native-profile-");
  const vault = await fs.mkdtemp("/tmp/kaipu-native-vault-");
  await fs.writeFile(
    path.join(profile, "preferences.json"),
    JSON.stringify({ vaultDirectory: vault }),
  );
  await fs.writeFile(path.join(profile, "settings.json"), JSON.stringify({ locale: "en" }));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath:
      process.env.KAIPU_PROOF_ELECTRON ||
      "/tmp/kaipu-native-electron-runtime/Electron.app/Contents/MacOS/Electron",
    args: [path.resolve("."), `--user-data-dir=${profile}`, "--experimental-native-recording"],
    env,
    timeout: 30000,
  });
  const log = [];
  const add = (x) => {
    log.push(String(x));
    require("node:fs").appendFileSync(path.join(evidence, "live.log"), String(x));
  };
  app.process().stderr.on("data", add);
  try {
    const page = await app.firstWindow({ timeout: 15000 });
    page.on("console", (m) => add(`${m.type()}: ${m.text()}\n`));
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2500);
    console.log(
      JSON.stringify({
        profile,
        vault,
        pid: app.process().pid,
        url: page.url(),
        text: await page.locator("body").innerText(),
      }),
    );
    await page.screenshot({ path: path.join(evidence, "initial.png") });
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "Onboarding" }).waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Screen", exact: true }).click();
    await page.waitForTimeout(1500);
    const overlay = app
      .windows()
      .find(
        (w) =>
          w.url().includes("window=capture-overlay") &&
          (!process.env.KAIPU_PROOF_DISPLAY ||
            w.url().includes(`&display=${process.env.KAIPU_PROOF_DISPLAY}&`)),
      );
    console.log(
      "OVERLAY BUTTONS",
      await overlay
        .getByRole("button")
        .evaluateAll((xs) =>
          xs.map((x) => ({ text: x.textContent, label: x.getAttribute("aria-label") })),
        ),
    );
    await overlay.getByRole("button", { name: "Record this display", exact: true }).click();
    await page.waitForTimeout(6000);
    for (const win of app.windows())
      console.log(
        "WINDOW",
        win.url(),
        await win
          .locator("body")
          .innerText()
          .catch(() => ""),
      );
    const bar = app.windows().find((w) => w.url().includes("window=control-bar"));
    console.log(
      "BAR BUTTONS",
      await bar.getByRole("button").evaluateAll((xs) =>
        xs.map((x) => ({
          text: x.textContent,
          label: x.getAttribute("aria-label"),
          title: x.title,
        })),
      ),
    );
    await bar.getByRole("button", { name: "Pause", exact: true }).click();
    await page.waitForTimeout(1200);
    console.log("PAUSED", await bar.locator("body").innerText());
    await bar.screenshot({ path: path.join(evidence, "paused.png") });
    await bar.getByRole("button", { name: "Resume", exact: true }).click();
    await page.waitForTimeout(1200);
    console.log("RESUMED", await bar.locator("body").innerText());
    await bar.screenshot({ path: path.join(evidence, "resumed.png") });
    await page.getByRole("button", { name: "Stop recording", exact: true }).click();
    await page.waitForTimeout(3000);
    console.log("SAVED FILES", await fs.readdir(path.join(vault, ".kaipu")).catch(() => []));
    const metadata = [];
    for (const name of await fs.readdir(path.join(vault, ".kaipu")).catch(() => []))
      if (name.endsWith(".json") && !name.endsWith(".cursor.json")) {
        const data = JSON.parse(await fs.readFile(path.join(vault, ".kaipu", name), "utf8"));
        console.log("METADATA", name, JSON.stringify(data));
        metadata.push({ name, data });
      }
    if (!metadata.some((x) => x.data.capture?.cursorPixels === "excluded"))
      throw new Error("Native recording was not saved with excluded provenance");
    const library = await page.evaluate(() => window.electronAPI.listLibraryItems());
    console.log("LIBRARY", JSON.stringify(library));
    const savedAsset = metadata.find((entry) => entry.data.capture?.cursorPixels === "excluded")
      .data.assetId;
    if (library.vaultError || !library.items.some((item) => item.assetId === savedAsset))
      throw new Error("Native take missing from library listing");
    await fs.writeFile(
      path.join(evidence, "result.json"),
      JSON.stringify({ profile, vault, metadata, library }, null, 2),
    );
    await page.screenshot({ path: path.join(evidence, "saved.png") });
    console.log(
      "CAPABILITY",
      await page.evaluate(() => window.electronAPI.nativeCapture.capability()),
    );
  } finally {
    const child = app.process();
    let timer;
    try {
      await Promise.race([
        app.close(),
        new Promise((resolve) => {
          timer = setTimeout(() => {
            child.kill("SIGKILL");
            resolve();
          }, 5000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    await fs.writeFile(path.join(evidence, "runtime.log"), log.join(""));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
