---
title: "Kaipu benchmarks: repo sweep (Haiku)"
description: "Verbatim digest of every ADR, backlog doc, CI workflow, driver and hub page that bears on a performance benchmark suite, from Claude Haiku 5.5 (effort high), 2026-11-14."
sidebar:
  order: 1
---

> **Raw research, kept verbatim.** Worker: Claude Haiku 5.5, Explore agent (effort high), 2026-11-14, read-only sweep of the repository and the general-knowledge hub. Its brief is quoted first, then its report exactly as it came back, with local absolute paths made repo-relative. It is evidence for the [Kaipu benchmarks design](/specs/2026-11-15-kaipu-benchmarks-design/), not a decision: where they disagree, the spec wins.

## The brief it received

```text
Read-only sweep of a monorepo for a design. Topic: a performance benchmark suite for the Electron desktop app (apps/kaipu-record) that measures RAM (macOS phys_footprint per process), CPU, duration, output size and bundle weight per scenario (idle, recording, screenshots, editing, long-video editing, export 1080p/4K, playback), and keeps results as artifacts over time.

Repo: ~/.t3/worktrees/kaipu-record-monorepo/feature-niw2-808-kaipu--5c05e6ce3ca795ca (cd to this absolute path in every command). Hub: <hub>

Find and report, each with path and the exact sentence(s) that bear on the topic:
1. ADRs. Locate the ADR folder (likely under apps/documentation/src/content/docs/, e.g. architecture/ or a decisions folder; `grep -ril "^# ADR\|Status:" apps/documentation/src/content/docs | head`). List EVERY ADR title (number + title, one line each). Then flag the ones touching: performance, memory, benchmarks, CI/GitHub Actions, E2E/verify/Playwright, UI catalog, Mac mini, release/build, bundle size, export pipeline, artifacts storage, evidence.
2. Backlog/specs/plans docs mentioning perf, memory, RAM, benchmark, footprint, bundle size, profiling: `grep -ril "benchmark\|footprint\|bundle size\|memory leak\|RAM\b\|perf" apps/documentation/src/content/docs | head -40`, then the relevant lines.
3. Existing real-app drivers: the "verify scenarios" (Playwright Electron) and the UI catalog (`ui-catalog`). Where they live, how they launch the app (built app vs dev), how they run on a remote Mac mini (scripts with ssh/macmini/REMOTE_WORKTREE), and whether any measures time/memory. List file paths and the entry commands from package.json scripts.
4. CI: list .github/workflows/*.yml with one line each on what they do and which runner (macos-*, ubuntu-*). Note any that build the desktop app, run E2E, upload artifacts, or comment on PRs. Note any size/bundle check.
5. Build output: what electron-vite / electron-builder produce (out/, dist/), and any existing script that reports bundle or asset sizes.
6. Any existing perf instrumentation in apps/kaipu-record/src (performance.mark, process.memoryUsage, getAppMetrics, PerformanceObserver, a "perf" or "metrics" module, telemetry/PostHog events with durations).
7. Hub: `git -C <hub> grep -il "benchmark\|performance budget\|footprint\|electron.*memory\|regression threshold\|artifact"` — list the matching pages and the exact sentences relevant to benchmarking/perf measurement.
8. Test fixtures: any long sample video/recording fixtures in the repo or a script that generates synthetic recordings (ffmpeg testsrc etc.).

Return a digest, max ~900 words, grouped by the 8 headings. One line per item: path — exact quoted sentence or fact. Mark explicitly "none found" where nothing exists. Flag any contradiction you notice (e.g. an ADR forbidding something the topic needs, like running Electron on macOS GitHub runners). Do not propose designs.

```

## The report

## 1. ADRs

Folder: `apps/documentation/src/content/docs/architecture/decisions/` holds 47 ADRs plus `index.mdx`. Numbers 0011 to 0019 are absent from this checkout. Titles are shortened. `*` marks a topic match.

