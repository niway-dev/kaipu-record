---
title: "Kaipu benchmarks: state of the art (Sonnet)"
description: "Verbatim web research on how Electron and video apps benchmark, where results are stored, how regressions are detected, and what GitHub-hosted macOS runners allow, from Claude Sonnet 5.5 (effort medium), 2026-11-14."
sidebar:
  order: 2
---

> **Raw research, kept verbatim.** Worker: Claude Sonnet 5.5 (effort medium) with web search and fetch, 2026-11-14. Its brief is quoted first, then its report exactly as it came back, with local absolute paths made repo-relative. It is evidence for the [Kaipu benchmarks design](/specs/2026-11-15-kaipu-benchmarks-design/), not a decision: where they disagree, the spec wins.

## The brief it received

```text
Web research for a design decision. Do not write code. Context: an open-source Electron screen recorder + video editor (macOS first, Windows later; public GitHub repo so standard GitHub Actions runners are free). We want a benchmark suite that measures per scenario (idle, recording, screenshots, editing, long-video editing, export 1080p and 4K via WebCodecs/mediabunny in the renderer, playback) the memory per process (main, renderer, GPU — macOS phys_footprint, since RSS hides compressed memory), CPU, duration, output size, and bundle/startup weight when a library or animation is added. Results should be kept as artifacts over time, and regressions should be caught. A real incident: an export held the whole encoded video in renderer RAM (6.5 GB peak) and nothing caught it.

Answer these questions with sources (URLs), preferring primary docs, source code and engineering blog posts:
1. How established Electron apps benchmark perf/memory in CI: VS Code (perf tests, `--prof-startup`, startup perf bot), Slack, Discord, Figma desktop, Element/Signal desktop, Obsidian. What drives the scenarios (Playwright `_electron`, custom harness, CDP), what they measure (app.getAppMetrics, process.memoryUsage, performance marks, heap snapshots).
2. Chromium/Firefox perf infra as reference: Chromium Perf dashboard / Pinpoint / "telemetry" memory benchmarks, Mozilla Perfherder/AreWeFastYet: how they store results, compute regressions (noise, thresholds, change-point detection), alert.
3. Lightweight tools for storing benchmark history from GitHub Actions: github-action-benchmark (benchmark-action) with gh-pages storage and alert thresholds; Bencher.dev; CodSpeed; Conbench; plain artifacts + JSON committed to a data branch/repo. Adoption, maintenance status, limits (e.g. artifact retention 90 days, gh-pages size).
4. Bundle size tracking: size-limit, bundlewatch, relative-ci, Bundle analyzer / rollup-plugin-visualizer, statoscope; how they comment on PRs; which work for electron-vite (Vite/Rollup) output and an electron-builder .dmg/.app.
5. GitHub-hosted macOS runner limits relevant to this: Apple silicon vs Intel (macos-14/15 arm64), whether they are VMs, no GPU / Metal availability (paravirtualized?), screen recording TCC permission (can ScreenCaptureKit/desktopCapturer work? known workarounds like tccutil/ modifying TCC.db, or not possible on SIP-enabled images), CPU/RAM sizes, noisy-neighbour variance and what that means for perf measurements (relative vs absolute thresholds). Also self-hosted runners on a Mac mini for a public repo: GitHub's security warning about self-hosted runners on public repos (fork PRs running code).
6. Measuring memory on macOS: `footprint` tool, phys_footprint vs RSS, `vmmap --summary`, `memory_pressure`, task_info from Node, whether Electron's app.getAppMetrics() memory.privateBytes/workingSetSize maps to phys_footprint on macOS. Any known gotchas sampling at intervals (missed peaks), and approaches for peak memory (ledger peak, `footprint --sample`, `/usr/bin/time -l` max RSS).
7. How video editors / recorders benchmark (OBS, Kdenlive/MLT, Shotcut, Olive, Cap (cap.so, open source recorder), Screen Studio if any public info, ffmpeg FATE): synthetic fixtures (ffmpeg testsrc), long-take fixtures, export throughput (fps realtime factor), A/V drift.

Return 15–25 findings grouped by question number, each: one sentence of the finding, the URL, and one sentence on adoption/maintenance status (last release/commit if you can see it). Then a section "Implications" with 5–8 bullets that state what this means for our design (CI vs real hardware split, storage, thresholds). Mark anything you could not verify as unverified. Keep it under 1500 words.

```

## The report

## Findings

**Q1: Electron app benchmarking (thin evidence)**

