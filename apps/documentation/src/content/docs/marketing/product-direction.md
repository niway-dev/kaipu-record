---
title: Product direction and monetization
description: The promise "record normally, Kaipu makes your software demo look edited" — Auto Polish, intent-based recording, developer workflows (PR demo, bug report), the free/paid boundary, and the questions to answer before building any of it.
---

# Product direction and monetization

**Working proposal · 2026-10-05.** Owner direction, not yet investigated against the codebase.
Nothing on this page is implemented or decided beyond what [Owner position](#owner-position) states.
The investigation in [Questions to answer](#questions-to-answer-before-implementation) is the next step.

## Owner position

- **Lead with developers who want to show their work.** It is the audience we understand best and
  can reach first. The core recorder and editor must still work for anyone who demonstrates software
  (designers, PMs, QA, founders, DevRel, product marketing, support).
- **Keep the product small and coherent.** Do not turn Kaipu into a developer platform or a Loom clone.
- **Open source is the acquisition layer**, not a mistake to undo.

## The promise

> Record normally. Kaipu makes your software demo look professionally edited.

Alternative line: **the screen recorder for showing software.**

Kaipu already ships or plans screen recording, system audio, microphone, camera bubble, screenshots,
a built-in editor (shapes, text, blur, annotations), zoom effects, recording presets, local-first
storage and processing, and no mandatory account. The direction below builds on that, it does not
replace it.

## 1. Product philosophy — correct decisions, don't create them

Traditional editors assume the user understands timelines, keyframes, easing, transforms,
transitions, framing, audio editing, cursor animation and cuts. Kaipu assumes the opposite: the
user knows how to demonstrate their product, not how to edit video.

So the editor optimizes for **correcting Kaipu's decisions** rather than making every decision by
hand. Instead of "where should this keyframe go?", Kaipu decides and offers **Keep · Remove ·
Stronger · Weaker**. Traditional editing complexity is progressively hidden, not removed.

## 2. Auto Polish

The user records normally. Kaipu analyzes the recording and **proposes editable decisions**:

- smart zoom around meaningful clicks; cursor smoothing and emphasis
- shorten dead time and accidental pauses; remove an obvious mistake followed by its correction
- speed up long typing sequences
- reframe dialogs and modals, center important UI, normalize window framing, smooth transitions
- normalize narration audio, suggest captions, detect sections/chapters
- blur sensitive information, highlight important interactions

The result reads like a summary the user can inspect item by item:

```text
Kaipu enhanced your recording
✓ 7 smart zooms
✓ 3 pauses shortened
✓ cursor smoothed
✓ 1 mistake removed
✓ 2 typing sequences accelerated
```

It should feel like "clean up my recording", not "open a video editor". The target flow:

```text
Record → Stop → Auto Polish → Review suggestions → Export / Share
```

instead of `Record → Learn video editing → Spend 30 minutes editing → Export`.

## 3. Intent-based recording

Lightweight intents chosen at the start of a recording. **One recorder, one editor** — an intent
changes defaults, metadata and output, never the architecture.

| Intent       | What it adds                              |
| ------------ | ----------------------------------------- |
| Recording    | Generic screen recording (today's flow)   |
| Product Demo | Defaults tuned for demonstrating software |
| PR Demo      | Git/repository context                    |
| Bug Report   | Output tuned for reproducing an issue     |

Possible later: Tutorial, Release, Social clip.

## 4. Kaipu PR — the developer showcase workflow

`kaipu pr` (or an equivalent UI entry point) detects the repository, current and base branch,
commits, diff, and the GitHub PR if one exists. The developer records the feature; Kaipu combines
the recording, selected screenshots, Git context and an optional narration transcript into a PR
description:

```markdown
## Recording presets

Added reusable recording presets.

### Demo

[video]

### What changed

- Added preset creation, persistence and selector
- Added empty state

### Demo flow

1. Open Presets
2. Create a preset
3. Configure recording
4. Save and use it
```

It must not need sophisticated video understanding to start. Progression:

| Version | Adds                                                            |
| ------- | --------------------------------------------------------------- |
| V0      | Recording + diff + commits + optional transcript → LLM markdown |
| V1      | Representative frames extracted                                 |
| V2      | Vision analysis of selected frames                              |
| V3      | Detected interactions become demo steps                         |
| V4      | Updates the GitHub PR directly                                  |

PR mode stays **optional**; it must not redefine Kaipu as a developer-only tool.

## 5. Bug Report mode

"Record the bug instead of writing the bug." The user reproduces the issue while recording; the
output can carry the video, screenshots, steps to reproduce, expected vs observed behavior, OS and
app/browser information, and optionally console errors and network failures. Later integrations
can file a GitHub, Linear or Jira issue. Like PR mode, it is an output workflow on the same recorder.

## 6. Monetization

This page reuses the rule in the [monetization ADR](/desktop/filesystem-first-monetization/) —
local features are free, the network layer is what is sold — and the
[free tier without watermark](/backlog/free-tier-no-watermark/) decision. It adds one new
boundary (A below) that the ADR does not cover; see [Tension with the ADR](#tension-with-the-monetization-adr).

**Free rule:** if a feature is local, cheap to provide and fundamental to making Kaipu great,
keep it free. Never make basic quality-of-life features annoying to create a paid tier.

### Two natural paid boundaries

**A. Kaipu does the work for you.** Free gives excellent editing tools; paid performs the editing.
Candidates: Auto Polish, automatic mistake and dead-time removal, advanced speech cleanup,
automatic chapters, AI summaries, AI-generated PR descriptions, automatic bug reports, AI-assisted
editing, advanced content detection. Open question: local lifetime license, paid add-on, included
in Cloud, or usage-based where external models cost money. **Do not pick the model before
estimating infrastructure and model costs.**

**B. Kaipu becomes infrastructure.** The most natural recurring subscription: hosted recordings,
share links, (time-based) comments, analytics, cloud library, transcription, summaries, chapters,
password-protected and expiring links, custom branding and domains, collaborative review, team
workspaces, GitHub/Linear/Jira integrations. See [Optional cloud](/backlog/optional-cloud/).

### Capability matrix (proposal)

| Capability                                                                                                                                                     | Community (free, OSS) | Cloud (individual) | Teams |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------: | :----------------: | :---: |
| Recording, screenshots, local projects and export, editor, manual and smart zoom, cursor effects, backgrounds, presets, camera bubble, trim, annotations, blur |           ✓           |         ✓          |   ✓   |
| Automation (Auto Polish, AI summaries, PR/bug report generation)                                                                                               |     Open question     |         ✓          |   ✓   |
| Hosting, share links, comments, analytics, transcription                                                                                                       |           —           |         ✓          |   ✓   |
| Team workspaces, collaborative review, integrations                                                                                                            |           —           |         —          |   ✓   |

Do not introduce a "Kaipu Pro" just because products usually have one. A paid **local** tier only
exists if enough valuable local automation justifies it.

### Tension with the monetization ADR

The ADR says "never charge for local features in a local-first model". Boundary A, if sold as a
local license, would charge for a local feature. Before choosing that option the ADR must be
reopened explicitly; selling automation only through Cloud (or usage-based, when a hosted model
runs it) stays inside the ADR as written.

## 7. Moat

Do **not** compete on effect count, storage, generic screen recording, video calls or async
messaging. Compete on **turning rough software recordings into clear, intentional demos with almost
no editing knowledge.**

Benchmark: a mediocre recording — searching for buttons, bad cursor movement, pauses, a wrong click,
slow typing, a modal, then the demo finishes — comes out of Kaipu feeling intentional.

## Questions to answer before implementation

Answer against the current codebase. Some groundwork already exists in
[AI and automation feasibility](/marketing/ai-and-automation/).

**Capture and editing model**

1. Which recording metadata can be captured without major architectural changes?
2. Do we know mouse positions and click timestamps today?
3. Can input events be aligned to video timestamps?
4. Can we detect active window bounds?
5. Which editing operations are nondestructive today?
6. Can automatic edits use the same editing model as manual edits?

**Automation**

7. Which Auto Polish features can be deterministic rather than AI-based?
8. Which need computer vision?
9. Which need an LLM?
10. Which can run entirely locally?
11. What model and infrastructure costs would cloud processing add?

**Workflows**

12. How can `kaipu pr` read Git context without coupling the recorder to Git?
13. Should developer workflows be plugins, actions or exporters?
14. How does the generic recorder stay clean while specialized workflows are added?

**Business**

15. What stays OSS forever?
16. Which natural recurring costs justify Kaipu Cloud?
17. Why choose Kaipu over Cap, Loom, Screen Studio or a traditional editor?

### Expected output of the investigation

1. Product architecture proposal
2. UX proposal
3. Free vs paid capability matrix (refining the one above)
4. Technical feasibility analysis
5. MVP recommendation
6. Risks
7. Incremental roadmap

Optimize for a small, coherent product rather than feature count. Do not implement everything.

## Related

- [Positioning and Recordly](/marketing/positioning/) · [Messaging playbook](/marketing/messaging-playbook/)
- [Product growth roadmap](/backlog/product-growth/)
- [Open source under AGPL-3.0](/marketing/open-source/)
- [Plans and entitlements](/backlog/plans-and-entitlements/)
