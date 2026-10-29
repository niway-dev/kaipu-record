---
title: Audit 2026-10-15 — fix plans index
description: One implementation plan per root cause for every finding of the 2026-10-15 pre-deploy audit. Every finding maps to exactly one plan; the PR that ships a plan deletes it.
---

# Audit 2026-10-15 — fix plans

**Status: 🟡 In progress — 12 of 36 plans shipped, 24 open.** Source: the
[audit report](/audits/2026-10-15/report/) (78 findings, 68 distinct). Each plan below closes one
root cause and lists the findings it retires. Batches follow the report's fix order: measure first,
then data loss, then the Library fan-out, the trim handle, recording failure paths, and render cost.

Plans are working documents: the PR that implements one links it and deletes it (git keeps it).
Each plan is executable by an engineer with zero context — files, code, tests and commits are
spelled out. Where a plan says "Reference" it means the analysis the plan was written from; those
analyses are not in the repo.

## Batch 1 — measure first

| Plan                                                                     | Closes                                            |
| ------------------------------------------------------------------------ | ------------------------------------------------- |
| [01 Telemetry for the four flows](/plans/audit-2026-10-15/01-telemetry/) | REC-A3, LIB-A9, LIB-B13, SHOT-A8, SHOT-B6, VID-A6 |

## Batch 2 — stop silent data loss

| Plan                                                                              | Closes          |
| --------------------------------------------------------------------------------- | --------------- |
| [03 Video session restore](/plans/audit-2026-10-15/03-video-session-restore/)     | VID-A1, VID-B3  |
| [06 Library delete ordering](/plans/audit-2026-10-15/06-library-delete-ordering/) | LIB-B3, LIB-B14 |
| [08 Vault id collisions](/plans/audit-2026-10-15/08-vault-id-collisions/)         | VID-B5          |
| [09 Video autosave assets](/plans/audit-2026-10-15/09-video-autosave-assets/)     | VID-A2, VID-B6  |

## Batch 3 — Library fan-out

| Plan                                                                                  | Closes                                           |
| ------------------------------------------------------------------------------------- | ------------------------------------------------ |
| [10 Library broadcast fan-out](/plans/audit-2026-10-15/10-library-broadcast-fanout/)  | LIB-A1, LIB-A2, LIB-A8, SHOT-A7, SHOT-A9, VID-B9 |
| [12 Library list fs work](/plans/audit-2026-10-15/12-library-list-fs-work/)           | LIB-A5                                           |
| [13 Catalog refresh integrity](/plans/audit-2026-10-15/13-catalog-refresh-integrity/) | LIB-B4, LIB-B5                                   |
| [14 Library thumbnails](/plans/audit-2026-10-15/14-library-thumbnails/)               | LIB-A6                                           |
| [15 Orphan heal](/plans/audit-2026-10-15/15-orphan-heal/)                             | LIB-A7, LIB-B9                                   |
| [16 Library IPC validation](/plans/audit-2026-10-15/16-library-ipc-validation/)       | LIB-B11                                          |
| [18 Drag-out across volumes](/plans/audit-2026-10-15/18-drag-out-volumes/)            | LIB-B12                                          |

## Batch 4 — trim handle

All shipped.

## Batch 5 — recording failure paths

| Plan                                                                                | Closes                 |
| ----------------------------------------------------------------------------------- | ---------------------- |
| [20 Recording engine cleanup](/plans/audit-2026-10-15/20-recording-engine-cleanup/) | REC-A1, REC-B2, REC-B1 |
| [22 Recording crash writer](/plans/audit-2026-10-15/22-recording-crash-writer/)     | REC-A4, REC-B7         |
| [23 Mic failure feedback](/plans/audit-2026-10-15/23-mic-failure-feedback/)         | REC-A5                 |
| [24 Recording start latency](/plans/audit-2026-10-15/24-recording-start-latency/)   | REC-A6, REC-A9         |
| [25 Compositor cadence](/plans/audit-2026-10-15/25-compositor-cadence/)             | REC-A7                 |
| [26 Cursor track tail](/plans/audit-2026-10-15/26-cursor-track-tail/)               | REC-B8                 |

## Batch 6 — render and copy cost

| Plan                                                                           | Closes                    |
| ------------------------------------------------------------------------------ | ------------------------- |
| [27 Video editor re-render](/plans/audit-2026-10-15/27-video-editor-rerender/) | VID-A4, VID-A8            |
| [30 Export runner token](/plans/audit-2026-10-15/30-export-runner-token/)      | VID-B4, VID-A9, VID-A10   |
| [33 Screenshot PNG copies](/plans/audit-2026-10-15/33-screenshot-png-copies/)  | SHOT-A3, SHOT-A4, SHOT-A6 |
| [34 Clipboard peek on focus](/plans/audit-2026-10-15/34-clipboard-peek-focus/) | SHOT-A5, VID-A7           |

## Shipped

Deleted from this folder once their PR merged; git keeps the plan text.

| Plan                              | Closed                                                                        | PR                                                         |
| --------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 02 Recording finalize recovery    | REC-B6, REC-A8                                                                | [#359](https://github.com/niway-dev/kaipu-record/pull/359) |
| 04 Sidecar write serialization    | LIB-B1, LIB-B8, LIB-B10, SHOT-B3                                              | [#367](https://github.com/niway-dev/kaipu-record/pull/367) |
| 05 Screenshot editor save races   | SHOT-B1, SHOT-B4, SHOT-B8, SHOT-B9 (SHOT-B2 dropped: premise no longer holds) | [#360](https://github.com/niway-dev/kaipu-record/pull/360) |
| 07 Tags registry integrity        | LIB-A4, LIB-B7, LIB-B6                                                        | [#358](https://github.com/niway-dev/kaipu-record/pull/358) |
| 19 Trim drag                      | VID-B1, VID-B2, VID-B7, VID-B8                                                | [#368](https://github.com/niway-dev/kaipu-record/pull/368) |
| 21 Recording main-side resources  | REC-A2, REC-B4, REC-B3, REC-B5                                                | [#413](https://github.com/niway-dev/kaipu-record/pull/413) |
| 28 Video thumbnails by range      | VID-A3                                                                        | [#369](https://github.com/niway-dev/kaipu-record/pull/369) |
| 29 Export canvas pool             | VID-A5                                                                        | [#371](https://github.com/niway-dev/kaipu-record/pull/371) |
| 31 Screenshot composite once      | SHOT-A1                                                                       | [#372](https://github.com/niway-dev/kaipu-record/pull/372) |
| 32 PDF export off the main thread | SHOT-A2                                                                       | [#373](https://github.com/niway-dev/kaipu-record/pull/373) |
| 35 Annotation layer memo          | SHOT-A10, SHOT-B5                                                             | [#370](https://github.com/niway-dev/kaipu-record/pull/370) |
| 36 Screenshot toast window        | SHOT-B7                                                                       | [#374](https://github.com/niway-dev/kaipu-record/pull/374) |

## Coverage check

68 distinct findings, 36 plans, every finding listed exactly once above (open plans plus the Shipped table). Merged pairs from the
report (REC-A1≈B2, REC-A2≈B4, REC-A4≈B7, SHOT-A5≈VID-A7, SHOT-A8≈B6, SHOT-B3≈LIB-B10, LIB-A4≈B7,
LIB-A7≈B9, LIB-A9≈B13, VID-A1≈B3, VID-A2≈B6) land in the same plan.
