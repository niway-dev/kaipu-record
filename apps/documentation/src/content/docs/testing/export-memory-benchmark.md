---
title: "Testing: export memory benchmark"
description: "Export a real take through the real app and sample every process's memory, swap and bytes on disk. Results for desktop 0.18.0, main before the mediabunny 1.66 upgrade, and main after it."
---

# Export memory benchmark

`apps/kaipu-record/verify/export-memory.verify.ts` exports a real take through the real app
with the YouTube 1440p preset. It exports the take with its edit, webcam and cursor, the way a
user does. About every 5 s (5 s between samples, plus the time a sample takes) it records:

- each Electron process's physical footprint, from macOS `footprint`, the number Activity
  Monitor shows as "Memory";
- the swap in use;
- the bytes written so far to the export's `.part` file.

The renderer of the main window runs the export: it decodes, composites, encodes and holds the
MP4 writer. Its footprint is the number to watch.

## Running it

The scenario is opt-in. It needs a real take, which is not in the repository, and it runs as
long as the export does. Run it on the Mac mini, never on the laptop (it launches Electron).
It needs no screen recording permission, so a plain `ssh` session works.

Copy the take's `.mp4` to a folder, with its sidecar `.kaipu/<stem>.json`, which is
required. Copy also, when they exist, `.kaipu/<stem>.edit.json`, `<stem>.webcam.mp4`,
`<stem>.cursor.json` and the `<stem>.assets/` folder. Then, from `apps/kaipu-record` after
`electron-vite build` (rebuild after every `bun install`: the summary reads the mediabunny
version from `node_modules`, which describes `out/` only when `out/` is newer):

```bash
KAIPU_BENCH_SOURCE_DIR=<folder> KAIPU_BENCH_STEM="<take filename stem>" KAIPU_BENCH_LABEL=<label> \
  node node_modules/@playwright/test/cli.js test -c verify/playwright.config.ts export-memory
```

The scenario clones the files into a fresh workspace with `cp -c`: an APFS clone, instant and
taking no space, when the folder is on the same volume as the system's temporary folder, and a
full copy otherwise (it logs which). The copy ends before the app starts, so it does not change
what is measured. All runs below but the last two made full copies, from an earlier version
that could not clone. It waits 20 s for the editor to settle, then exports. It writes
`test-results/verify/export-memory-<label>/`:

- `summary.json`: the commit, whether tracked files differ from it (`dirty`), when `out/` was
  built, the installed mediabunny version, and which optional files were seeded (`seeded`); peak and idle footprint per role
  (`Tab:main-window` is the window the test drives, the one that exports; other roles are the
  GPU process, the main process, utility processes and the other windows); peak swap; wall
  time; seconds until the first megabyte reached disk; output size; and how many samples or
  readings failed (a sample with a failed reading counts toward no peak for that role);
- `samples.csv`: the curve, one column per role;
- `samples.json`: every reading per process, also written when the run fails;
- `export-<label>.mp4`: the exported file, for `ffprobe`. It is as large as the export (8.6 GB
  for the take below), and each run with a new label adds one, so delete it when done.

A run with a label already used replaces that label's folder, but only after the checks that come
before the launch pass: the sidecar `.kaipu/<stem>.json`, `git`, `out/` and the installed
mediabunny. The `.mp4` is checked later, by the seed, after the folder is replaced.

Compare builds on the same machine, one at a time, with nothing else running. The machine's
encoder decides the output bitrate, so the output size, and with it the memory, differs
between an M4 and an M5.

## Results, 2026-11-16

These are the numbers that decided whether the mediabunny upgrade could ship in desktop 0.19.0
before the export fix in [NIW2-806](https://linear.app/niway/issue/NIW2-806) (feeding audio
interleaved with video).