- VS Code's chat perf suite (`npm run perf:chat`, `perf:chat-leak`) launches the real app, takes the median over several runs, and compares against a released build with Welch's t-test. It forces GC and measures renderer heap and DOM nodes. Memory metrics are informational only and never fail CI. https://skills.sh/microsoft/vscode/chat-perf. Status: this is a third-party mirror of the skill file, so verify the paths in microsoft/vscode.
- I found nothing public for Slack, Discord, Figma, Element, Signal or Obsidian. Treat those as **unverified**.
- Electron's `app.getAppMetrics()` has memory fields since the 2019 change (#18831). A Sentry report says calling it had side effects in their SDK. https://ayakael.net/mirrors/electron/commit/103b38650f8444ae0d8ac4774484f158da74eb5d. Status: stable API.
- Electron's docs say `workingSetSize` is "memory pinned to actual physical RAM", reported in KB. `privateBytes` is marked Windows-only. https://raw.githubusercontent.com/electron/electron/main/docs/api/structures/memory-info.md. Status: current main.
- The OpenCode e2e performance harness suggests Electron's `contentTracing` API for a packaged benchmark that needs per-process attribution. https://upd.dev/anomalyco/opencode/src/branch/dev/packages/app/e2e/performance. Status: a mirror, so I did not check how active it is.
- CodSpeed has an Electron plus Playwright integration. https://codspeed.io/docs/benchmarks/nodejs/playwright. Status: whether it is production-ready is unverified.

**Q2: Chromium and Mozilla infrastructure**

- Chromium uploads to the ChromePerf dashboard, which groups anomalies per time series and alerts the sheriff configured for that series. Pinpoint then bisects to the culprit commit. https://chromium.googlesource.com/chromium/src/+/main/docs/speed/addressing_performance_regressions.md. Status: maintained. The detection algorithm in the docs is only described in older slides (https://noti.st/anniesullie/JiY9Up/slides).
- Perfherder compares a revision with about 12 earlier and up to 11 later revisions using a Student's t-test. An alert also has to pass a magnitude threshold. https://arxiv.org/pdf/2606.18377. Status: a 2026 study covering 17,989 alerts.
- That study reports notable false-positive and missed-detection rates, and blames the normality and equal-variance assumptions of the t-test.
- Mozilla's own bugs discuss setting the t-threshold very high because of noise, and switching to Mann-Whitney U. https://bugzilla.mozilla.org/show_bug.cgi?id=1581533. Status: whether the switch shipped is unclear.
- I did not find AWSY or AreWeFastYet details (**unverified**).

**Q3: Storing history**

- github-action-benchmark stores results on a `gh-pages` branch. It has `alert-threshold` as a percentage (such as 150%), a separate `fail-threshold`, `comment-on-alert` and `auto-push`. Defaults for fail and comment are false. https://github.com/benchmark-action/github-action-benchmark. Status: I did not verify the last release. The comparison is only against the previous point, so it has no noise model.
- Bencher runs `main` as the baseline and supports `--threshold-test t_test` with a max sample size and an upper boundary. PRs clone the thresholds and fail with `--error-on-alert`. https://bencher.dev/docs/how-to/track-benchmarks. Status: actively documented. The free plan is for public projects only. https://bencher.dev/pricing/
- Bencher's docs warn that fork PRs get no secrets, so the API token is empty there. https://bencher.dev/docs/how-to/github-actions
- CodSpeed added a memory instrument in January 2026, but only for Rust and C/C++ so far. Its macro runners are 16-core ARM64 bare metal, with 600 free minutes per month. https://codspeed.io/changelog/2026-01-21-track-memory-usage-with-memory-instrument. Status: active. It is not suited to measuring Electron processes.
- Conbench, the 90-day artifact retention, and `gh-pages` size limits are **unverified**. The 90-day figure is from memory.

**Q4: Bundle size**

