---
title: "Screen picker thumbnails — retry loop vs event-based (perf review)"
description: "Revisit whether polling desktopCapturer.getSources until thumbnails populate is the right approach, or whether we should wait for a window-ready signal and fetch once. Performance/tech-debt review, not urgent."
---

# Screen picker thumbnails — retry vs event-based (perf review)

> **Status: 🔵 To review (performance).** The blank-thumbnail-from-tray bug is **fixed and
> validated** — but with a **retry loop**, chosen as the pragmatic fix. This doc parks the
> open question: is polling the right approach, or should we wait for a window-ready signal
> and fetch once? Not urgent; revisit when we care about picker latency/cost.

## Context

Opening the source picker from the Capture Panel ("Change") showed a broken screen thumbnail:
`desktopCapturer.getSources` returns blank `0×0` thumbnails when called **while the window is
still coming to the foreground** from the tray. See the gotcha in
[widget-capture-tabs](./widget-capture-tabs#gotchas).

**Current fix** (shipped): `useScreenSources.refresh` **retries** the fetch — up to
**4×250ms**, loader shown — while the screen thumbnails are blank, then renders whatever it
has (with an icon fallback for still-blank tiles). No-ops on the already-settled app path.

## The concern to review

Polling is a guess dressed as a fix. Two things to weigh:

- **Cost:** each `getSources({thumbnailSize})` call enumerates every screen + window **and
  captures a thumbnail for each** — not free. Up to 5 calls (1 + 4 retries) in the worst case.
- **Latency/feel:** worst case is ~1s of loader before the picker is usable from the tray.
- **Correctness of the signal:** we treat "screen thumbnail non-blank" as "settled". Windows
  can still come back blank on the first good screen capture (seen in the logs) — the icon
  fallback covers it, but it means windows may briefly lack thumbnails.

## Alternatives to evaluate

1. **Event-based readiness (preferred hypothesis):** in `triggerChooseSource`, wait for the
   main window to actually be shown + focused + first paint (`did-finish-load` / `browser-window-focus`
   / a short `requestAnimationFrame` in the renderer) **before** signaling the fetch — so we
   fetch **once**, when capturable. Removes the poll.
2. **Single deferred fetch:** one `setTimeout` after show instead of a loop. Simpler, but still
   a magic delay — no better than the loop, just fewer calls.
3. **Split screens vs windows:** fetch screens first (the reliable, cheap signal), show them
   immediately, lazy-load window thumbnails after. Cuts perceived latency.
4. **Cache + refresh:** show the last-known good thumbnails instantly, refresh in the background.

## What to measure first (before changing anything)

- **Retry-count distribution** in real use: instrument how many attempts it actually takes from
  the tray (if it's almost always 1–2, the loop is fine and cheap).
- **Time-to-first-good-thumbnail** from the tray vs from the app.
- **`getSources` latency** per call, and whether windows genuinely need the extra retries or
  just screens.

## Decision criteria

- If retries almost always resolve on attempt 1–2 and the picker feels instant → **keep the
  loop** (it's self-healing and simple).
- If it's janky, costly, or often hits the retry cap → **move to event-based readiness
  (option 1)** and fetch once.

## Related

- [Widget — Record / Capture tabs](./widget-capture-tabs) (the feature this came from)
- Fix commit: `fix(recording): blank screen thumbnails when picker opens from the tray`
