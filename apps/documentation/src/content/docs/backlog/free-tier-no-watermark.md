---
title: "Free tier ships without a watermark"
description: "Decision and implementation: the free app burns no watermark. The mark survives as an opt-in 'Made with Kaipu' badge, off by default. Plan entitlements no longer gate anything local."
---

# Free tier ships without a watermark

> **Status: 🟢 Ready to validate** (2026-09-27). Owner decision during the competitive review
> against [Recordly](/marketing/positioning/). Parent:
> [Product growth](./product-growth) · supersedes the free/paid gating in
> [Pro mode](/features/pro-mode/) and the live-gating note in
> [roadmap → 6 — Watermark](./roadmap).

## Decision

The free desktop app records, edits and exports **without a watermark**. The Kaipu mark stays
in the product only as an **opt-in "Made with Kaipu" badge**, a toggle in Settings → Recording
that is **off by default**. Nothing local is gated by plan any more.

## Why

- The [monetization ADR](/desktop/filesystem-first-monetization/) already states the rule:
  local features are free, the network layer is what is sold. A watermark on local output was
  the one place the product contradicted its own rule.
- The direct competitor is free with no watermark. Against that, the mark was the most
  visible friction on every clip a user sent, for a marketing return that is hard to measure.
- The marketing job the watermark was doing moves to the **shared-link page**: a recording
  shared through Kaipu Cloud lands on a Kaipu-branded page. That reaches the viewer without
  taxing the person who recorded.
- People who _want_ to credit the tool can still do it, on purpose, with the toggle.

## What changed (this branch)

| Path                                                                         | Change                                                                                              |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `apps/kaipu-record/src/shared/types/ipc.ts`                                  | `AppSettings.showBrandBadge: boolean`, default `false`                                              |
| `apps/kaipu-record/src/main/services/settings.service.ts`                    | Merges the new field, coerces non-booleans to `false`                                               |
| `apps/kaipu-record/src/renderer/src/pages/settings/brand-badge-settings.tsx` | The toggle, under Settings → Recording                                                              |
| `apps/kaipu-record/src/renderer/src/features/watermark/use-watermark.ts`     | Reads the setting; no plan, flag or dev override involved                                           |
| `apps/kaipu-record/src/renderer/src/features/watermark/watermark.ts`         | `resolveWatermarkEnabled` and `WatermarkInputs` removed; placement math untouched                   |
| `apps/kaipu-record/src/renderer/src/features/watermark/dev-override.ts`      | Deleted with its Developer-settings section                                                         |
| `apps/kaipu-record/src/shared/entitlements.ts`                               | `isWatermarkRemovalGranted` removed; `features.watermarkRemoval` stays on the wire, marked legacy   |
| `apps/kaipu-record/src/shared/analytics.ts`                                  | The `watermark-enabled` PostHog flag removed (it only existed as a remote kill switch for the gate) |
| `packages/i18n/messages/{en,es}.json`                                        | `settings.brandBadge`, `settings.brandBadgeDescription`                                             |

The compositor, the asset, and the corner placement from the
[watermark redesign](./watermark-redesign) are unchanged: the badge looks exactly like the old
watermark, it is just off unless asked for.

## What did not change

- The **entitlements vertical** ([ADR 0002](/architecture/decisions/0002-plan-entitlements-separate-from-auth/),
  `deriveEntitlements`, the `subscription` table, `GET /api/v1/me/entitlements`, the desktop
  cache) is intact. It now has no local consumer; its next consumers are the cloud features
  (`cloudUploads`, `cloudStorageBytes`) that already ride on the same map.
- The server still emits `features.watermarkRemoval`. Dropping it is a server-side cleanup
  for whenever the contract is next touched; the desktop ignores it.

## Validation

- [ ] Packaged build: a fresh install records with no mark.
- [ ] Toggle on → the next recording carries the bottom-right badge; toggle off → it does not.
- [ ] A signed-in `free` account and a `pro` account behave identically for local recording.
- [ ] Settings → Developer no longer shows a Watermark section.

## Follow-ups

- Remove the `watermark-enabled` flag from the PostHog dashboard (it is no longer read).
- When the Cloud share page ships, make sure the Kaipu branding on it is the marketing
  surface this decision counts on.
- Update the public pricing copy to say "free, no watermark" once this is in a release.
