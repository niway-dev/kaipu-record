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

| Topic                                                       | Rule                                                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Free capacity changes                                       | At Niway's discretion; reasonable notice, normally ≥ 15 days                            |
| Over a limit                                                | Uploads restricted; files above the limit may be deleted ≥ 60 days after notice         |
| Inactive free accounts                                      | Cloud files may be deleted after 12 months without sign-in, with 30 days email notice   |
| Ending Cloud                                                | Any reason; normally ≥ 30 days notice, then hosted content may be deleted               |
| Free account closure                                        | Any reason with 30 days notice; immediate for abuse, security or legal reasons          |
| Terms changes                                               | Normally ≥ 15 days notice; continued use means acceptance                               |
| Liability                                                   | Capped at the greater of 12 months of fees or USD 50; indirect damages excluded         |
| Content license                                             | Operate, secure, improve and support; no general-purpose AI training without permission |
| Providers                                                   | "Currently including" Cloudflare, Neon, PostHog; may be added or replaced               |
| Assignment, force majeure, feedback, indemnity, Lima courts | Included                                                                                |

Consumer rights (INDECOPI), Law 29733 data rights and non-waivable protections are always
preserved, so the clauses stay enforceable.

## Open work

1. Record acceptance: store `termsVersion` and `termsAcceptedAt` on sign-up.
2. Legal review before production launch.
3. Implement the inactive-account and over-limit deletion jobs before relying on those clauses.
