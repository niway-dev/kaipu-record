import { rm, mkdir, readdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";
import { launchApp } from "../e2e/helpers/launch";

const OUT_ROOT = path.resolve(__dirname, "..", "test-results", "verify");

export interface ScenarioOptions {
  /** Extra environment for Electron, such as `KAIPU_FLAG_OVERRIDES`. */
  env?: Record<string, string>;
  /**
   * A scenario that launches the app more than once (one side per flag state) keeps the
   * output folder from the earlier launches instead of clearing it.
   */
  keepOutput?: boolean;
  /** Shot numbering starts after this many shots already taken by an earlier launch. */
  shotOffset?: number;
  /** Basename of the finalized video (default `video`), so launches do not overwrite it. */
  videoName?: string;
  /** Fills the throwaway vault before launch (default: the suite's two fixtures). */
  seedVault?: (vaultDir: string) => Promise<void>;
  /** Extra `settings.json` keys, merged over the suite's pinned locale. */
  settings?: Record<string, unknown>;
  /** Writes into the throwaway userData before launch (a stored session, for example). */
  seedUserData?: (userDataDir: string) => Promise<void>;
}

export interface Scenario {
  app: ElectronApplication;
  /** The folder the scenario writes into. */
  outDir: string;
  page: Page;
  vaultDir: string;
  /** Save `<outDir>/NN-<name>.png`; numbering keeps the steps in order. */
  shot: (name: string) => Promise<void>;
  /**
   * Close the app (finalizes the video), then list what was written. A failed close is
   * logged, not thrown: it runs in the scenario's `finally`, where a throw would replace the
   * scenario's own failure, and the clips are still kept.
   */
  finish: () => Promise<void>;
}

/**
 * Launch the built app with video recording into a clean `test-results/verify/<name>/`.
 * The video is finalized only when the app closes, so always end with `finish()`.
 */
export async function startScenario(
  name: string,
  options: ScenarioOptions = {},
): Promise<Scenario> {
  const outDir = path.join(OUT_ROOT, name);
  if (!options.keepOutput) await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const videoName = options.videoName ?? "video";
  // Clips left by an earlier launch must not be taken for this launch's recordings.
  const before = new Set(await readdir(outDir));
  const { app, page, vaultDir, teardown } = await launchApp({
    recordVideoDir: outDir,
    ...(options.env ? { env: options.env } : {}),
    ...(options.seedVault ? { seedVault: options.seedVault } : {}),
    ...(options.settings ? { settings: options.settings } : {}),
    ...(options.seedUserData ? { seedUserData: options.seedUserData } : {}),
  });
  let n = options.shotOffset ?? 0;
  return {
    app,
    outDir,
    page,
    vaultDir,
    shot: async (step) => {
      n += 1;
      await page.screenshot({
        path: path.join(outDir, `${String(n).padStart(2, "0")}-${step}.png`),
      });
    },
    finish: async () => {
      try {
        await teardown();
      } catch (error) {
        console.error(`[verify] ${name}: closing the app failed`, error);
      }
      // The app owns several windows and Playwright writes one .webm per page. The biggest
      // is the main window; keep it as video.webm and drop the small overlay recordings.
      const clips = await Promise.all(
        (await readdir(outDir))
          .filter((f) => f.endsWith(".webm") && !before.has(f))
          .map(async (f) => ({ f, size: (await stat(path.join(outDir, f))).size })),
      );
      clips.sort((a, b) => b.size - a.size);
      for (const [i, { f }] of clips.entries()) {
        if (i === 0) await rename(path.join(outDir, f), path.join(outDir, `${videoName}.webm`));
        else await rm(path.join(outDir, f));
      }
      for (const f of (await readdir(outDir)).sort()) {
        const { size } = await stat(path.join(outDir, f));
        console.log(`[verify] ${name}: ${f} (${size} bytes)`);
      }
    },
  };
}
