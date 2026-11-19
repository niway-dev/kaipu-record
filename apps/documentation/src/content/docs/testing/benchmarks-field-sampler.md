---
title: "Testing: benchmarks field sampler (bench:attach)"
description: "Measure your own bun run dev session: every process's physical footprint, CPU, swap and the size of the growing export file, sampled each second, with phase marks and an output-grows invariant."
---

# Benchmarks field sampler

`bun run bench:attach` samples the dev app you already started. It is the field series of the
Kaipu benchmarks suite (Linear NIW2-808, ticket 9): same per-process columns as a mini run, on
your real long takes. It never launches Electron; it only reads `ps`, `footprint`, `vm_stat`,
`sysctl` and file sizes.

## How to run it

1. Start the app as usual: `bun run dev` in `apps/kaipu-record`.
2. In another terminal, from the repo root or `apps/kaipu-record`:

   ```bash
   bun run bench:attach --machine owner-M5
   ```

3. Start the long export. Type a label and press Enter to mark a phase ("export start",
   "scrub"). Every later row carries that phase.
4. Press Ctrl+C. It reads each live process's lifetime `phys_footprint_peak`, writes the run
   folder and prints a summary.

Options: `--watch-file <glob|dir>` (default `~/Movies/Kaipu Record/.kaipu/tmp/*.mp4.part`, the export parts only: other files in that
folder, such as transcription scratch files, are not watched), `--no-watch`, `--match <substring>` (default: this repo's root followed by `/`, so
it attaches to Electron binaries under this checkout's path, and not to a sibling directory that
shares the prefix; for another checkout pass its path), `--out <dir>`, `--duration <seconds>`.

## What it records

Run folder `apps/kaipu-record/bench/runs/<timestamp>-field/` (gitignored):

- `samples.csv`: one row per process per second: phase, pid, ppid, role, `phys_footprint`,
  RSS, CPU %, cumulative CPU seconds, threads.
- `system.csv`: swap used and total, compressed memory, free memory, memory pressure, load
  average, and `output_bytes` of the watched file.
- `run.json`: series `field / dev / <machine>`, git ref, phases, per-process lifetime peaks,
  per-role peaks, system peaks, the invariant verdict, tick cost and known limits. It is
  validated by a zod schema before it is written.

Roles come from the `--type=` argument Chromium passes to children: `main`, `renderer`, `gpu`,
`utility:<sub type>`, and `native:<executable>` for helpers. A renderer cannot be matched to a
window from outside the app. Memory is `phys_footprint`; RSS is recorded for comparison only
(on 2026-11-14 it showed 256 MB while the footprint was 3.1 GB).

Privacy: the file watcher stores byte sizes only, never file names. Command lines, titles and
the real hostname are never written; the machine label is the `--machine` value.

Cost: one tick (one `footprint` call for all PIDs, `ps`, `vm_stat`, `sysctl`) took 0.25 to 0.4 s
on an M5 with 11 processes; `run.json` records p50, p95 and max.

## The output-grows invariant

While the output file exists, its size on disk must keep increasing. It fails when the time
between two increases is more than 30 s (or a new file stays flat for 30 s or more). Each file is judged on
its own: a file that was already in the folder when sampling started is judged only from its
first increase and ignored if it never changes, so idle leftovers never cause a violation. On 2026-11-14 the file
stayed at 28 bytes for four minutes, then jumped to 5.59 GB: that violates it, provided sampling
started before the file was created. If you attach when the file already exists, the flat stretch
before its first increase is not judged, so the same incident reads as held or inconclusive.
Start `bench:attach` before the export. The flat tail
after the last increase is not counted, since a finished export stays flat until it is renamed.
The verdict is `held`, `violated`, or inconclusive (no file, or seen too briefly).

The pure logic lives in `apps/kaipu-record/bench/` (parsers, discovery, phases, schema,
invariant) with tests next to it; `attach.ts` and `collect.ts` hold the side effects.
