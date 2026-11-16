# Decode benchmark (NIW2-818 M0)

Measures how long and how much memory it takes to decode a long recording's audio to
16 kHz mono signed 16-bit PCM in a Chromium renderer with mediabunny (WebCodecs), streaming in
4 s chunks, and whether it blocks the main thread. It runs the real `decodeAudioToPcm` and
`pcm-convert.ts` from the M1 branch (`src/renderer/src/features/transcription/audio/`), bundled
for the browser by `build.ts`. Nothing in the app tree is modified.

## Files

- `entry.ts`: browser side. Runs the decode, discards each chunk (counting bytes), and runs two
  heartbeats on the same thread as the decode (a `requestAnimationFrame` loop and a 16 ms
  `setInterval`) to measure the longest main-thread stall.
- `open-recording-input-shim.ts`: same body as the app's `lib/open-recording-input.ts`
  (`new Input({ source: new UrlSource(url), formats: ALL_FORMATS })`).
- `build.ts`: `Bun.build` for the browser; aliases the two app imports (`@renderer/lib/open-recording-input`
  to the shim, `@shared/types/transcription` to the 16000 constant) and forces a single copy of
  `mediabunny` (two copies break the `instanceof InputAudioTrack` check).
- `server.ts`: static server on 127.0.0.1 only, with `Range` support, for the page, the bundle and
  the media file at `/media.mp4`.
- `run.ts`: builds, serves, launches headless Chrome (`channel: "chrome"`, `--headless=new`) per
  run, samples RSS with `ps` every 100 ms, prints one JSON line per run, and stops the server.
  The output has sizes and ffprobe numbers only, no path and no media content.

## Run

```sh
cd apps/kaipu-record/scripts/spikes/transcription-m0/decode-bench
bun run.ts \
  --audio-dir <M1 worktree>/apps/kaipu-record/src/renderer/src/features/transcription/audio \
  --media "<a .mp4 from ~/Movies/Kaipu Record*>" --runs 2
```

Needs Google Chrome installed and `@playwright/test` (from `apps/kaipu-record/node_modules`).
The bundle goes to `/tmp/niw2-818-decode-bench/` (override with `--out`). Do not run it through
the repo's Playwright test runner; it is a plain script.

## What is measured

- Wall time of the whole `decodeAudioToPcm` loop, audio seconds decoded, real-time factor
  (audio duration / wall time), chunk count and sizes, total PCM bytes against
  `duration * 32000`.
- Main-thread stalls: gaps between rAF callbacks and between 16 ms timer ticks during the
  decode (count, p50, p99, max, how many exceed 100 ms).
- Memory: peak RSS of the renderer process (the largest of the browser's renderer processes
  at start-up; there is one page), peak RSS summed over the whole Chrome process tree (found by
  the profile directory in the command line), and peak `performance.memory.usedJSHeapSize`
  (sampled every 500 ms; Chrome quantizes it and the PCM lives in ArrayBuffers outside the JS
  heap, so it barely moves).
- After the timed part, one `gc()` (the page runs with `--js-flags=--expose-gc`) and the RSS
  1.5 s later, to tell memory that V8 can collect from memory that stays.

## Caveats

- Chunks are discarded at once; a real consumer (IPC to the main process) can only make the
  decode slower, never faster.
- A run is a few seconds long, so RSS is sampled at 100 ms, not 500 ms.
- RSS includes memory the allocator keeps after a free; the post-GC number is not a leak test.
- Every media file here is a local file read through `Range` over loopback HTTP, as with the app's
  `kaipu-media://` protocol, not a network source.
