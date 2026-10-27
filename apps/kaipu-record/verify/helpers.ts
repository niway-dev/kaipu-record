import { rm, mkdir, readdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
import { launchApp } from "../e2e/helpers/launch";

const OUT_ROOT = path.resolve(__dirname, "..", "test-results", "verify");

export interface Scenario {
  page: Page;
  vaultDir: string;
  /** Save `<outDir>/NN-<name>.png`; numbering keeps the steps in order. */
  shot: (name: string) => Promise<void>;
  /** Close the app (finalizes the video), then list what was written. */
  finish: () => Promise<void>;
}

/**
 * Launch the built app with video recording into a clean `test-results/verify/<name>/`.
 * The video is finalized only when the app closes, so always end with `finish()`.
 */
export async function startScenario(name: string): Promise<Scenario> {
  const outDir = path.join(OUT_ROOT, name);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const { page, vaultDir, teardown } = await launchApp({ recordVideoDir: outDir });
  let n = 0;
  return {
    page,
    vaultDir,
    shot: async (step) => {
      n += 1;
      await page.screenshot({
        path: path.join(outDir, `${String(n).padStart(2, "0")}-${step}.png`),
      });
    },
    finish: async () => {
      await teardown();
      // The app owns several windows and Playwright writes one .webm per page. The biggest
      // is the main window; keep it as video.webm and drop the small overlay recordings.
      const clips = await Promise.all(
        (await readdir(outDir))
          .filter((f) => f.endsWith(".webm"))
          .map(async (f) => ({ f, size: (await stat(path.join(outDir, f))).size })),
      );
      clips.sort((a, b) => b.size - a.size);
      for (const [i, { f }] of clips.entries()) {
        if (i === 0) await rename(path.join(outDir, f), path.join(outDir, "video.webm"));
        else await rm(path.join(outDir, f));
      }
      for (const f of (await readdir(outDir)).sort()) {
        const { size } = await stat(path.join(outDir, f));
        console.log(`[verify] ${name}: ${f} (${size} bytes)`);
      }
    },
  };
}
