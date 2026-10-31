---
title: Legal documents — terms, privacy, Cloud and cookies
description: Where the legal pages live, how sign-up links to them, and the operator-side latitude the drafts reserve.
---

# Legal documents

> **Status: 🟡 In progress.** The pages and sign-up links are on this branch. The text is a
> product draft, **not reviewed by a lawyer**, and acceptance is not recorded server-side yet.

## Where they live

- Web routes: `/legal/terms-and-conditions`, `/legal/privacy-policy`, `/legal/cloud-terms`,
  `/legal/cookies` (`apps/web-hono/src/routes/legal/`), rendered by `LegalPage` from the
  `legal` namespace in `packages/i18n/messages/{en,es}.json`.
- Linked from the web footer, web sign-up, and desktop sign-up (`VITE_PUBLIC_WEB_URL`).
- Operator: Niway S.A.C., Lima, Peru. Contact: `contacto@niway.dev`. Spanish prevails.
- Reusable, product-agnostic templates live in the general-knowledge hub under `legal/`.

## Latitude the drafts reserve for the operator

| Topic                                                       | Rule                                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Free capacity changes                                       | At Niway's discretion; reasonable notice, normally ≥ 15 days                                |
| Over a limit                                                | Uploads restricted; files above the limit may be deleted ≥ 60 days after notice             |
| Inactive free accounts                                      | Cloud files may be deleted after 12 months without sign-in, with 30 days email notice       |
| Ending Cloud                                                | Any reason; normally ≥ 30 days notice, then hosted content may be deleted                   |
| Free account closure                                        | Any reason with 30 days notice; immediate for abuse, security or legal reasons              |
| Terms changes                                               | Normally ≥ 15 days notice; continued use means acceptance                                   |
| Liability                                                   | Capped at the greater of 12 months of fees or USD 50; indirect damages excluded             |
| Content license                                             | Operate, secure, improve and support; no general-purpose AI training without permission     |
| App license                                                 | Personal **or commercial** use; no paid plan needed to use the desktop app at work          |
| Providers                                                   | "Currently including" Cloudflare, Neon, PostHog; may be added or replaced                   |
| Paid plans                                                  | Subscriptions auto-renew; processor or merchant of record; prices change for future periods |
| Plan ends                                                   | Account returns to free limits; over-limit rules apply to stored content                    |
| Age                                                         | 18+ or local age of majority; confirmed at sign-up; minors' accounts may be closed          |
| New features                                                | Policy updated, consent asked where required, before new data or purposes are used          |
| Assignment, force majeure, feedback, indemnity, Lima courts | Included                                                                                    |

Consumer rights (INDECOPI), Law 29733 data rights and non-waivable protections are always
preserved, so the clauses stay enforceable.

## Open work

1. Record acceptance: store `termsVersion` and `termsAcceptedAt` on sign-up.
2. Legal review before production launch. Include the repository's [CLA](https://github.com/niway-dev/kaipu-record/blob/main/CLA.md)
   and [trademark policy](https://github.com/niway-dev/kaipu-record/blob/main/TRADEMARKS.md) (NIW2-566), which are project drafts too.
3. Implement the inactive-account and over-limit deletion jobs before relying on those clauses.
4. Record the 18+ confirmation the sign-up notice now asks for (store it with the acceptance
   record from item 1).
5. SignPath Foundation code signing: its terms require software that sends user data to
   systems the user did not choose to describe it in a privacy policy, **show that policy
   during installation**, and **offer an option to turn it off**. The desktop app sends
   PostHog diagnostics with no opt-out (`apps/kaipu-record/src/main/services/analytics.service.ts`)
   and the NSIS installer shows no policy. Both need code before the application.
6. Name the payment provider in the privacy policy once one is chosen.
