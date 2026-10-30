---
title: Supporter license — a voluntary payment that funds development
description: Owner decision to offer a symbolic, optional supporter license for the desktop app. It pays for improvements, never for use; open questions before design.
---

# Supporter license

> **Status: 🔵 Proposed (2026-10-30).** Linear: NIW2-567. Owner decision recorded; design
> session pending. Nothing is implemented.

## The decision

Kaipu will offer a **symbolic supporter license** for the desktop app. It is **not a charge
for use**: buying it funds improvements to the app. Everything local stays free for everyone,
commercial use included. That keeps the
[filesystem-first monetization ADR](/desktop/filesystem-first-monetization/) intact ("never
charge for local features"), and the terms of service already say so: the app may be used for
personal or commercial purposes without a paid plan.

## Why not copy Cap

Cap sells a Desktop License ($29 a year or $58 once) that its terms **require** for
commercial use of its official builds; building from source avoids it, because the code is
AGPL. Kaipu deliberately keeps the price idea and drops the requirement:

- A required license on AGPL code is enforced mostly by the honor system, and restricting
  builds that contain other people's AGPL contributions is legally weak.
- "Free for companies too" is a difference Kaipu can claim against Cap.
- A supporter purchase asks people to pay for what they want to see next, which fits a
  one-person, open-source project.

## Open questions for the design session

1. **Price.** A fixed symbolic amount, pay-what-you-want with a floor, one-time or yearly.
2. **Payment provider.** A processor or merchant of record that works for Niway S.A.C. in
   Peru (for example Polar, Lemon Squeezy, Paddle or GitHub Sponsors). The privacy policy
   must name it ([legal documents](/backlog/legal-documents/), open work item 6).
3. **What a supporter gets** without gating a feature: a badge in the app, a name in the
   credits, early builds, a say in the roadmap.
4. **Relation to Cloud Pro.** Bundled benefit or fully separate.
5. **Where it is offered.** Settings → About, the website, the README.
6. **Terms for a voluntary purchase.** Refunds and consumer protection (INDECOPI).

## Out of scope

Any limit on local recording, editing or export, a watermark tied to payment, or a license
key the app checks before letting someone work.