- 0001 Mediabunny over FFmpeg for recording `*` (bundle, RAM, export)
- 0002 Plan entitlements separate from auth
- 0003 Export never replaces the original `*` (export)
- 0004 Local-first release verification, superseded by 0010 `*` (CI, E2E)
- 0005 Draft to Ready is the RC signal `*` (CI)
- 0006 Desktop E2E in the candidate tier `*` (macOS E2E, runner cost)
- 0007 Prod previews via Version URLs
- 0008 StyleX shared styling
- 0009 Shared UI takes no dependencies
- 0010 Checks in Actions on every PR, superseded by 0027 `*` (CI)
- 0020 Tags are entities with stable ids
- 0021 Tag sync opt-in, server-versioned
- 0022 Screenshot capture native per OS
- 0023 One release workflow, build job per OS, one publisher `*` (release, artifacts)
- 0024 Window mode and quiet capture
- 0025 Desktop signs in through the browser
- 0026 Zod is the only env schema
- 0027 Only release candidates verified in Actions `*` (CI, E2E; Accepted)
- 0028 Advisory Claude review on PRs `*` (PR comments)
- 0029 Floating windows and activation policy
- 0030 Recording target and area crop in compositor `*` (perf-adjacent)
- 0031 Explicit shutdown with a deadline
- 0032 Workspaces identity in the folder
- 0033 Moving items between workspaces
- 0034 Per-workspace setting overrides
- 0035 File name follows the title
- 0036 Library reconciles with folder on demand
- 0037 Webcam as its own track
- 0038 Webcam as viewport layer after zoom crop
- 0039 Camera sections, eased transitions
- 0040 Typed tracks on demand, stackable lanes
- 0041 Camera shape circle, square or 3:4
- 0042 Capture ends in the preview card
- 0043 Capture destination and quiet copy
- 0044 UI catalog runs the real app on the Mac mini `*` (catalog, Mac mini, Electron; status Proposed)
- 0045 UI catalog images in a separate repo `*` (artifact storage)
- 0046 Typed UI map of screens, areas, states `*` (catalog)
- 0047 Native capture crops at source `*` (perf-adjacent)
- 0048 Console is the admin-kit panel
- 0049 Typed flag registry; Labs opt-in
- 0050 Track visibility is view state
- 0051 Video background reuses beautify model
- 0052 RC verifies only the component it ships `*` (CI; mentions a flaky desktop performance test)
- 0053 Image editor is a canvas document
- 0054 Inspection tools read captured pixels
- 0055 Text recognition port, OS engine `*` (Windows OCR timing)
- 0056 Capture widget docks to work area

Key sentences:

- `0045-ui-catalog-images-live-in-a-separate-repository.mdx`: "Storing PR evidence, `verify/` scenario artifacts, videos, or `.evidence/` content of any other kind there. The catalog holds still PNGs only."
- `0006-desktop-e2e-in-the-candidate-tier.mdx`: "macOS runners bill at ten times the Linux rate."
- `0044-...mdx`: "Electron never runs on the owner's laptop."

## 2. Backlog, specs, plans

- `apps/documentation/src/content/docs/backlog/recording-compositor-perf.md:45`: "The honest measurement is the **[Benchmark propio](./index)** backlog item (CPU/RAM/frames dropped). **Measure before optimizing**". No file defines that item, so the link is dangling.
- `apps/documentation/src/content/docs/marketing/messaging-playbook.md:74-88`: "## The benchmarks page" lists RAM at idle ("Activity Monitor after five minutes"), CPU at 1080p60, installer size, time to first frame and export time for a one-minute clip.
- `apps/documentation/src/content/docs/desktop/electron-vs-tauri.mdx:127`: "idles under ~150 MB and records under ~15% CPU". This is the only numeric budget in the docs. Nothing in code enforces it.
- `apps/documentation/src/content/docs/audits/2026-10-15/report.md:23`: magnitudes "come from micro-benchmarks outside the app, **not from measuring the running app**".
- `apps/documentation/src/content/docs/backlog/fable-audit-results.md:75`: fastStart "buffers the ENTIRE recording in renderer RAM", marked fixed.
- `apps/documentation/src/content/docs/backlog/export-presets.md:268` links an encoding benchmark. That page is absent from this checkout. It exists in commit `347ebae0` on the local ref `origin/docs/encoding-benchmark-2026-10`, and that ref was not fetched.
- Perf-named files not read: `plans/audit-2026-10-15/24-recording-start-latency.md`, `25-compositor-cadence.md`, `27-video-editor-rerender.md`, `backlog/screen-picker-thumbnail-perf.md`, `backlog/capture-panel-latency.md`.
- The web app's `frontend/web-vitals-baseline.md` is not desktop.

