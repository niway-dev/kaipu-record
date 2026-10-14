---
title: Features page on kaipu.app
description: A /features page that lists everything Kaipu ships in detail, grouped by the home's four chapters, and the Claude Design prompt to design it.
---

# Features page

> **Status: 🔵 Proposed (2026-10-14).** Option 1 below is the recommendation; the owner has not
> answered the open questions yet. The Claude Design prompt is ready; no design or code exists.

The home sells Kaipu in 30 seconds with four chapters (Record · Capture · Edit · Find) and
animated mocks. It has no room for the full catalogue: export presets, tags, background
exports, auto zoom on clicks and the rest have nowhere to live. A `/features` page is that
catalogue — the link to send when someone asks "what does it do?".

## Options considered

1. **One `/features` page, grouped by the home's four chapters (recommended).** One page to
   maintain, one link to share. Risk: a long list — mitigated with a sticky in-page index.
2. **One page per feature (`/features/export`, `/features/tags`…).** Best for search, room for
   a video per feature. Against: 15+ pages in two languages that a one-person team will let
   drift. Worth it later only for the 3–4 features that bring real search traffic.
3. **No new page; expand the roadmap's shipped rows.** The roadmap answers _when_, a features
   page answers _what it does for you_; mixing them weakens both.

## Keeping it current

The roadmap went a week stale after a large merge wave. To avoid the same here, the feature
list should live in a config file like `apps/web-hono/src/components/roadmap/roadmap-config.ts`,
with copy in `@kaipu/i18n` (en + es parity test), and every shipped roadmap item should link to
its section on `/features`, so updating one page reminds you of the other.

## Open questions (defaults if unanswered)

1. **Real screenshots or animated mocks?** Default: real app screenshots and short clips —
   faster and more honest than the home's mocks.
2. **Mark paid features?** Depends on the plans work (PR #273, not merged). Default: no plan
   badges.
3. **In the main navigation next to Roadmap?** Default: yes.

## Claims to verify before publishing

- **Tags on screenshots.** The copy says recordings _and_ screenshots can be tagged; that comes
  from the tags plan and was not checked in the app.
- **GitHub size chips and the lighter 24 fps export** reach `main` with PRs #288 and #290. Drop
  that line if the page ships first.
- **Shortcuts** (⌃⌘C start, ⌃⌘S stop, ⌃⌘X capture, ⌃⌘O show app) were read from the app's
  status bar; say so if they are configurable.

## Claude Design prompt

Paste this into a new Claude Design project. It follows
[brand identity](/marketing/brand-identity/): Kai the fox, Kaipu pink, both themes, and nothing
planned presented as available.

```text
Design a public "Features" page for kaipu.app — the website of Kaipu Record, a
macOS screen recorder and screenshot tool for people who build software
(bug reports, changes, feedback, walkthroughs). The home page already sells
Kaipu in 30 seconds in four chapters (Record · Capture · Edit · Find). This page
is the complete, detailed catalogue the home links to: "everything Kaipu does".

## Brand (follow strictly)
- Name: Kaipu (site kaipu.app). Signature: "This. Captured." Landing promise:
  "Show it. Get back to work." Workflow line: "Capture it. Make it clear. Find it again."
- Mascot: Kai, a flat black fox bust on Kaipu pink with two cream eyes. Use him
  sparingly (header or closing), never as a joke on every card.
- Pink is the recognition cue. Light AND dark themes are both first-class.
- Voice: attentive, capable, warm, careful. Lead with the outcome, short
  sentences, specific language, no hype ("blazing fast", "revolutionary").
- Do not present planned work as available (Windows, cloud upload, AI).

## Page structure
1. Hero: title "Everything Kaipu does", one-line subtitle, a sticky in-page
   index of the four chapters (+ "Your files" and "Private by design").
2. Four chapters, same names and order as the home. Each chapter: label,
   one-sentence promise, then a grid of feature cards. Each card: icon, title,
   2–3 line description, an optional "detail" list (3–5 short bullets), and a
   media slot (real app screenshot or short looping clip — use clearly marked
   placeholders, I will drop in real captures).
3. "Your files" band.
4. "Private by design" band.
5. "Coming next" strip, visually separate and labelled as planned.
6. Closing CTA: Download for Mac (Apple Silicon) / Mac (Intel). Windows shown
   as "coming soon", not as a button that works.

## Features (shipped)

### 1 · Record — "Show what happened. One take. No setup."
- Screen and camera recording — screen, your voice, system audio and a floating,
  draggable camera bubble, in high quality.
- Start from anywhere — a menu-bar capture panel and global shortcuts
  (⌃⌘C start, ⌃⌘S stop, ⌃⌘X capture, ⌃⌘O show app). Pause, resume, stop.
- Microphone picker — choose any input; the list updates when you plug one in.
- Recording quality presets — trade file size for sharpness.
- Already saved — when you stop, it is in your library; interrupted recordings
  are recovered.

### 2 · Capture — "Sometimes a screenshot says it all. Point at it. Literally."
- Area, window or full screen.
- Annotations — boxes, arrows, handwritten-style notes, multi-line labels with
  word wrap, double-click to edit a label in place.
- Blur what shouldn't be seen; frame it on a clean background.
- Name it as you make it — a pre-filled title field, editable before and after saving.
- Copy in one click, save as PNG, or export a sharp one-page PDF.
- Save every screenshot automatically (default) or only when you click Save.

### 3 · Edit — "A small tweak. A clearer idea. Cut what's extra. Zoom into what matters."
- Automatic zoom on clicks — the editor suggests a zoom for every click and
  follows the cursor; each zoom is a segment you can move, resize or delete.
- Trim and cut — remove the start, the end, and anything in between.
- Mute a cough — silence a stretch of audio.
- Blur and cover regions — hide an API key or a customer name.
- Your original stays untouched — edits are non-destructive.
- Export for where it is going — pick a destination (GitHub, Slack, YouTube…)
  or keep Balanced; Maximum quality is one setting away. Show a size meter with
  "fits GitHub Free · 10 MB" / "GitHub Pro / Team / Enterprise · 100 MB" chips.
- Share in one click — reuses an export you already made instead of encoding again.
- Exports run in the background with progress, a "Ready to share" card, and
  drag-the-file-out to Slack, GitHub or Finder under a friendly name.

### 4 · Find — "Useful now. Easy to find later. Explain it once. It stays explained."
- One library for recordings and screenshots, with previews, badges, filters
  and search.
- Colored tags — create tags, give each a color, filter the library by tag.
- Rename anything; edited videos get their own poster thumbnail and point back
  to the original.

### Your files — "Your library is a folder."
- Every recording is an MP4 and every screenshot a PNG in ~/Movies/Kaipu Record.
  Open them with anything. Move them anywhere.

### Private by design
- Works without an account. Accounts (sign up, email verification, password
  reset) exist only for optional cloud features.
- No watermark on any plan; an optional "Made with Kaipu" badge, off by default.
- Analytics never records your screen or your clicks.
- Light and dark theme; fully in English and Spanish.

## Coming next (label as planned, muted styling, no dates)
Windows beta · cloud upload with resumable transfers · zoom and pan in the
image viewer · your own logo as a watermark.

## Deliverables
- Desktop (1440) and mobile (390) layouts, light and dark.
- One feature card component with and without media, and the chapter header.
- Copy in English; leave room for Spanish strings ~20% longer.
```
