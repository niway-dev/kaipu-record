---
title: Messaging playbook
description: The one message, and the concrete moves on the landing, in the product and in content that make it land. Includes the benchmarks page and the respectful comparison pages.
---

# Messaging playbook

**Working plan · 2026-09-27.** Companion to [Positioning](/marketing/positioning/), which
argues _what_ to say. This page is about _how_ to make it stick.

## The one message

> Your recordings live in a folder that is yours. Not in a project file, not in someone
> else's cloud.

Everything below is a way of proving that sentence instead of repeating it. Supporting
claims, each of which has to be demonstrable before it goes on the site:

1. Record without an account, from a shortcut, without opening the app.
2. The file is a real MP4 on disk the moment you stop.
3. Trim, annotate, blur and export in the same app; screenshots too.
4. Signed and notarized builds, auto-update, public roadmap and changelog.
5. If Kaipu disappears tomorrow, your folder still works.

## Front 1 — the landing

**2026-09-27 copy update:** the current landing and site-level SEO now lead with “Show it. Get back to work.” and explain the local-folder benefit through everyday tasks. The [website concept](/marketing/website-concept/) contains the chapter-navigation proposal, bilingual copy, media brief, and release conditions for watermark, Windows, and source claims. Layout and new media are still proposed; the catalog currently does not advertise those unreleased availability changes.

| Section              | What it shows                                                       | Why                                                                  |
| -------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| "It's just a folder" | A ten-second clip: record, stop, open Finder, the MP4 is there      | The cheapest and most convincing demo of the message                 |
| Trust strip          | "Signed and notarized · No account · Nothing uploaded"              | Answers the three objections a recorder faces before the first click |
| Benchmarks           | Measured RAM idle, CPU while recording, installer size, export time | Replaces the Tauri debate with numbers; see below                    |
| Both captures        | Video and annotated screenshot side by side                         | The competitor does video only                                       |
| Download             | macOS, and Windows (beta) with the gap stated                       | Windows is the first objection in every thread                       |

The existing [landing redesign](/backlog/landing-redesign/) work is the base; these are
sections, not a new site.

## Front 2 — the product

- **"Show in Finder" on every library card.** It is a button, but it teaches the philosophy
  every time it is used.
- **Fill the visible feature gap that costs nothing to explain:** background, padding and
  shadow around the capture, and GIF export with loop. See
  [product growth](/backlog/product-growth/). After that the competitor's feature list is not
  visibly longer.
- **Keystroke visualizer.** Wanted by developers and tutorial makers; the competitor does not
  have it.

## Front 3 — content

Three technical posts that double as marketing and are shareable where developers are:

1. _Why WebCodecs and not FFmpeg_ — from [ADR 0001](/architecture/decisions/0001-mediabunny-over-ffmpeg/).
2. _Filesystem-first: the day we lost 200 GB of metadata and zero videos_ — from the
   [monetization ADR](/desktop/filesystem-first-monetization/).
3. _Why we never ask you to sign in_ — from the [product philosophy](/desktop/product-philosophy/).

Plus a **public changelog with a fixed cadence**. The competitor went silent for two months;
a visible rhythm is the cheapest trust signal a one-person project can send.

## Front 4 — long-term trust

The owner is also a one-person team, so the answer to "what if you disappear" has to be
structural, not personal:

- signed builds and auto-update;
- the public roadmap that already exists;
- the changelog cadence above;
- the open-source repository ([plan](/marketing/open-source/));
- the folder that keeps working without the app.

## The benchmarks page

**Priority: low** (owner, 2026-09-27) but cheap, and it closes the "should we rewrite in
Tauri" question with evidence instead of opinion. Measure on the same machine, same recording:

| Metric                            | How                                                       |
| --------------------------------- | --------------------------------------------------------- |
| RAM at idle                       | Activity Monitor after five minutes with the library open |
| CPU while recording 1080p60       | Average over a two-minute recording                       |
| Installer size                    | The signed `.dmg`                                         |
| Time to first frame               | Shortcut press to recording indicator                     |
| Export time for a one-minute clip | Wall clock, default preset                                |

Publish the numbers with the machine and version. The [Electron vs Tauri ADR](/desktop/electron-vs-tauri/)
sets the threshold: idle under ~150 MB and recording under ~15 % CPU means the framework is
not the problem. Only if Kaipu misses it does Tauri become a discussion again.

## Comparison pages

**Priority: low** (owner, 2026-09-27). The owner does not want to speak badly of competitors,
and does not need to. The pages exist because "Kaipu vs X" is what people search at the moment
of decision, and a page we do not write is written by someone else.

Rules for every comparison page:

- Compare **workflows**, not people or projects. Never mention a maintainer's circumstances,
  funding or governance.
- Every claim about the other product links to their own documentation and names the version
  checked.
- Say plainly what the other product does better. It is the only way the page is believed.
- Lead with who each product is for. "If you want a polished demo for a launch, Screen Studio
  or Recordly are built for that. If you record ten things a day and need to find them next
  week, that is Kaipu."

Candidates, in order of search volume: Loom, Screen Studio, Cap, Recordly.