## 3. Existing real-app drivers

- Verify scenarios: `apps/kaipu-record/verify/` (about 23 `*.verify.ts`). Config `verify/playwright.config.ts` says "Not part of CI and not the e2e suite". Output goes to `test-results/verify/`.
- Launch helper `apps/kaipu-record/e2e/helpers/launch.ts:154-168` calls `electron.launch` on `MAIN_ENTRY` or `APP_ROOT`, so it runs the built app.
- Entry commands in `apps/kaipu-record/package.json`: `proof` (build, then verify config), `proof:run`, `test:e2e`.
- UI catalog: `apps/kaipu-record/ui-catalog/cli.ts` and `run.ts`. Commands `ui-catalog`, `ui-catalog:remote`, `ui-catalog:publish`.
- Remote runner: `apps/kaipu-record/scripts/ui-catalog-remote.sh`. `REMOTE_HOST` defaults to `macmini`. The mini uses its own worktree at `~/Documents/Workspace/Agent/kaipu-record-ui-catalog`, and the run is a launchd job. "A full run is ~10 minutes."
- Allow-list: `apps/kaipu-record/ui-catalog/runners.json`. `guard.ts` refuses other hosts.
- Timing and memory: none in the catalog or `verify/`. `verify/image-colors.verify.ts:202-216` logs `listMs` and `locateMs`.
- Only memory harness: `apps/kaipu-record/scripts/spikes/image-editor-m0/color-memory/run-on-macmini.sh`, with `electron-spike.cjs:294-298` using `app.getAppMetrics()` and `/usr/bin/footprint -p <pid> -f bytes --noCategories`.

## 4. CI

All under `.github/workflows/`:

- `cache-cleanup.yml`: cache pruning on PRs, ubuntu-latest.
- `ci-api.yml`: API tests, dispatch only, ubuntu.
- `ci-desktop.yml`: desktop tests, dispatch only. Runs `xvfb-run ... bun run test:e2e` on ubuntu (line 125). Uploads `playwright-report` on failure (line 129).
- `ci-web.yml`: web tests, dispatch only, ubuntu.
- `ci.yml`: legacy CI, dispatch only, ubuntu.
- `pr-checks.yml`: PR gate on ubuntu. `e2e_desktop` runs on `macos-latest`, 30-minute timeout (lines 664-667), and uploads `playwright-report-pr` (line 737). This is the only PR-triggered macOS Electron job.
- `preview-web.yml`: web preview, ubuntu.
- `pullfrog.yml`: agent workflow, ubuntu.
- `release-api.yml`, `release-web.yml`: tag releases, ubuntu.
- `release-desktop.yml`: tag releases. `build-mac` on `macos-latest` (line 103) runs Playwright against the build. `build-win` on `windows-latest`. `publish` on ubuntu. Uploads artifacts at lines 226, 269, 374.
- `release-please.yml`: ubuntu.
- `text-recognition-windows.yml`: PR and dispatch, `windows-latest`. Job `measure` times OCR with a 1.5 s target and uploads `windows-ocr-report` (lines 75-79).
- `wachiman-review.yml`: reusable `niway-dev/wachiman` review. Runner is not declared here.

