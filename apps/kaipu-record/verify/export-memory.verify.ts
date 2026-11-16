import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { copyFile, cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { launchApp, openEditor, RECORDING_ASSET_ID, RECORDING_ID } from "../e2e/helpers/launch";

/**
 * Export memory benchmark (NIW2-806, NIW2-807). Exports a real take, with its edit, webcam and
 * cursor, through the real app with the YouTube 1440p preset. About every 5 s (5 s between
 * samples, plus the time one takes) it samples each Electron
 * process's physical footprint (macOS `footprint`), the swap in use and the bytes written to the
 * export's `.part` file. `summary.json` holds the peaks, the wall time and the output size;
 * `samples.csv` the curve. The docs page `testing/export-memory-benchmark` has the results.
 *
 * Opt-in and macOS only: it needs a real take, which is not in the repository, and it runs for
 * as long as the export does (about 15 min for a 31 min take on an M4 Mac mini).
 *
 * KAIPU_BENCH_SOURCE_DIR  the workspace folder holding the take (and its `.kaipu/` sidecars)
 * KAIPU_BENCH_STEM        the take's filename stem
 * KAIPU_BENCH_LABEL       names the output folder: test-results/verify/export-memory-<label>/
 */
const run = promisify(execFile);
const SOURCE_DIR = process.env.KAIPU_BENCH_SOURCE_DIR ?? "";
const STEM = process.env.KAIPU_BENCH_STEM ?? "";
const LABEL = process.env.KAIPU_BENCH_LABEL ?? "run";
// The label names a folder that is deleted first: keep it to one plain path segment.
if (!/^[\w.-]+$/.test(LABEL) || LABEL.startsWith(".")) {
  throw new Error(`KAIPU_BENCH_LABEL must be letters, digits, ".", "_" or "-": ${LABEL}`);
}
const TICK_MS = 5_000;
// One reading or one main-process call that takes longer than this is a failed sample: a hung
// `footprint`, `sysctl` or directory walk must not stall the sampler, and the cleanup that waits
// for it.
const CALL_TIMEOUT_MS = 30_000;

function within<T>(promise: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${what} took over ${CALL_TIMEOUT_MS} ms`)),
      CALL_TIMEOUT_MS,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function clone(src: string, dst: string): Promise<void> {
  try {
    // `cp -c` is clonefile(2). Node's COPYFILE_FICLONE_FORCE fails with ENOSYS on macOS, so it
    // cannot clone here.
    await run("/bin/cp", ["-c", src, dst]);
  } catch (error) {
    // Not on the same APFS volume as the temporary folder: a full copy, which takes a while
    // for a multi-GB take but does not change what is measured (it ends before the export).
    console.log(`[export-memory] copying ${path.basename(src)} in full: ${String(error)}`);
    await copyFile(src, dst);
  }
}

async function exists(p: string): Promise<boolean> {
  return stat(p).then(
    () => true,
    () => false,
  );
}

// The optional files that were found and seeded, for the summary: a run without its edit,
// webcam or cursor exports a different take, and its numbers do not compare.
const seeded: string[] = [];
// The workspace folder launchApp made, so a failed launch can remove it (see below).
let seededDir: string | undefined;

// launchApp creates the workspace folder before it seeds it and returns teardown only after the
// launch, so a seed or a launch that fails (a full copy that runs out of disk, an unreadable
// sidecar, a missing out/) would leave a multi-GB folder behind. The seed removes it on its own
// failure, the launch call on the launch's; the small user-data folder is left as is.
async function seed(vaultDir: string): Promise<void> {
  seededDir = vaultDir;
  try {
    await seedFiles(vaultDir);
  } catch (error) {
    await rm(vaultDir, { recursive: true, force: true });
    throw error;
  }
}

async function seedFiles(vaultDir: string): Promise<void> {
  const meta = path.join(vaultDir, ".kaipu");
  await mkdir(meta, { recursive: true });
  await clone(path.join(SOURCE_DIR, `${STEM}.mp4`), path.join(vaultDir, `${RECORDING_ID}.mp4`));
  for (const suffix of [".webcam.mp4", ".cursor.json", ".edit.json"]) {
    const src = path.join(SOURCE_DIR, ".kaipu", `${STEM}${suffix}`);
    if (await exists(src)) {
      await clone(src, path.join(meta, `${RECORDING_ID}${suffix}`));
      seeded.push(suffix);
    }
  }
  // Images and other files the edit places on the timeline. `.edit.meta.json` stays behind: it
  // records the source's size and mtime, which a copy does not keep.
  const assets = path.join(SOURCE_DIR, ".kaipu", `${STEM}.assets`);
  if (await exists(assets)) {
    await cp(assets, path.join(meta, `${RECORDING_ID}.assets`), { recursive: true });
    seeded.push(".assets/");
  }
  console.log(`[export-memory] seeded the take with: ${seeded.join(", ") || "nothing else"}`);
  const sidecar = JSON.parse(
    await readFile(path.join(SOURCE_DIR, ".kaipu", `${STEM}.json`), "utf8"),
  );
  sidecar.assetId = RECORDING_ASSET_ID;
  sidecar.title = `Bench ${LABEL}`;
  await writeFile(path.join(meta, `${RECORDING_ID}.json`), JSON.stringify(sidecar));
}

async function footprintMb(pid: number): Promise<number | null> {
  try {
    const { stdout } = await run("footprint", [String(pid)], {
      maxBuffer: 128 * 1024 * 1024,
      timeout: CALL_TIMEOUT_MS,
    });
    const m = /Footprint:\s+([\d.]+)\s+(B|KB|MB|GB)/.exec(stdout);
    if (!m) return null;
    const scale = { B: 1 / 1024 / 1024, KB: 1 / 1024, MB: 1, GB: 1024 }[m[2] as "B"];
    return Math.round(Number(m[1]) * scale);
  } catch {
    return null;
  }
}

async function swapUsedMb(): Promise<number | null> {
  // Like footprintMb: a failed reading is null (one missed reading), not a failed sample.
  try {
    const { stdout } = await run("sysctl", ["-n", "vm.swapusage"], { timeout: CALL_TIMEOUT_MS });
    const m = /used = ([\d.]+)M/.exec(stdout);
    return m ? Math.round(Number(m[1])) : null;
  } catch {
    return null;
  }
}

async function partBytes(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith(".part")) {
      total += (await stat(path.join(entry.parentPath, entry.name)).catch(() => ({ size: 0 })))
        .size;
    }
  }
  return total;
}

type Sample = {
  t: number;
  swapMb: number | null;
  partBytes: number;
  procs: Array<{ pid: number; role: string; mb: number | null }>;
};

test("export memory of a real take, YouTube 1440p", async () => {
  test.skip(process.platform !== "darwin", "footprint is macOS only");
  test.skip(!SOURCE_DIR || !STEM, "set KAIPU_BENCH_SOURCE_DIR and KAIPU_BENCH_STEM");
  test.setTimeout(150 * 60_000);
  const outDir = path.resolve("test-results/verify", `export-memory-${LABEL}`);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  // The sidecar is the one required sidecar file; checked here, before launchApp creates any
  // temporary folder, so a wrong path fails without leaving one behind.
  const sidecarPath = path.join(SOURCE_DIR, ".kaipu", `${STEM}.json`);
  expect(await exists(sidecarPath), `the take's sidecar: ${sidecarPath}`).toBe(true);
  // What the numbers belong to: the app under test is the prebuilt out/, so its build time and
  // whether tracked files differ from HEAD go in the summary next to the commit. The mediabunny
  // version is the one installed now: the bundle carries no version string, so it matches out/
  // only when out/ was built after the last install.
  const commit = (await run("git", ["rev-parse", "--short", "HEAD"])).stdout.trim();
  const dirty =
    (await run("git", ["status", "--porcelain", "--untracked-files=no"])).stdout.trim() !== "";
  const builtAt = (await stat(path.resolve("out/main/index.js"))).mtime.toISOString();
  const mediabunny = (
    JSON.parse(await readFile(path.resolve("node_modules/mediabunny/package.json"), "utf8")) as {
      version: string;
    }
  ).version;

  const { app, page, vaultDir, teardown } = await launchApp({ seedVault: seed }).catch(
    async (error: unknown) => {
      if (seededDir) await rm(seededDir, { recursive: true, force: true });
      throw error;
    },
  );
  const samples: Sample[] = [];
  let failedSamples = 0;
  // Footprint or swap readings that failed: null in samples.json, and no value for that sample
  // in the peaks and the CSV.
  let missedReadings = 0;
  let done = false;
  let sampler: Promise<void> | undefined;
  let t0 = 0;
  const sample = async (): Promise<Sample> => {
    // The main window is the page the test drives, matched by its URL: other windows without a
    // `window=` parameter must not be counted as the one that runs the export.
    const info = await within(
      app.evaluate(
        ({ app: a, BrowserWindow }, mainUrl) => ({
          metrics: a
            .getAppMetrics()
            .map((m) => ({ pid: m.pid, type: m.type, name: m.name ?? m.serviceName ?? "" })),
          windows: BrowserWindow.getAllWindows().map((w) => ({
            pid: w.webContents.getOSProcessId(),
            url: w.webContents.getURL(),
            main: w.webContents.getURL() === mainUrl,
          })),
        }),
        page.url(),
      ),
      "app.evaluate",
    );
    const role = (m: (typeof info.metrics)[number]): string => {
      if (m.type !== "Tab") return m.name ? `${m.type}:${m.name}` : m.type;
      const w = info.windows.find((x) => x.pid === m.pid);
      if (!w) return "Tab:no-window";
      if (w.main) return "Tab:main-window";
      const kind = /window=([\w-]+)/.exec(w.url)?.[1];
      return kind ? `Tab:${kind}` : "Tab:other-window";
    };
    const procs = await Promise.all(
      info.metrics.map(async (m) => {
        const mb = await footprintMb(m.pid);
        if (mb === null) missedReadings += 1;
        return { pid: m.pid, role: role(m), mb };
      }),
    );
    const swapMb = await swapUsedMb();
    if (swapMb === null) missedReadings += 1;
    return {
      t: Math.round((Date.now() - t0) / 100) / 10,
      swapMb,
      partBytes: await within(partBytes(vaultDir), "reading the .part size"),
      procs,
    };
  };

  // Whether the body finished: on success a failed teardown (a hung quit, the shutdown-deadline
  // marker) fails the run; after a failure it is only logged, so it does not hide the first error.
  let bodyDone = false;
  try {
    await openEditor(page);
    await expect
      .poll(() => page.evaluate(() => document.querySelector("video")?.videoWidth ?? 0), {
        timeout: 60_000,
      })
      .toBeGreaterThan(0);
    // Let the editor settle (waveform, thumbnails) so the idle line is not the editor loading.
    await page.waitForTimeout(20_000);
    t0 = Date.now();
    samples.push(await sample());

    await page.getByRole("button", { name: "Export", exact: true }).click();
    const sheet = page.getByRole("alertdialog");
    await sheet.getByRole("radio", { name: /^YouTube/ }).click();
    await sheet
      .getByRole("radiogroup", { name: "Resolution" })
      .getByRole("radio", { name: "1440p" })
      .click();
    sampler = (async () => {
      while (!done) {
        await new Promise((r) => setTimeout(r, TICK_MS));
        // A sample can fail while the app is busy or closing; it is counted, not recorded.
        const s = await sample().catch(() => null);
        if (s) samples.push(s);
        else failedSamples += 1;
      }
    })();
    const clicked = Date.now();
    await sheet.getByRole("button", { name: /^Export( |$)/ }).click();
    const ready = page.getByRole("region", { name: "Your export is ready" });
    // The export's error dialog ends the run at once instead of at the timeout.
    const failed = page.getByText(/^Couldn't export the video/);
    await expect(ready.or(failed).first()).toBeVisible({ timeout: 140 * 60_000 });
    if (await failed.first().isVisible()) {
      // The error modal is an alertdialog (ModalOverlay); a short timeout so a changed markup
      // costs seconds, not the test timeout.
      const text = await page
        .getByRole("alertdialog")
        .filter({ has: failed })
        .innerText({ timeout: 5_000 })
        .catch(() => "");
      throw new Error(`The export failed: ${text}`);
    }
    const wallSec = Math.round((Date.now() - clicked) / 100) / 10;
    // Thirty more seconds: what the renderer keeps after the export.
    await page.waitForTimeout(30_000);
    done = true;
    await sampler;

    const mp4s = (await readdir(vaultDir)).filter(
      (f) => f.endsWith(".mp4") && f !== `${RECORDING_ID}.mp4`,
    );
    expect(mp4s, "one exported file in the workspace").toHaveLength(1);
    const exported = path.join(outDir, `export-${LABEL}.mp4`);
    await clone(path.join(vaultDir, mp4s[0]!), exported);

    const roles = [...new Set(samples.flatMap((s) => s.procs.map((p) => p.role)))].sort();
    // A role can have several processes (two "Tab:other" windows): its value in a sample is
    // their sum, in the summary and in the CSV alike. A sample where the role is missing, or one
    // of its readings failed, has no value (an empty CSV cell): counting a failed reading as 0
    // would let the peak fall back to an earlier, lower sample without saying so.
    const roleMb = (s: Sample, role: string): number | null => {
      const ps = s.procs.filter((p) => p.role === role);
      if (ps.length === 0 || ps.some((p) => p.mb === null)) return null;
      return ps.reduce((a, p) => a + (p.mb ?? 0), 0);
    };
    const peak = (role: string): number | null => {
      const values = samples.map((s) => roleMb(s, role)).filter((v): v is number => v !== null);
      return values.length > 0 ? Math.max(...values) : null;
    };
    const first = samples.find((s) => s.partBytes > 1024 * 1024);
    const summary = {
      label: LABEL,
      commit,
      dirty,
      builtAt,
      mediabunny,
      seeded,
      wallSec,
      firstMbOnDiskSec: first ? first.t - (clicked - t0) / 1000 : null,
      outputBytes: (await stat(exported)).size,
      peakMb: Object.fromEntries(roles.map((r) => [r, peak(r)])),
      idleMb: Object.fromEntries(roles.map((r) => [r, samples[0] ? roleMb(samples[0], r) : null])),
      // Null when no sample read the swap, never 0: a missing reading is not a measurement.
      peakSwapMb: samples.some((s) => s.swapMb !== null)
        ? Math.max(...samples.flatMap((s) => (s.swapMb === null ? [] : [s.swapMb])))
        : null,
      samples: samples.length,
      failedSamples,
      missedReadings,
    };
    console.log(`[export-memory] ${JSON.stringify(summary)}`);
    await writeFile(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
    const header = ["t", "swap_mb", "part_bytes", ...roles.map((r) => `${r}_mb`)];
    const rows = samples.map((s) =>
      [s.t, s.swapMb ?? "", s.partBytes, ...roles.map((r) => roleMb(s, r) ?? "")].join(","),
    );
    await writeFile(
      path.join(outDir, "samples.csv"),
      [header.join(","), ...rows].join("\n") + "\n",
    );
    bodyDone = true;
  } finally {
    // Stops the sampler when the export failed or timed out, and waits for its last sample,
    // before samples.json is written and the app closes.
    done = true;
    await sampler;
    await writeFile(path.join(outDir, "samples.json"), JSON.stringify(samples)).catch(() => {});
    await teardown().catch((error: unknown) => {
      if (bodyDone) throw error;
      console.error("[export-memory] teardown", error);
    });
  }
});
