/**
 * Bundles entry.ts for the browser. The audio code under test lives in another worktree (the
 * M1 branch), so its directory comes from --audio-dir. Its two app aliases are mapped here:
 * `@renderer/lib/open-recording-input` to the shim next to this file, and
 * `@shared/types/transcription` to the one constant it needs.
 *
 *   bun build.ts --audio-dir <.../src/renderer/src/features/transcription/audio> --out <dir>
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  if (!value) throw new Error(`missing --${name}`);
  return resolve(value);
}

const audioDir = arg("audio-dir");
const outDir = arg("out");
mkdirSync(outDir, { recursive: true });

const entry = join(outDir, "entry.ts");
writeFileSync(
  entry,
  readFileSync(join(import.meta.dir, "entry.ts"), "utf8").replace(
    "TRANSCRIPTION_AUDIO_DIR",
    audioDir,
  ),
);

const result = await Bun.build({
  entrypoints: [entry],
  outdir: outDir,
  naming: "bundle.js",
  target: "browser",
  format: "esm",
  plugins: [
    {
      name: "app-aliases",
      setup(build) {
        // One copy of mediabunny for both the audio code and the shim: two copies make the
        // `instanceof InputAudioTrack` check inside AudioSampleSink fail.
        build.onResolve({ filter: /^mediabunny$/ }, () => ({
          path: Bun.resolveSync("mediabunny", audioDir),
        }));
        build.onResolve({ filter: /^@renderer\/lib\/open-recording-input$/ }, () => ({
          path: join(import.meta.dir, "open-recording-input-shim.ts"),
        }));
        build.onResolve({ filter: /^@shared\/types\/transcription$/ }, () => ({
          path: "shared-transcription",
          namespace: "shim",
        }));
        build.onLoad({ filter: /.*/, namespace: "shim" }, () => ({
          contents: "export const TRANSCRIPTION_PCM_SAMPLE_RATE = 16000;",
          loader: "ts",
        }));
      },
    },
  ],
});
if (!result.success) {
  for (const log of result.logs) console.error(String(log));
  process.exit(1);
}
console.log(`built ${join(outDir, "bundle.js")}`);