No workflow runs `ui-catalog` or `verify`. No size or bundle check is present. No workflow posts PR comments through `github-script` or `gh`.

## 5. Build output

- `apps/kaipu-record/package.json`: `build` = `build:native-capture && check-types && electron-vite build`. Main entry is `./out/main/index.js`.
- `apps/kaipu-record/electron-builder.yml` sets `buildResources` and `artifactName` only. It sets no `directories.output`, so the default `dist/` applies.
- Size reporting: none found. Grep for `du`, `size-limit`, `bundlesize`, `wc -c` and `stat` in `.github/`, `scripts/` and `apps/kaipu-record/scripts/` returned nothing.

## 6. In-app instrumentation

- No `process.memoryUsage`, `getAppMetrics`, `PerformanceObserver`, `performance.mark` or `getProcessMemoryInfo` under `apps/kaipu-record/src`.
- `performance.now()` is used only for recording clocks, e.g. `src/renderer/src/features/recording/recorder-engine.ts:1321`.
- Telemetry: `src/renderer/src/features/analytics/analytics-client.ts:69` `captureEvent(name, props)`. No call site passes a duration or memory value. Main-process analytics captures exceptions only.
- Not read: `src/renderer/src/features/screenshots/canvas/use-shot-metrics.ts`.

## 7. Hub

Hub root: `<hub>`.

- `desktop/electron-vs-tauri.md:114-116`: "Sum `phys_footprint` over the Electron main process and every descendant ... about 20 s after launch with no work running. On macOS, `footprint -p <pid>` reports it; RSS under-counts because of memory compression and is not comparable."
- `desktop/electron-vs-tauri.md:117`: "Idle CPU must be ~0 %, summed over the same tree."
- `conventions/evidence-driven-optimization.md:20-28`: three artifacts (evidence file, budget table, optimization record). "A budget row with no evidence behind it is a guess".
- `monorepos/ci-runner-cost.md:252-262`: "Set `retention-days` explicitly on anything large; the default is 90." Also "Free's 500 MB allowance is smaller than a single Electron build's output."
- `distribution/electron-macos.md:94`: "The build jobs only build and upload `dist/` as workflow artifacts."
- No hits for "performance budget" or "regression threshold".

## 8. Test fixtures

- `apps/kaipu-record/e2e/fixtures/sample.mp4` (77,054 bytes) and `sample.png`.
- `apps/kaipu-record/verify/timeline-zoom.verify.ts:27-47`: `const LONG = 605` (10:05). `fixture(seconds)` generates the take with ffmpeg lavfi `testsrc2=size=1280x720:rate=30` plus `sine`, into `os.tmpdir()`. It is not committed.
- `verify/background.verify.ts:29` and `background-gallery.verify.ts:24`: `SECONDS = 3`, lavfi `color`.
- `apps/kaipu-record/ui-catalog/fixtures/make-fixtures.ts:151-159`: ffmpeg via `execFileSync`.
- `apps/web-hono/public/demos/*.mp4|webm` are website demos, not desktop fixtures.
- No committed long recording exists.

## Flags and contradictions

- ADR 0027 (Accepted) allows full verification, including macOS E2E, only on release-please PRs and manual dispatch. A benchmark gating ordinary PRs would reverse it.
- ADR 0044 rejects a hosted macOS runner for the catalog. But `pr-checks.yml` and `release-desktop.yml` already run Electron on `macos-latest` (ADR 0006). The rejection reasons are GUI, permissions and fonts. The contradiction is in the stated basis, not the practice.
- ADR 0044 is marked "Proposed", but `ui-catalog/`, `runners.json` and `ui-catalog-remote.sh` already exist. Status is stale.
- `desktop/electron-vs-tauri.mdx` calls itself an ADR but lives outside the ADR folder.
- ADR 0052 cites a "flaky desktop performance test" blocking PR #429. I did not locate that test.
- Owner rule "No local E2E" and ADR 0044 both mean Electron runs only on the Mac mini or a hosted runner.
