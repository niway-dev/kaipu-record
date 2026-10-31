---
title: "Webcam track — record the webcam as its own track and compose it above the zoom"
description: "Proposal: the webcam stops being pixels of the screen capture. The recorder writes a second, synchronized MP4 from the webcam, the floating bubble is excluded from the capture, and the video editor composes the webcam as a layer above the auto-zoom so the face never disappears into a zoom."
---

# Webcam track

> **Status: 🟢 Ready to validate (prod review pending)** (2026-10-31). Merged to `main` on
> 2026-10-31: #437, #441–#446, #452, #463 and #468; #454 (webcam lane filmstrip and editor
> follow-ups) is still open: it was retargeted to `main` after its base merged. Owner QA on `qa/webcam-all`
> passed the main flows (face as its own layer under zoom, camera off and on mid-take, the
> Library player); a packaged build and Windows are not checked yet.
> Design: [Webcam track](/specs/2026-10-30-webcam-track-design/) · ADRs
> [0037](/architecture/decisions/0037-webcam-is-its-own-track-and-the-bubble-is-excluded-from-capture/)
> (track and exclusion) and
> [0038](/architecture/decisions/0038-webcam-is-a-viewport-layer-composed-after-the-zoom-crop/)
> (editor layer) · Linear [NIW2-565](https://linear.app/niway/issue/NIW2-565). Next: the editor timeline v2 design
> (#469: camera sections with transitions, tracks on demand, media overlays).

## The problem

When the webcam is on, the camera bubble is a floating window that the screen capture records
as part of the screen (`camera-bubble-window.ts` is deliberately not content-protected). The
recorder writes one MP4 — screen plus mixed audio — and no webcam file. So when the video
editor's auto-zoom crops into a region, the face is cropped away with the rest of the frame.
Today the owner records without zoom to keep it.

Re-pasting the bubble's pixels from the unzoomed frame was considered and rejected: a hack over
the wrong model.

## The decision

The professional model (Screen Studio, Cap, Tella, Camtasia):

- **Record the webcam as its own file**, `.kaipu/<id>.webcam.mp4`, encoded by the recorder
  renderer on the same clock as the screen; the start offset goes on the sidecar, as the cursor
  track is anchored today. The screen file stays screen-only and nothing changes for recordings
  made before.
- **Keep the bubble on screen but out of the capture.** Plan A is chosen (owner, 2026-10-30):
  content protection from
  creation (Electron's `desktopCapturer` path hands in-process protected windows to
  ScreenCaptureKit's `excludingWindows`); a spike with written pass/fail criteria goes first. Plan
  B is recorded, not scheduled: only if the spike fails does it become a ticket — a native ScreenCaptureKit capture that excludes the bubble by
  window id, as Cap does. Hiding the bubble during a take is rejected.
- **The editor composes the webcam as a viewport layer** — a global layout (shape, size,
  position, mirror, framing, shrink during zoom) plus source-anchored hide/override segments —
  drawn after the zoom crop and after the output framing, in the composer the MP4 and GIF exports
  share. Share composes it at the recorded layout.

## What shipped

| PR   | What it does                                                                                                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #437 | Design: spec and ADRs 0037/0038                                                                                                                           |
| #441 | The recorder writes `.kaipu/<id>.webcam.mp4` on the screen's clock, offset on the sidecar                                                                 |
| #442 | The vault pairs the webcam file with its recording and serves it to the editor                                                                            |
| #443 | Scene model: a global layout plus source-anchored hide/override segments                                                                                  |
| #444 | Preview layer above the zoom, draggable and hideable                                                                                                      |
| #445 | MP4 and GIF exports compose the face above the zoom, also over a still screen                                                                             |
| #446 | The bubble is content-protected from creation when the take records a webcam file; the copy (Share, now Prepare) composes the face at the recorded layout |
| #452 | Recorder and library follow-ups: "webcam not saved" toast, salvage never overwrites a webcam file, an unreadable capability falls back to the legacy path |
| #454 | **Open, not merged yet** (retargeted to `main`): webcam lane filmstrip, editor and export follow-ups (export-reuse revision `wc2`)                        |
| #463 | Camera off and on mid-take: the bubble is parked, a relay track keeps the webcam output open, `webcam.gaps` become hidden segments                        |
| #468 | The Library's original player draws the face at the recorded layout                                                                                       |

The exclusion spike (#440) answered the plan A/B question on the owner's Mac: a window protected
at creation is not in the screen pixels, and a window created unprotected mid-take is. Plan A
stands; plan B (native exclusion by window id) stays unscheduled.

## How it was built and reviewed

- **Design first, then a spike, then a stack.** One spec and two ADRs, a hand-run spike for the
  one assumption nobody had verified (protection from creation), then six stacked PRs, one
  per layer: recorder, vault, scene, preview, export, protection.
- **Each PR: an implementer agent, then a fresh reviewer that never saw the implementation
  conversation (Opus 5.5, plus Codex on the original stack), then fixes, then a confirmation
  review.** A ledger comment on each PR listed every finding and what happened to it (fixed,
  declined with a reason, or moved to a follow-up).
- **The reviews were good at the diff in front of them.** They found, among others: salvage
  overwriting an existing webcam file; a capability probe whose failure sent old Windows down the
  wrong path; the inspector editing a different target than the one being dragged; the GIF
  worker reading the camera at the wrong timestamp; stale export copies reused after the
  webcam changed (the fix, export-reuse revision `wc2`, is in #454, still open).
- **Two review bots now run on every PR: the Agent review (Claude Opus in GitHub Actions) and
  Pullfrog.** On the PR that wrote this record, Pullfrog's findings were the better ones, in the
  owner's judgment. It ran the new ADR script both ways (exit 0 on the branch, exit 1 with a
  dummy `0032` file) instead of reading it, and it checked the record's claims against the
  repository rather than against the diff: it caught #454 listed as shipped while it was still
  open. The Agent review found that the ADR check read a stale `origin/main`. Both caught a
  wrong count. Keep both; weigh a finding by whether the reviewer verified it against the
  repository.
- **Owner QA found what no diff review could, because each gap sat between PRs or outside them:**
  - the webcam lane had no thumbnails (fix in #454, still open);
  - turning the camera off and on mid-take burned the bubble back into the screen and cut the
    webcam file short (#463);
  - the Library player showed the screen file alone, so the face looked lost (#468).
- **The merge itself found two more:** renaming or deleting a recording left the webcam file
  behind (it is now a companion path), and `recordingCreate` took two different meanings in the
  same argument on `main` and on the stack (now one `kind`: `recording | export | webcam`).

## Still unverified

- A packaged build, and Windows at all (the exclusion matrix rows for Windows were not run).
- The Prepare copy with a webcam: ported from the Share sheet `main` deleted, covered by tests,
  not run by hand.
- Re-acquiring the camera after it fails mid-take relies on a new unprotected window being
  captured by a running stream; seen once on macOS.

## Dependencies and follow-ups

- Cloud upload of the webcam file waits for the transfer client
  ([cloud plan 03](/backlog/desktop-cloud-sync-gap/)); until then "Remove local copy" is refused
  for recordings with a webcam file.
- Supersedes decision 6 of the [capture modes spec](/specs/2026-10-26-record-capture-modes-design/)
  (the bubble "recorded as part of the screen"); the bubble's shape, size, mirror and framing
  settings ([camera bubble](/backlog/camera-bubble-shape-and-size/)) become the layer's defaults.
- Review follow-ups (NIW2-581): a take whose webcam file was not saved (its encoder failed, it
  did not finalize at stop, or main could not place it) now tells the user after the take, and
  keeps the screen recording. Still open: the editor drops a saved webcam layer while the
  webcam file is missing, so the layout is lost if the file comes back.
- "Check and fix files" does not recognize a stray `.kaipu/<id>.webcam.mp4`: it stays in place
  instead of moving to orphans. Safe, but untidy.
- The Library thumbnail is grabbed from the screen stream, so it has no face.
- The spec and ADR 0037 still say "Share" for what is now the Prepare copy.
- Camera sections with transitions, tracks on demand and media overlays: the editor timeline v2
  design (#469). Camera-only clips and background music go to the backlog with it.

## Lessons

- **For a feature that adds a second file to an item, list every surface that shows, copies,
  moves or deletes the item before building, and make each one an acceptance criterion.** Here
  the list is: recorder, editor preview, export, copy (Prepare), Library player, thumbnail,
  rename, delete, reconcile, cloud upload, and the raw file in Finder. Three of the gaps above
  were rows missing from it. A diff reviewer checks the diff; it does not notice a surface the
  stack never touched.
- **Owner QA on one branch that merges the whole stack beats QA per PR.** `qa/webcam-all`
  (local, never pushed) found the cross-PR gaps in one session. Keep it, and every PR branch
  under QA, free of worktrees: a branch checked out in a worktree cannot be checked out by the
  owner. If an agent still holds it, `git checkout --detach origin/<branch>` tests the same code.
- **Cite decisions by slug, and check ADR numbers against open PRs.** Workspaces took 0032–0034
  on `main` while this stack held 0032/0033 in about 120 code comments and docs across twelve
  branches; renumbering them took two cascade rounds. `scripts/check-adr-numbers.ts` now runs on
  every push (`verify:local`) and fails when an ADR number is taken twice, here or on
  `origin/main`, so a collision shows up the day it happens.
- **A long stack against a moving `main` costs a cascade per move.** `main` changed twice during
  the final cascade, and the Prepare screen deleted the Share sheet this stack had extended.
  Merge `main` into the stack's base early and often, and pause other merges while a stack lands.
  A resolution that changes behaviour (merging the two `recordingCreate` meanings, porting Share
  to Prepare) is new code: it gets a review like any other.
- **A stack that forks needs every child retargeted.** #452 and #454 both sat on #446. This
  repository does not delete head branches on merge, so GitHub does not retarget children, and
  #454 was left pointing at a merged branch. Before calling a stack merged, list the open PRs
  whose base branch is already merged.
- **A hook that falls back to `bunx` changes the result.** In a worktree without
  `node_modules`, the pre-commit hook downloaded another formatter version and reformatted files
  outside the change. The hooks now call the pinned binaries and fail when they are missing.
- **A mock is not a decision.** The timeline mock showed "5 zooms suggested · not added yet",
  which reverses today's behaviour (detected zooms are applied on open). Compare a mock with
  current behaviour and ask about every difference.
- **The two hand-kept index tables conflicted on every move of `main`.** The ADR index and the
  backlog index caused the only conflicts in #437 and #469. The knowledge hub's ADR pattern says
  to generate the ADR list instead; that is a follow-up here.