- **Machine:** M4 Mac mini, 16 GB RAM, macOS 27.0.1.
- **Take:** 1900 s of 1914×1042 at 60 fps, with a webcam track and a cursor track.
- **Edit:** 3 clips, auto zoom, cursor shown, so 1849 s of output.
- **Preset:** YouTube 1440p (2560×1440, 60 fps).

"Renderer" below is the export window's renderer process alone. The first four exports (0.18.0,
main before the upgrade, and the first two of main after it) used an earlier version of the
scenario that also counted a second, idle 57 MB window as the main window; the numbers here come from their per-process readings (`samples.json`), with that
window left out.

| Build                                | mediabunny | Renderer peak | Peak swap | Wall time | First MB on disk | Output  |
| ------------------------------------ | ---------- | ------------- | --------- | --------- | ---------------- | ------- |
| desktop 0.18.0 (`4576a489`)          | 1.61.4     | 9427 MB       | 6095 MB   | 862 s     | 840 s            | 8.63 GB |
| main before the upgrade (`c77752ef`) | 1.61.4     | 9490 MB       | 6303 MB   | 867 s     | 843 s            | 8.63 GB |
| main after the upgrade (`e025db93`)  | 1.66.0     | 9541 MB       | 6262 MB   | 867 s     | 843 s            | 8.63 GB |

Both main builds ran more than once; the table shows each one's first run. The later runs used
versions of the scenario that report the export window alone (`Tab:main-window`, with the idle
window as `Tab:other-window`, 57 MB). The seven runs after the upgrade produced identical packet
counts and durations; run 3 before the upgrade wrote the same layout as run 1 (3 track switches,
no edit list).

| Build                    | Runs | Renderer peaks (MB)          | Mean    | Wall time  |
| ------------------------ | ---- | ---------------------------- | ------- | ---------- |
| main before the upgrade  | 3    | 9490, 9586\*, 9554\*         | 9543 MB | 867–891 s  |
| main after the upgrade   | 5    | 9541, 9495, 9516, 9492, 9537 | 9516 MB | 866–867 s  |
| main after, contaminated | 2    | 9576\*, 9487\*               |         | 867–1311 s |

\* The Mac mini is shared, and other sessions used it during these runs:

- 9586 and 9554 MB (main before the upgrade, runs 2 and 3): another session's memory scenario ran
  through all of run 2 and most of run 3. Wall time rose to 888–891 s and peak swap to
  6630–6965 MB.
- 9576 MB (main after, run 6): another session installed and built the app during its last four
  minutes.
- 9487 MB (main after, run 7): another session exported the same take at the same time. Wall time
  rose to 1311 s, the load average to about 8, and peak swap to 7220 MB.

Those runs say how much contention moves each number. The renderer peak lands at most 45 MB
outside the range of the clean runs (9487–9586 against 9490–9541 MB). Wall time, the first MB on
disk and swap move much more, so the contaminated runs count for the peak only.

The two builds' ranges overlap, and main before the upgrade has the higher mean, by 27 MB. Its only clean run, 9490 MB, is 2 MB below the lowest of the five clean runs after the upgrade (9492–9541 MB, up to 49 MB or 0.5 % apart). The file was 8631462170 bytes in the first five runs after the upgrade
and 568 bytes smaller in the last two, the first with a cloned source (not investigated).

0.18.0 ran once. It is a different commit: its renderer starts about 205 MB lower (270 MB against
475–478 MB in the first main runs) but peaks only 63–114 MB lower than those runs, so it grows by
95–140 MB more over the export, 1.0–1.5 % of the peak. Against every main run, its peak is
60–160 MB lower.

Neither the GPU process nor the main process grows with the export. The GPU process goes from
about 100 MB idle to 370–440 MB when the export starts and stays there (peaks 422–504 MB). The
main process stays at 95–120 MB during the export and peaks at 148–1332 MB in its last
seconds, while the file is written. Swap
at the start was 2 MB for the first run and 3.7–4.7 GB for the later ones, left over from the
run before; the peak is about the same either way.

