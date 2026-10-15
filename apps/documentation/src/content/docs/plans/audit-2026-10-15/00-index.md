---
title: Audit 2026-10-15 — fix plans index
description: One implementation plan per root cause for every finding of the 2026-10-15 pre-deploy audit. Every finding maps to exactly one plan; the PR that ships a plan deletes it.
---

# Audit 2026-10-15 — fix plans

**Status: 🔵 Plans written, none shipped.** Source: the
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

| Plan                                                                                        | Closes                                      |
| ------------------------------------------------------------------------------------------- | ------------------------------------------- |
| [02 Recording finalize recovery](/plans/audit-2026-10-15/02-recording-finalize-recovery/)   | REC-B6, REC-A8                              |
| [03 Video session restore](/plans/audit-2026-10-15/03-video-session-restore/)               | VID-A1, VID-B3                              |
| [04 Sidecar write serialization](/plans/audit-2026-10-15/04-sidecar-write-serialization/)   | LIB-B1, LIB-B8, LIB-B10, SHOT-B3            |
| [05 Screenshot editor save races](/plans/audit-2026-10-15/05-screenshot-editor-save-races/) | SHOT-B1, SHOT-B2, SHOT-B4, SHOT-B8, SHOT-B9 |
| [06 Library delete ordering](/plans/audit-2026-10-15/06-library-delete-ordering/)           | LIB-B3, LIB-B14                             |
| [07 Tags registry integrity](/plans/audit-2026-10-15/07-tags-registry-integrity/)           | LIB-A4, LIB-B7, LIB-B6                      |
| [08 Vault id collisions](/plans/audit-2026-10-15/08-vault-id-collisions/)                   | VID-B5                                      |
| [09 Video autosave assets](/plans/audit-2026-10-15/09-video-autosave-assets/)               | VID-A2, VID-B6                              |

## Batch 3 — Library fan-out

| Plan                                                                                  | Closes                                           |
| ------------------------------------------------------------------------------------- | ------------------------------------------------ |
| [10 Library broadcast fan-out](/plans/audit-2026-10-15/10-library-broadcast-fanout/)  | LIB-A1, LIB-A2, LIB-A8, SHOT-A7, SHOT-A9, VID-B9 |
| [11 Vault directory cache](/plans/audit-2026-10-15/11-vault-directory-cache/)         | LIB-A3                                           |
| [12 Library list fs work](/plans/audit-2026-10-15/12-library-list-fs-work/)           | LIB-A5                                           |
| [13 Catalog refresh integrity](/plans/audit-2026-10-15/13-catalog-refresh-integrity/) | LIB-B4, LIB-B5                                   |
| [14 Library thumbnails](/plans/audit-2026-10-15/14-library-thumbnails/)               | LIB-A6                                           |
| [15 Orphan heal](/plans/audit-2026-10-15/15-orphan-heal/)                             | LIB-A7, LIB-B9                                   |
| [16 Library IPC validation](/plans/audit-2026-10-15/16-library-ipc-validation/)       | LIB-B11                                          |
| [17 Tag chip editing](/plans/audit-2026-10-15/17-tag-chip-editing/)                   | LIB-B2                                           |
| [18 Drag-out across volumes](/plans/audit-2026-10-15/18-drag-out-volumes/)            | LIB-B12                                          |

## Batch 4 — trim handle

| Plan                                                  | Closes                         |
| ----------------------------------------------------- | ------------------------------ |
| [19 Trim drag](/plans/audit-2026-10-15/19-trim-drag/) | VID-B1, VID-B2, VID-B7, VID-B8 |

## Batch 5 — recording failure paths

| Plan                                                                                     | Closes                         |
| ---------------------------------------------------------------------------------------- | ------------------------------ |
| [20 Recording engine cleanup](/plans/audit-2026-10-15/20-recording-engine-cleanup/)      | REC-A1, REC-B2, REC-B1         |
| [21 Recording main-side resources](/plans/audit-2026-10-15/21-recording-main-resources/) | REC-A2, REC-B4, REC-B3, REC-B5 |
| [22 Recording crash writer](/plans/audit-2026-10-15/22-recording-crash-writer/)          | REC-A4, REC-B7                 |
| [23 Mic failure feedback](/plans/audit-2026-10-15/23-mic-failure-feedback/)              | REC-A5                         |
| [24 Recording start latency](/plans/audit-2026-10-15/24-recording-start-latency/)        | REC-A6, REC-A9                 |
| [25 Compositor cadence](/plans/audit-2026-10-15/25-compositor-cadence/)                  | REC-A7                         |
| [26 Cursor track tail](/plans/audit-2026-10-15/26-cursor-track-tail/)                    | REC-B8                         |

## Batch 6 — render and copy cost

| Plan                                                                                  | Closes                    |
| ------------------------------------------------------------------------------------- | ------------------------- |
| [27 Video editor re-render](/plans/audit-2026-10-15/27-video-editor-rerender/)        | VID-A4, VID-A8            |
| [28 Video thumbnails by range](/plans/audit-2026-10-15/28-video-thumbnails-range/)    | VID-A3                    |
| [29 Export canvas pool](/plans/audit-2026-10-15/29-export-canvas-pool/)               | VID-A5                    |
| [30 Export runner token](/plans/audit-2026-10-15/30-export-runner-token/)             | VID-B4, VID-A9, VID-A10   |
| [31 Screenshot composite once](/plans/audit-2026-10-15/31-screenshot-composite-once/) | SHOT-A1                   |
| [32 PDF export off the main thread](/plans/audit-2026-10-15/32-pdf-export-offthread/) | SHOT-A2                   |
| [33 Screenshot PNG copies](/plans/audit-2026-10-15/33-screenshot-png-copies/)         | SHOT-A3, SHOT-A4, SHOT-A6 |
| [34 Clipboard peek on focus](/plans/audit-2026-10-15/34-clipboard-peek-focus/)        | SHOT-A5, VID-A7           |
| [35 Annotation layer memo](/plans/audit-2026-10-15/35-annotation-layer-memo/)         | SHOT-A10, SHOT-B5         |
| [36 Screenshot toast window](/plans/audit-2026-10-15/36-screenshot-toast-window/)     | SHOT-B7                   |

## Coverage check

68 distinct findings, 36 plans, every finding listed exactly once above. Merged pairs from the
report (REC-A1≈B2, REC-A2≈B4, REC-A4≈B7, SHOT-A5≈VID-A7, SHOT-A8≈B6, SHOT-B3≈LIB-B10, LIB-A4≈B7,
LIB-A7≈B9, LIB-A9≈B13, VID-A1≈B3, VID-A2≈B6) land in the same plan.
