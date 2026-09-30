---
title: "Open decisions — editor audio, shortcuts, and the watermark merge"
description: "Every unresolved question across the three workstreams queued on 2026-09-30, each with options, a recommendation and the default that applies if nobody answers. Written to be reviewed together, in one pass."
---

# Open decisions — 2026-09-30

> **Status: 🟢 Decided** (2026-09-30), except item 3, which needs a mechanism
> that does not exist yet and carries a proposal instead of a recommendation.
> Nothing here is implemented.

Three workstreams landed in one request: audio in the video editor, the
shortcuts the landing shows, and folding the free-watermark branch into
`feat/marketing-landing`. They share a release, not a design.

## 1 — Boost: a multiplier, or normalize to a target?

**Settled already:** boost is "raise the volume", and it ships with mute rather
than after it.

**The problem nobody has decided.** Audio has a ceiling. Multiply a signal that
already peaks near it and the waveform's tops get flattened — the result is not
louder, it is distorted, and the distortion is permanent once exported. A quiet
recording boosts cleanly; a loud one turns crunchy. A raw "+50%" control hands
the user a knob whose safe range depends on footage they cannot see.

**What established editors do** — this is the answer to "how do the big
companies handle it":

| Tool         | Control                                      | How clipping is avoided                                                                                                       |
| ------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Premiere Pro | per-clip gain in dB                          | peak **normalization** to a ceiling below 0 dB (−6 to −3 dB recommended), plus a Hard Limiter effect for a guaranteed ceiling |
| Descript     | a dB volume slider per layer, with keyframes | **Automatic Volume Leveling**: analyses each clip's loudness and lands it near −16 dB                                         |
| Riverside    | mute per track                               | normalize                                                                                                                     |

The pattern is consistent: the professional tools expose gain in **dB** and pair
it with a limiter; the tools aimed at people who are not audio engineers expose
**one button that normalizes to a loudness target**. Nobody ships a bare
percentage multiplier, because it is the one control that can silently ruin the
export.