Renderer footprint over the export (MB), at the sample nearest each time. The `.part` file
stays at 28 bytes until the last 25 s in every build:

| Seconds after Export | 0.18.0 | main, 1.61.4 | main, 1.66.0 |
| -------------------- | ------ | ------------ | ------------ |
| 0                    | 270    | 475          | 478          |
| 125                  | 1555   | 1754         | 1710         |
| 250                  | 3398   | 3480         | 3500         |
| 377                  | 4550   | 4634         | 4648         |
| 505                  | 5923   | 5982         | 6015         |
| 635                  | 7622   | 7708         | 7740         |
| 766                  | 8791   | 8851         | 8893         |
| 832                  | 9427   | 9451         | 9490         |
| after (900)          | 292    | 451          | 448          |

What the file looks like on disk (`ffprobe` packets sorted by byte position):

| Build                   | Track switches on disk | Longest run of one track | Audio edit list | Audio duration |
| ----------------------- | ---------------------- | ------------------------ | --------------- | -------------- |
| 0.18.0 and main, 1.61.4 | 3                      | 1848.8 s                 | none            | 1849.259 s     |
| main, 1.66.0            | 7170                   | 1.02 s                   | media time 2112 | 1849.215 s     |

### What it shows

**The upgrade does not change export memory.** Main before the upgrade peaks at 9490–9586 MB
over three runs, main after it at 9492–9541 MB over five clean runs; the means are 27 MB apart,
and the earlier build is the higher one. 0.18.0 is within 160 MB (1.7 %) of every main run. From
250 s until the file is written, the three first-run curves stay within 3.3 % of each other at
every sample. The larger gap before that is the idle footprint: 0.18.0's renderer starts about
205 MB lower, and the gap narrows as the export runs.

**The memory grows with the export, and nothing reaches disk until the end.** That is the
symptom NIW2-806 explains from the code: the export worker feeds all the video, then all the
audio, and `fastStart: "reserve"` keeps encoded packets in memory until every track has one.
This benchmark measures the symptom, not that cause; re-running it on NIW2-806's branch is
what will confirm the fix.

**The problem is large on a 16 GB Mac.** A 31-minute YouTube export holds more than the whole
output file in the renderer: 9541 MB for a file of 8231 MB (8.63 GB), 1.16 times. In the one
run that started with swap empty (2 MB, the 0.18.0 run), swap peaked at 6095 MB; the later
clean runs started with 3.7–4.7 GB left over and peaked at 5625–6303 MB, and the contaminated
ones at up to 7220 MB. (`footprint` reports MB
of 2^20 bytes; the Output column is in GB of 10^9 bytes.) The growth is linear, so a longer
take or a 4K export should need proportionally more; that was not measured here.

**1.66.0 writes a properly interleaved file.** With 1.61.4 the file holds the whole video
track, then the whole audio track, so a player reading it from the start has to seek to the
end for the audio. With 1.66.0 the tracks switch about four times a second, and no
run of one track is longer than about 1 s. The 2112-sample edit list trims the AAC encoder's priming delay, which is why the audio is 44 ms shorter.
That the memory stays the same is consistent with 1.66.0 queueing packets in timestamp
order: the video waits for audio that the worker only sends at the end.

### Comparison with the first measurement

The first measurement (2026-11-14) ran on an M5 laptop in `bun run dev`, with mediabunny
1.61.4 and the same take. It peaked at 6519 MB, wrote 5.6 GB in about 10 s at the end, and
produced a 24 Mbps file. The mini produced 37 Mbps from the same cuts (1849 s of output on
both), so its file and its memory are both about 1.5 times larger; the hardware encoder is
the likely difference. Peak memory over output size, both in MB of 2^20 bytes, is similar on
both machines: 6519 / 5343 = 1.22 on the M5, 9541 / 8231 = 1.16 on the mini.