- bundlesize is in maintenance mode. BundleWatch replaced it and reports status on PRs. https://www.github.com/bundlewatch/bundlewatch
- I could not verify size-limit, relative-ci, statoscope, or rollup-plugin-visualizer with Vite, `.dmg` sizes, or PR comments. They are **unverified** here.
- BundleMon (https://github.com/mourner/bundlemon) appeared in the results. Its maintenance status is unverified.

**Q5: macOS runners**

- Free `macos-14` is M1 arm64 with 3 cores, 7 GB RAM and 14 GB storage. https://docs.github.com/en/actions/reference/runners/github-hosted-runners. Status: the current docs.
- Those docs say nested virtualization and Metal Performance Shaders are not supported, a limit of Apple's Virtualization Framework. https://github.com/actions/runner-images/issues/9254. Status: active repo.
- GitHub says each hosted runner is a new VM in Azure data centers. https://docs.github.com/en/actions/using-github-hosted-runners/using-github-hosted-runners/about-github-hosted-runners
- Screen recording permission has no CLI grant path on hosted macOS. A TestCafe issue reports it is only grantable through the UI and mentions a TCC.db edit. https://github.com/DevExpress/testcafe/issues/6789. Status: unclear. I could not verify that the edit works on current images.
- `CGPreflightScreenCaptureAccess()` always returns false for ad-hoc or unsigned binaries on Sequoia, per https://github.com/CapSoftware/Cap/issues/1722.
- GitHub's guidance: "self-hosted runners should almost never be used for public repositories". Any fork PR can run code on them, and they are not ephemeral by default. https://docs.github.com/en/actions/reference/security/secure-use. Status: current docs.
- Noisy-neighbour variance on the hosted runners is **unverified**. I found no measurement.

**Q6: macOS memory measurement**

- `footprint` reports `phys_footprint` and the peak. It counts dirty pages even when compressed. One developer saw `ps` RSS total 4.1 GB against 62.7 GB in `footprint`. https://dev.to/alexey-pelykh/the-rss-illusion-63-gb-process-on-a-32-gb-machine-298n. Status: a single blog post, but consistent with the Apple docs.
- `ri_phys_footprint` from `proc_pid_rusage` gives the same number as Activity Monitor. Firefox moved to `task_info`'s `phys_footprint` for total memory. https://bugzilla.mozilla.org/show_bug.cgi?id=1786860. Status: a Mozilla bug with a stated rationale.
- A Bun reference claims `rss()` equals `phys_footprint` on macOS. That conflicts with the other sources, so it is **unverified**. https://bun.com/reference/bun/unsafe/memoryFootprint
- My inference: Electron's `workingSetSize` on macOS is likely RSS-like, not `phys_footprint`. I did not confirm it in Electron's source.
- The `footprint --sample`, `vmmap --summary`, and `/usr/bin/time -l` peak approaches are **unverified**. The `footprint` output does include a peak.

**Q7: Video tools**

- Cap's public material has only changelog notes about timestamp reworks and sync offsets, and no benchmark method. https://help.cap.so/en/articles/12398843-troubleshooting-video-and-audio-sync-issues. Status: vendor text.
- OBS, Kdenlive, MLT, Shotcut, Olive, FATE and Screen Studio: nothing found (**unverified**).

## Implications

- **Split the suite.** Hosted macOS runs only what needs no screen capture or GPU: bundle size, startup, and an export fed from a synthetic fixture. Real hardware (your Mac mini, run by you) covers recording, ScreenCaptureKit, 4K export, and GPU memory.
- **Make the export test the incident guard.** It runs on a generated `testsrc` file and fails if renderer `phys_footprint` peak exceeds a budget tied to the input size. A fixed cap catches the 6.5 GB case even on a noisy runner, because the regression is a large multiple.
- **Use two kinds of threshold.** Memory and size get absolute budgets, since they are nearly deterministic. CPU and time get a relative check against `main` over the median of 5 or more runs, with Welch or Mann-Whitney as VS Code and Mozilla do. A single-previous-point percentage check is the weaker option.
- **Sample at intervals and record the peak.** Poll `footprint` or `proc_pid_rusage` per process every 250 ms or so, and also read the final peak value. The peak mechanism itself is unverified, so test it before trusting it.
- **Store history outside the 90-day artifacts.** Upload the raw JSON as an artifact, and also push it to a data branch or send it to Bencher, which is free for public projects. github-action-benchmark is the simplest option, but it has no noise model.
- **Mac mini runner only for trusted code.** GitHub says not to use self-hosted runners on public repos. Run it on `main`, tags, and a manual dispatch, never on fork PRs. Use a dedicated user and an ephemeral or JIT setup.
- **Screen recording permission.** The CI tests that need it should run only on the Mac mini, with the permission granted once by hand to a stably signed test build. An ad-hoc signed build fails the preflight.
- **Bundle tracking is still open.** I could not verify size-limit, relative-ci, or statoscope against electron-vite. Prototype one on the main, preload, and renderer outputs, and measure the `.dmg` and `.app` sizes with a plain script.