Note also that peak normalization prevents clipping but does not equalise
_perceived_ loudness — that is what LUFS targets are for (−14 for YouTube, −16
for Spotify and for Descript's leveling).

### Options

1. **Gain multiplier per range** (`gain: number`, 1.0 = unchanged). Simplest to
   build; matches how the mute ranges already work. Against: it is exactly the
   control the research says nobody ships, and the failure is invisible until
   the file is already exported and shared.
2. **Normalize the range to a target** — one "Boost" action that measures the
   range's peak (or loudness) and applies the gain that lands it at the ceiling,
   which by construction cannot clip. Against: less control; a user who wants
   "a bit louder, not maximum" cannot express it.
3. **Gain in dB with a hard ceiling applied on export** — the professional
   shape. The user sets dB, the export clamps at the ceiling so the file is
   never distorted beyond it. Against: dB is a unit most of Kaipu's audience
   does not read, and it needs a meter to be usable, which the editor does not
   have.

**DECIDED: none of them — boost is dropped entirely.** The owner's call once the
research was in: "solo mute, nada de multiplicador". Mute ships alone; raising
volume is not a Kaipu feature today and may never be.

This also removes a promise the landing was already making. `homeChapter3Pill3`
read "Mute or boost audio" / "Silenciar o subir audio"; it now reads "Mute audio"
/ "Silenciar audio". A landing that advertises a control the product does not
have is the more expensive half of this decision.

The research above is kept rather than deleted: if boost is ever revisited, the
finding that nobody ships a bare percentage multiplier is the starting point, not
something to rediscover.

## 2 — Does mute stay binary?

`backlog/video-editor-mute` lists as a non-goal: _"Volume adjustment, fades,
ducking, or replacing audio. Mute is binary."_ Its reason is a promise, not a
preference — muted audio must be **real silence in the file**, the same
guarantee the redactions make, with a testable invariant: every sample in the
range is exactly zero.

Adding boost reopens that non-goal. The question is whether mute survives as its
own thing.

1. **One range type carrying a level**, where mute is the bottom of the range.
   One lane, one inspector. Against: the invariant dies — a bug writing a level
   near zero instead of zero leaks audio the user believed was removed, and no
   test can catch "nearly silent".
2. **Two operations on one lane**: mute stays binary and routes through the
   existing zero-fill path; boost is a separate, additive operation. Against:
   two concepts where the UI shows one control, which has to be explained.

**DECIDED: mute stays binary, 0 or 1.** With boost gone the non-goal in
`backlog/video-editor-mute` is not reopened at all — no superseding decision is
needed, and the doc stands as written. The testable invariant survives: every
sample inside a mute range is exactly zero.

Levels can be revisited later ("escalamos luego"). Doing so would reopen the
non-goal, and that is the moment to record a decision, not before.

## 3 — Where do the shortcut defaults live?

**Settled already:** the landing must read the real defaults, not hardcoded
glyphs, and reuse a constant rather than copy values.

The source of truth is `SHORTCUT_DEFINITIONS` in
`apps/kaipu-record/src/shared/types/ipc.ts`. The landing is a different app and
cannot import from `apps/kaipu-record`, so "reuse the constant" needs the
constant to move.

1. **Move the defaults to `@kaipu/domain/constants`.** Domain is pure and
   mobile-safe, `apps/web-hono` already depends on it, and one definition can
   never drift. Against: `apps/kaipu-record` does **not** depend on
   `@kaipu/domain` today — this adds that edge. Domain has no runtime
   dependencies, so the cost is a line in `package.json`, but it is a new arrow
   in the dependency graph and worth naming rather than sliding in.
2. **Duplicate, with a test asserting the two agree.** This repo already does
   exactly that for `DEFAULT_LOCALE` — `settings.service.ts` keeps a literal on
   purpose and `settings.service.test.ts` asserts it matches `@kaipu/i18n`.
   Against: the test lives in the desktop app and the copy lives on the web, so
   the assertion has to reach across apps or be duplicated too; and this class
   of drift is precisely what just shipped a wrong promise to the landing.

**PROPOSAL, awaiting a yes.** The owner asked for "a package with the constant,
maybe in domain, as an enumerated constant", and for a proposal if none exists.
None exists: `packages/domain/src/constants/` holds only `cloud-limits`, and
`apps/kaipu-record` does not depend on `@kaipu/domain` at all today.

The proposal is `@kaipu/domain/constants` → `shortcuts.ts`, holding the action
names as a `const` tuple (so the type is a union of real actions, not `string`)
and one record of defaults keyed by it:

```ts
export const SHORTCUT_ACTIONS = [
  "startRecording",
  "stopRecording",
  "bringToFront",
  "captureScreenshot",
  "openLibrary",
] as const;

export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];

/** Electron accelerator strings. The desktop app registers these; the landing
 *  renders them. One definition, so the two can never disagree. */
export const DEFAULT_ACCELERATORS: Record<ShortcutAction, string> = {
  startRecording: "Command+Control+C",
  stopRecording: "Command+Control+S",
  bringToFront: "Command+Control+O",
  captureScreenshot: "Command+Control+X",
  openLibrary: "Command+Control+L",
};
```

Everything else — labels, descriptions, groups, `statusWord` — stays in
`SHORTCUT_DEFINITIONS` in the desktop app, because it is English UI copy with no
reader on the web. Only the pair _(action, default accelerator)_ moves, which is
exactly the pair that drifted.

Two consequences to accept before this is a yes:

1. **`apps/kaipu-record` gains a dependency on `@kaipu/domain`.** Domain is pure
   and has no runtime dependencies, so the cost is one line in `package.json` —
   but it is a new arrow in the dependency graph and the repo's import rules make
   that direction legal (apps may import domain), so nothing is violated.
2. **The landing needs a formatter.** `"Command+Control+C"` is an Electron
   accelerator, not something to show a reader; the web needs a small
   `formatAccelerator()` that renders it as `⌃⌘C`. The desktop already has this
   logic in `useShortcutLabels`; the display formatter should move to domain
   beside the constant, or be written once on the web. **Recommendation:** move
   it, for the same reason the constant moves.

**Rejected:** duplicating with an agreement test, the pattern this repo uses for
`DEFAULT_LOCALE`. That duplication exists to keep React and two message catalogs
out of the preload bundle; there is no equivalent cost for five accelerator
strings, and the assertion would have to reach across two apps.

### The measured mismatch, for the record

| Shown on the landing                                                           | Real default                |
| ------------------------------------------------------------------------------ | --------------------------- |
| `⌘⇧P` start recording (app mockup, tray menu, and the hero's background glyph) | `⌃⌘C`                       |
| `⌘⌃4` take screenshot                                                          | `⌃⌘X`                       |
| `⌘L` open library                                                              | **no such shortcut exists** |

## 4 — The library shortcut the landing promises

**Settled already:** add it, "it does not hurt".

It does need one decision. The landing shows `⌘L`, and a **global** shortcut on
`⌘L` would take that combination away from every other app on the machine —
browsers use it for the address bar, Finder for aliases. The existing family is
deliberately `Command+Control+<key>`, chosen (see the comment above
`SHORTCUT_DEFINITIONS`) to avoid reserved and crowded combinations precisely
because a global shortcut overrides the focused app.

1. **`⌃⌘L`**, consistent with the other four, and the landing shows that.
2. **`⌘L` as shown**, matching the design. Against: it hijacks a very common
   combination system-wide, which is a support problem, not a style one.

**DECIDED: option 1, `Command+Control+L`.** It keeps the family the other four
belong to, and the landing is corrected to show it rather than the `⌘L` the
design drew. This adds a fifth entry to `SHORTCUT_DEFINITIONS` and a real action
behind it — opening the Library from anywhere — so the landing stops promising a
shortcut that does nothing.

## 5 — The watermark and licence merge

**Settled already:** both go into `feat/marketing-landing`, not a separate PR.
Recorded here because the objection was raised and overruled, which is a normal
outcome and should be visible to a later reader rather than lost in a chat.

The practical consequence, which is not a decision but a cost: branch
`feat/growth-strategy-and-free-watermark` carries `289f2ea` (the free tier
without a watermark), `262e1df` (relicence MIT → AGPL-3.0-only) **and** edits to
`apps/web-hono/src/components/landing/` — a directory `feat/marketing-landing`
deleted. The merge conflicts for real. `brand-origin.tsx` in particular is a new
landing component that has to be re-homed into `components/home/` or dropped.

## 6 — A floating label on the landing overlaps the mockup

Reformulated, because the first version assumed context the reader does not have.

**What the rail is.** Down the right edge of the landing there is a thin vertical
strip of icons — one per section of the page — that tracks where the reader has
scrolled to. It is the page's own navigation, and it is fixed: it stays on screen
while everything else moves.

**What goes wrong.** Whichever section you are currently in, the rail shows its
name in a small floating box to the left of its icon. In the hero — the very
first screen, the one everybody sees — that name is "Kaipu", so a box reading
"Kaipu" hangs in mid-air beside the rail. At 1440×900 it lands **on top of the
"Change" button** inside the app mockup, so the screenshot of the product has a
label sitting across it. The owner's design has no such label anywhere.

**The trade-off.** The label exists to answer "where am I on this page". Removing
it is free on the hero, where the answer is obvious, and costs something further
down, where the icons alone are just five grey glyphs.

1. **Show the name only while the pointer is over the rail** (or it has keyboard
   focus). The collision disappears because nothing floats unless the reader
   asked for it, and the answer to "where am I" is one hover away.
2. **Never label the two ends of the page** (the hero and "Your files"), keep the
   label on the four numbered chapters. Closest to the design. Against: the first
   screen is exactly where a reader has not yet learned what the rail is, so it
   is the worst place to withhold the explanation.

**Recommendation: 1.** It fixes the overlap everywhere rather than at the one
place it was noticed, and it keeps the affordance for the reader who wants it.

**Default if unanswered:** option 1.

## Sources

- [Adjust audio gain in Premiere Pro](https://helpx.adobe.com/uk/premiere-pro/using/adjusting-volume-levels.html)
- [Normalize audio in Premiere Pro](https://borisfx.com/blog/normalize-audio-in-premiere-pro-3-methods/)
- [Descript — automatic volume leveling](https://www.descript.com/blog/article/new-in-descript-automatic-volume-leveling-timeline-editing-improvements)
- [Riverside — how to edit video audio](https://riverside.com/blog/how-to-edit-video-audio)
