---
title: Marketing and product growth
description: Positioning, brand exploration, and proposed ways to expand Kaipu's everyday usefulness.
---

# Marketing and product growth

Recorded on **2026-09-27** from the owner's competitive-positioning discussion.
These are working hypotheses and recommendations, not validated market findings or delivery commitments.

**Direction:** help people turn what they see into something another person can understand, then find and reuse that explanation later.

**Brand authority:** [Kaipu brand identity](/marketing/brand-identity/) preserves the creator's adopted meaning. Read it before interpreting the name or changing brand assets. [Brand and website rollout](/plans/2026-09-27-brand-and-website-rollout/) is the execution sequence, including intake of the creator's new logo and notch-state art.

| Read                                                            | Purpose                                                                                                                    |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| [Positioning and Recordly](/marketing/positioning/)             | Audience, differentiation, competitive evidence, landing narrative, and pricing tension                                    |
| [Brand and Kai](/marketing/brand-and-kai/)                      | Keep Kaipu and pink; explore a warmer experience and a supporting mascot                                                   |
| [AI and automation feasibility](/marketing/ai-and-automation/)  | Captions, audio-based summaries, CLI, and agent-driven editing; current technical constraints                              |
| [Messaging playbook](/marketing/messaging-playbook/)            | The one message and the moves on the landing, in the product and in content that prove it; benchmarks and comparison pages |
| [Website concept and copy](/marketing/website-concept/)         | Four-chapter visual direction, implemented EN/ES copy, release-aware messaging, media shot list, and production sequence   |
| [Open source under AGPL-3.0](/marketing/open-source/)           | Why the whole monorepo opens, the pre-open checklist, and the contribution policy                                          |
| [Product growth roadmap](/backlog/product-growth/)              | Priorities, smallest useful experiments, dependencies, and success criteria                                                |
| [Free tier without watermark](/backlog/free-tier-no-watermark/) | Decision and implementation: no watermark on the free app, opt-in badge                                                    |
| [Windows beta](/backlog/windows-beta/)                          | Ship recording on Windows now, screenshots later                                                                           |

## Decisions taken on 2026-09-27

No watermark on the free tier (done on this branch), no Tauri rewrite, AGPL-3.0 with the
whole monorepo opening at launch, Windows recording-only beta, and a roadmap that adds GIF,
keystroke visualizer, captions on Parakeet, silence cutting and a CLI. The full list with
links is at the top of [Positioning](/marketing/positioning/#owner-decisions-2026-09-27).

## How this section is worked on

The growth strategy lives as one long-running branch and PR of docs and notes. Every idea
gets its own brainstorm, in stages, one at a time; the result of each brainstorm is a feature
doc in `backlog/` linked from the [growth roadmap](/backlog/product-growth/). Code for an
idea starts only after its doc exists. Order agreed on 2026-09-27: GIF export first (smallest,
self-contained), then Windows beta, then the landing sections, then keystrokes and the CLI.

## Working principles

- Win the repeated capture → clarify → deliver → retrieve workflow, rather than matching every video-production feature.
- Beautiful defaults support clarity; extensive customization is not the goal.
- The library is a retention hypothesis. Fast, useful output is the initial acquisition promise.
- Show real product behavior before making reliability, speed, or hardware claims.
- Explore one AI capability at a time. Store ideas without treating them as approved implementation.
- Keep public promises tied to released, validated behavior. This section does not change the public roadmap.

## Relationship to existing documentation

The [product philosophy](/desktop/product-philosophy/) remains the foundation.
The [design brief](/briefings/design-brief/) describes the existing visual system; the brand exploration does not replace it.
The [master backlog](/backlog/roadmap/) links the proposed growth sequence alongside existing work.
Runtime architecture and CLI protocols require their own designs. Brand meaning and the owner's growth decisions are recorded explicitly; final visual assets and the website layout remain pending implementation.
