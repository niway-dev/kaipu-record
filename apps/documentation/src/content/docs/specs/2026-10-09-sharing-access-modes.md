---
title: "Sharing as access modes: private, organization, link"
description: "Design spec for Kaipu cloud sharing — one stable link per published revision, an extensible set of access grants, one pure canView policy, a public watch page that never exposes storage keys, invisible fair-use limits and the 2026-10-08 storage policy."
---

# Sharing as access modes: private, organization, link

**Status: 🔵 Proposed — design for review (NIW2-216).** Spec date 2026-10-09. No code
ships with this document; implementation waits until the `design:` pull request that
adds it is approved. Open questions were resolved with the proposed defaults of the
NIW2-216 brief (spec draft approved by Cristian on 2026-10-09 with defaults).

Extends [Optional cloud — product](/specs/2026-09-09-cloud-product/) § Sharing (which allowed
only "anyone with the link") and the sharing states in
[Identity, revisions, and .kaipu](/specs/2026-09-09-cloud-data-model/). Implements
[plan — cloud delivery](/plans/2026-09-09-cloud-delivery/) Phase 4. Unblocks NIW2-223
(share by email, request access).

## Summary (one minute)

Owners choose **who** can watch a published recording — only me, my organization,
Kaipu users with the link, or (later) anyone with the link — and the URL never changes
when they change their mind. A share is a stable link pinned to one revision; access is a
set of grant rows; one pure function, `canView`, decides every view. A new mode is a new
`subject_type` and one branch in `canView`, never a new endpoint or table. Public playback
streams through the Worker with short-lived tokens, so storage keys and owner ids never
reach a viewer, revocation is bounded at 60 s, and invisible fair-use caps keep a viral
link from running up the bill.

| #   | Decision                                                                                                                                                                                                                                            | Why                                                                                                       | ADR                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | Split **`share`** (stable slug → asset + pinned revision) from **`share_grant`** (audience rows). No active grant = Only me                                                                                                                         | Changing the audience never breaks the URL; email grants (NIW2-223) attach to the same link               | [0013](/architecture/decisions/0013-sharing-stable-link-plus-access-grants/)     |
| 2   | One pure **`canView(viewer, share, grants, ctx)`** in `packages/domain`; owner always allowed; four outcomes: allow, `gone`, `sign_in_required`, `no_access` (+ `unavailable` from fair-use, outside `canView`)                                     | One place to audit and test every mode; new modes are a branch plus tests                                 | 0013                                                                             |
| 3   | v1 subject types `organization`, `kaipu_user`, `public_link`; reserved `user`, `email`, `password` (rejected by the API in v1); `expires_at` exists, not settable in v1                                                                             | Room for NIW2-223, expiry and passwords without a migration of the model                                  | 0013                                                                             |
| 4   | **One stable URL per share**; Reset link is the only way to get a new URL (Drive/Loom behaviour) (Q2)                                                                                                                                               | People paste the link once; narrowing access must not require re-sending it                               | 0013                                                                             |
| 5   | "Kaipu users with the link" requires **signed-in + verified email**; "Anyone with the link" is modelled but behind `SHARING_PUBLIC_LINK_ENABLED`, **default OFF** in v1 (Q4)                                                                        | Matches the cloud access rule; blocks throwaway sign-ups; public exposure waits for fair-use data         | 0013                                                                             |
| 6   | Organizations use the **Better Auth `organization` plugin** for membership only; billing stays outside auth. Org mode ships as its own milestone after Only me + Kaipu users, shown disabled ("coming soon") until then (Q1)                        | Invitations, roles and acceptance security already exist there; ADR 0002 is about billing, not membership | [0014](/architecture/decisions/0014-organizations-via-better-auth-plugin/)       |
| 7   | Shared media is **streamed through the Worker** with HMAC playback tokens (TTL 15 min, share-state cache 60 s), never presigned R2 URLs (Q3)                                                                                                        | The storage key embeds `userId/assetId/revisionId`; revocation must be bounded and short                  | [0015](/architecture/decisions/0015-shared-media-streamed-with-playback-tokens/) |
| 8   | **Capacity is the only visible limit**: no credits; invisible fair-use on shared playback; over quota → read-only, **no deletion**; derived files excluded from quota; inactive free accounts archived after 12 months, never deleted (Q5, Q9, Q10) | The 2026-10-08 storage decisions, written once; supersedes the 60-day deletion rule of the trial spec     | [0016](/architecture/decisions/0016-capacity-is-the-only-visible-storage-limit/) |
| 9   | Web share dialog in v1 (library, NIW2-221); desktop gets "Copy link / Open in web" later (Q11)                                                                                                                                                      | One UI to build first; the API is shared, so no rework                                                    | —                                                                                |

**Open questions:** none blocking — all twelve brief questions are answered by their
proposed defaults (see [Decisions on the open questions](#decisions-on-the-open-questions)).
Items marked _to verify_ are implementation facts to confirm in the first sub-issue, not
product choices.

**Out of scope:** comments and reactions; view analytics for owners; public profiles or
galleries; search-engine indexing; roles other than `viewer`; password and expiry modes
(reserved only); share by email and request access (NIW2-223); updating the shared
revision (cloud-delivery Phase 6); server transcoding; desktop share dialog; payments and
org billing.

## Failures this must protect against

- **A storage key or owner id reaching a viewer.** `buildRevisionStorageKey` produces
  `videos/<userId>/<assetId>/<revisionId>.<ext>`; a presigned URL would leak all three.
  Media is served only by `/api/v1/public/media/{playbackToken}`, and a snapshot test asserts
  the resolve response contains no forbidden key.
- **Revocation that does not revoke.** A revoked, reset or narrowed share must stop new
  resolutions immediately and open players within 60 s — never "until the URL expires".
- **A half-applied mode switch** leaving two broad grants live. Mode changes revoke and
  insert in one non-interactive transaction (`db.batch`, the pattern
  `cloud-asset.repository.ts` already uses on neon-http).
- **The URL changing when the audience changes**, breaking links people already pasted.
  Only Reset link rotates the slug.
- **An enumeration oracle.** Unknown slug, revoked share and deleted asset return the same
  `gone` response with near-constant timing; the slug format is validated before any DB hit.
- **A viral link running up the bill.** Every media range request is a Worker invocation
  and an R2 Class B read; per-share and per-owner daily caps stop it without showing users
  a quota.
- **The capability leaking.** Slugs and playback tokens are never logged in full (hash
  prefix only) and never sent as `Referer` (`Referrer-Policy: no-referrer`).
- **Org access outliving membership.** A viewer who left the org loses access on the next
  request; an owner who left has their org grants revoked.
- **Deleting someone's files because their quota shrank.** Over quota is read-only; nothing
  is deleted (supersedes the trial spec's 60-day rule).

## Decisions on the open questions

| Q   | Question                                     | Decision (proposed default, accepted 2026-10-09)                                                                                                                                                     |
| --- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Organizations: plugin, own table, or defer?  | Better Auth `organization` plugin, membership only (ADR 0014). Org mode is its own milestone after Only me + Kaipu users; the mode is visible but disabled ("coming soon") until it ships            |
| 2   | One stable link, or a link per mode?         | One stable URL per share; changing the audience keeps it; Reset link is the only rotation                                                                                                            |
| 3   | Worker proxy or presigned URLs?              | Worker proxy, HMAC playback tokens, TTL 15 min, share-state cache 60 s (ADR 0015)                                                                                                                    |
| 4   | Kaipu users: verified email or any account?  | Signed-in **and** verified email. Anyone with the link stays modelled, flag OFF in v1                                                                                                                |
| 5   | Fair-use numbers and behaviour               | 1,000 views/day per share; 5,000/day per owner (free), 25,000 (pro). Over cap → "temporarily unavailable" for non-owners until 00:00 UTC; at most one owner email/day; operator can lift per account |
| 6   | Abuse limits                                 | 30 share mutations / 10 min and 200 / day per account; 60 resolves/min and 600 media requests/min per IP; no cap on active shares (bounded by assets)                                                |
| 7   | Owner shown on the watch page                | Display name only ("Shared by Cristian"); never email or avatar URL; hidden for `public_link` when the name looks like an email                                                                      |
| 8   | Link previews                                | Open Graph title + poster only for `public_link`; restricted modes unfurl as a generic "Kaipu video — sign in to watch"                                                                              |
| 9   | Inactive free accounts                       | 12 months without sign-in or upload → archived: shares paused, uploads blocked, files kept; sign-in restores everything; warnings 30 and 7 days before. No deletion (ADR 0016)                       |
| 10  | Over quota: shares keep working, new shares? | Yes to both; read-only blocks only new bytes. Fair-use caps still apply                                                                                                                              |
| 11  | Where can users share in v1?                 | Web share dialog (NIW2-221 library); desktop "Copy link / Open in web" in a follow-up                                                                                                                |
| 12  | Owner leaves the org                         | Revoke their org grants (`afterRemoveMember` hook); the share shows "Only me" with a notice; rejoining does not restore it                                                                           |

## Access modes (UI)

| Mode (UI label)            | Grants written                    | Who can watch                                                           | v1 state                     |
| -------------------------- | --------------------------------- | ----------------------------------------------------------------------- | ---------------------------- |
| **Only me**                | none                              | The owner                                                               | Available                    |
| **My organization** (pick) | `organization` (subject = org id) | Signed-in current members of that org, while the owner is also a member | Disabled, "coming soon" (Q1) |
| **Kaipu users with link**  | `kaipu_user`                      | Any signed-in account with a verified email who has the link            | Available                    |
| **Anyone with the link**   | `public_link`                     | Anyone who has the link, no account                                     | Hidden; flag OFF (Q4)        |

The share dialog states that copies already downloaded by viewers cannot be recalled
(product spec). The organization is picked explicitly in the dialog; Better Auth's
"active organization" on the session is not used for sharing.

## Data model

New file `packages/infra-db/src/schema/share.ts`, following `createTable` and the composite
keys of `schema/cloud.ts`. `subject_type` is a TS `as const` enum
([enums as const](/architecture/enums-as-const/)).

```
share
  id                     text pk (uuid)
  owner_user_id          text not null → user.id on delete cascade
  asset_id               text not null            -- (owner_user_id, asset_id) → cloud_asset
  published_revision_id  text not null → cloud_revision.revision_id
  slug                   text not null unique     -- capability; rotated on reset, never reused
  slug_version           integer not null default 1
  created_at, updated_at timestamptz not null
  revoked_at             timestamptz null
  unique (owner_user_id, asset_id) where revoked_at is null   -- one active share per asset (v1)

share_grant
  id            text pk (uuid)
  share_id      text not null → share.id on delete cascade
  subject_type  text not null   -- v1: 'organization' | 'kaipu_user' | 'public_link'
                                -- reserved: 'user' | 'email' | 'password'
  subject_id    text null       -- org id / user id / normalized email; null for kaipu_user, public_link
  role          text not null default 'viewer'
  created_by    text not null → user.id
  created_at    timestamptz not null
  expires_at    timestamptz null   -- exists; not settable in v1
  revoked_at    timestamptz null
  unique (share_id, subject_type, coalesce(subject_id, '')) where revoked_at is null
  index  (subject_type, subject_id) where revoked_at is null

share_usage_daily                 -- fair-use counters only
  share_id       text → share.id on delete cascade
  owner_user_id  text
  day            date
  views          integer not null default 0
  pk (share_id, day)
  index (owner_user_id, day)
```

- **Active grant** = `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now)`.
- **Slug**: ≥ 128 bits of CSPRNG entropy, base62, ~22 characters. `slug_version` increments
  on reset and is bound into playback tokens, so a reset also kills open players.
- A share pins exactly one `ready` revision. Uploading or editing never changes
  `published_revision_id`; Phase 6 (update shared version) will change it only by
  compare-and-swap, as the data-model spec requires.
- Revoked shares stay as tombstones; their slug is never reused.
- Migration strategy is _to verify_: the repo has `drizzle.config.ts` but no committed
  migrations. Schema changes ship as Drizzle schema plus a note "needs `db:push` by
  Cristian" unless a migrations setup exists by then.

The data-model spec's sharing states map onto this model:

| Data-model state | Here                                                                 |
| ---------------- | -------------------------------------------------------------------- |
| Private          | No share, or a share with no active grant (Only me)                  |
| Link active      | Share with at least one active grant                                 |
| Revoking         | Client-side transitional state while the revoke request is in flight |
| Link revoked     | `share.revoked_at` set (tombstone)                                   |

## The `canView` policy

Pure function in `packages/domain/src/schemas/share.ts`, returning the repo's `Result`
type. Inputs: the viewer (`anonymous` or `{ userId, emailVerified }`), the share (with
asset/revision state), its active grants, and a context (`now`, feature flags, and a
membership lookup result for each org grant, resolved by the caller through the read-only
`IOrganizationMembershipRepository.isMember(userId, orgId)` port so the domain never
imports Better Auth).

Evaluation order:

1. Viewer is the owner → **allow** (even while revoked, so the owner can see the tombstone
   state in the UI, and even over fair-use caps).
2. Share revoked, asset's cloud copy deleted, or revision not `ready` → **`gone`**.
3. Any active grant matches → **allow**:
   - `public_link` matches anyone, **only if** `SHARING_PUBLIC_LINK_ENABLED` is on.
   - `kaipu_user` matches a signed-in viewer with a verified email.
   - `organization` matches only if the viewer **and the owner** are current members.
   - Reserved types never match in v1 (the API refuses to write them).
4. No match, anonymous viewer → **`sign_in_required`** if some active grant could match a
   signed-in user (`kaipu_user`, `organization`), else **`no_access`**.
5. No match, signed-in viewer → **`no_access`** (NIW2-223 hooks "request access" here).

`unavailable` (fair-use) is applied by the resolve use case **after** `canView` allows, for
non-owners only.

### Truth table

Rows: the share's active grant. Columns: the viewer. "flag" = `SHARING_PUBLIC_LINK_ENABLED`.

| Share state / grant                                       | Anonymous          | Signed in, unverified | Signed in, verified, not member | Verified, member of the org | Owner                            |
| --------------------------------------------------------- | ------------------ | --------------------- | ------------------------------- | --------------------------- | -------------------------------- |
| No active grant (Only me)                                 | `no_access`        | `no_access`           | `no_access`                     | `no_access`                 | allow                            |
| `kaipu_user`                                              | `sign_in_required` | `no_access`           | allow                           | allow                       | allow                            |
| `organization`, owner still a member                      | `sign_in_required` | `no_access`¹          | `no_access`                     | allow                       | allow                            |
| `organization`, owner left the org²                       | `sign_in_required` | `no_access`           | `no_access`                     | `no_access`                 | allow                            |
| `public_link`, flag ON                                    | allow              | allow                 | allow                           | allow                       | allow                            |
| `public_link`, flag OFF                                   | `no_access`        | `no_access`           | `no_access`                     | `no_access`                 | allow                            |
| Only grant has `expires_at` in the past                   | as Only me         | as Only me            | as Only me                      | as Only me                  | allow                            |
| Only grant has `revoked_at` set                           | as Only me         | as Only me            | as Only me                      | as Only me                  | allow                            |
| Share revoked / cloud copy deleted / revision not `ready` | `gone`             | `gone`                | `gone`                          | `gone`                      | allow (UI shows revoked/deleted) |

¹ Membership requires a verified email at invitation acceptance
(`requireEmailVerificationOnInvitation`), so an unverified member is not reachable in
practice; `canView` still denies it.
² Defensive: the `afterRemoveMember` hook revokes the owner's org grants (Q12), so this row
is normally "no active grant". `canView` checks owner membership anyway, for the window
between the removal and the hook, and for hook failures.

Scenarios Cristian asked to check: colleague in the same org → allow; colleague who left
the org → `no_access` on the next request; stranger with the link while the public-link
flag is off → `no_access` (or `sign_in_required` if the share is also open to Kaipu users);
signed-in unverified viewer on a Kaipu-users share → `no_access` with a "verify your email"
hint; owner deleted the cloud copy → `gone`.

## API

### Owner routes (behind `authMiddleware`, owner-scoped like `/assets/*`)

`apps/server-hono/src/contract/share.contract.ts`, module `modules/share/*`.

| Method & path                               | Effect                                                                                                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/v1/assets/{assetId}/share`       | Create the share (pins the current `ready` revision; mode Only me). Idempotent: returns the active share if one exists                                                               |
| `GET /api/v1/assets/{assetId}/share`        | The active share: URL, mode, pinned revision, created/updated dates                                                                                                                  |
| `PUT /api/v1/assets/{assetId}/share/mode`   | Body `{ mode: 'only_me' \| 'kaipu_users' \| 'organization' \| 'public_link', organizationId? }`. Revokes current grants and inserts the new ones in one `db.batch`; last writer wins |
| `POST /api/v1/assets/{assetId}/share/reset` | Rotate slug, `slug_version + 1`; old URL → `gone` immediately                                                                                                                        |
| `DELETE /api/v1/assets/{assetId}/share`     | Revoke: grants revoked + `share.revoked_at` set. Idempotent                                                                                                                          |

Validation: `organization` requires the owner to be a current member of `organizationId`;
`public_link` is refused while the flag is off; reserved subject types are refused.
Rate limit: 30 mutations / 10 min and 200 / day per account → `429` in the existing
`modules/cloud/errors.ts` error shape.

### Public resolve (no `authMiddleware`; optional session)

`GET /api/v1/public/shares/{slug}` — `contract/public.contract.ts`, `modules/public/*`, with a
new `optionalSessionMiddleware` (same `auth.api.getSession` call as `middleware/auth.ts`,
never throws). `Cache-Control: private, no-store`.

On allow (`200`):

| Field         | Notes                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------- |
| `title`       | Asset title                                                                               |
| `kind`        | `video` \| `image`                                                                        |
| `durationMs`  | Videos only                                                                               |
| `contentType` | e.g. `video/mp4`                                                                          |
| `posterUrl`   | `/api/v1/public/media/{token}?part=poster`, or `null`                                     |
| `mediaUrl`    | `/api/v1/public/media/{token}`                                                            |
| `publishedAt` | Share creation date                                                                       |
| `ownerName`   | Display name, or `null` (Q7)                                                              |
| `mode`        | `kaipu_users` \| `organization` \| `public_link` — drives the watch-page copy and OG tags |
| `expiresAt`   | Playback-token expiry, so the player can re-resolve before it                             |

Never present: email, user id, asset id, revision id, share id, storage key, sizes, sha,
`derivedFromAssetId`, local paths.

On deny: `{ state: 'gone' | 'sign_in_required' | 'no_access' | 'unavailable' }` only.
`gone` is `404`-shaped and identical for unknown, revoked and deleted; `sign_in_required`
`401`; `no_access` `403`; `unavailable` `429`-shaped with no numbers.

Rate limit: 60 resolves/min per IP (Workers Rate Limiting binding). A "view" for fair-use is
one successful non-owner resolve, counted in `share_usage_daily`.

### Media

`GET|HEAD /api/v1/public/media/{playbackToken}` — Worker streams from R2 with `Range` /
`206` support (recordings are written with `fastStart: false`, so the player reads the tail
first; NIW2-222 owns fast-start). `Content-Disposition: inline`. The token is
`HMAC(SHARE_TOKEN_HMAC_KEY, shareId, revisionId, slugVersion, exp)`; each request re-checks
the share is active (cached ≤ 60 s). 600 media requests/min per IP. Details and trade-offs:
[ADR 0015](/architecture/decisions/0015-shared-media-streamed-with-playback-tokens/).

## Watch page

`apps/web-hono/src/routes/v/$slug.tsx`, public, outside `_authenticated`; calls the resolve
endpoint through the existing Service Binding proxy (`routes/api/v1/$.ts`), so cookies stay
first-party.

- States: **player** (NIW2-222) · **sign in** (with return to `/v/<slug>`) · **no access**
  (with "verify your email" when that is the reason) · **gone** · **temporarily unavailable,
  try later** (fair-use).
- Headers: `X-Robots-Tag: noindex, nofollow`, `<meta name="robots" content="noindex">`,
  `Referrer-Policy: no-referrer`.
- Link previews: Open Graph title + poster only for `public_link`; every other mode unfurls
  as "Kaipu video — sign in to watch", no title, no poster (Q8).
- i18n: every string (mode names, dialog copy, states, emails) in
  `packages/i18n/messages/{en,es}.json`.

## Revocation and lifecycle

| Event                                      | Effect                                                                                                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Revoke / Reset link / narrow the mode      | New resolutions denied immediately; open players stop within 60 s (share-state cache) — at most the 15 min token TTL if the check cannot run |
| `DELETE /assets/{id}/cloud`                | Share revoked (tombstone, slug never reused)                                                                                                 |
| Revision deleted                           | Not possible while pinned; if forced, the share resolves `gone`                                                                              |
| Account deleted (NIW2-214)                 | Shares, grants and counters cascade                                                                                                          |
| Org deleted, or owner leaves/is removed    | That org's grants on the owner's shares revoked (Q12); share shows "Only me" with a notice                                                   |
| Viewer leaves the org                      | Loses access on the next request (membership read per resolve)                                                                               |
| Account archived (inactive free, ADR 0016) | Shares paused → watch page "unavailable"; restored on sign-in                                                                                |
| Over quota (ADR 0016)                      | Shares keep working; new shares allowed; fair-use caps still apply (Q10)                                                                     |
| `SHARE_TOKEN_HMAC_KEY` rotated             | Every playback token invalid; players re-resolve (acceptable)                                                                                |

## Constants

In `packages/domain/src/constants/sharing-limits.ts`, marked `PROPOSAL` the way
`cloud-limits.ts` marks unconfirmed numbers. Fair-use caps are server configuration and
never shown as a quota.

| Constant                              | Value         |
| ------------------------------------- | ------------- |
| `SHARE_SLUG_BYTES`                    | 16 (128 bits) |
| `PLAYBACK_TOKEN_TTL_SECONDS`          | 900           |
| `SHARE_STATE_CACHE_SECONDS`           | 60            |
| `SHARE_MUTATIONS_PER_10_MIN`          | 30            |
| `SHARE_MUTATIONS_PER_DAY`             | 200           |
| `SHARE_RESOLVES_PER_IP_PER_MIN`       | 60            |
| `SHARE_MEDIA_REQUESTS_PER_IP_PER_MIN` | 600           |
| `SHARE_VIEWS_PER_DAY`                 | 1,000         |
| `OWNER_SHARED_VIEWS_PER_DAY_FREE`     | 5,000         |
| `OWNER_SHARED_VIEWS_PER_DAY_PRO`      | 25,000        |
| `FAIR_USE_OWNER_EMAILS_PER_DAY`       | 1             |
| `INACTIVE_ACCOUNT_ARCHIVE_MONTHS`     | 12            |

## Security notes

- Slug and playback token are capabilities: never logged in full (hash prefix), never sent
  as `Referer`, constant response for unknown/revoked.
- Owner routes keep the existing cookie setup; the CSRF origin check on `POST`/`PUT`/`DELETE`
  is _to verify_ (`sameSite: none` today).
- Org invitations require a verified session email matching the invitation.
- New secret `SHARE_TOKEN_HMAC_KEY` via Infisical and the `@kaipu/infra-env` schema.

## Tests (required by the implementation sub-issues)

- Domain: table-driven `canView` tests covering every row and column of the truth table.
- infra-db integration (pattern `cloud-asset.repository.integration.test.ts`): atomic mode
  switch, one-active-share uniqueness, cascade on cloud delete and account delete.
- Server: resolve deny codes; allow-list snapshot asserting no forbidden key; `429` paths;
  media `Range` / `206` / `HEAD`; token expiry and `slug_version` mismatch.
- Web: one test per watch-page state; headers present.

## Implementation sub-issues (under NIW2-213, in order)

1. DB schema + domain `canView` + repositories + tests.
2. Owner share API (create / mode / reset / revoke) + rate limits.
3. Public resolve endpoint + Worker media proxy (R2 binding, `Range`, playback tokens) +
   fair-use counters.
4. Web watch page `/v/$slug` (states, headers, OG) — after NIW2-222.
5. Web share dialog in the library — after NIW2-221.
6. Organizations (plugin, schema, minimal org UI: create, invite, accept, remove, leave;
   invitation email via `infra-email`; hooks).
7. Quota policy changes from ADR 0016 (derived files excluded, over-quota read-only, archive
   job, Terms copy — legal review).
8. Docs: fold the shipped behaviour into a `features/` reference page.

These sub-issues are not created by this pull request.

## Dependencies and risks

- **Terms copy conflict.** The published Cloud Terms (`packages/i18n/messages/*.json`,
  `legal.cloud`) still say files above the limit may be deleted after 60 days. ADR 0016
  removes that rule; the copy change belongs to sub-issue 7 and needs legal review.
- **Quota accounting change.** `cloud-limits.ts` counts a persisted thumbnail toward
  capacity and `cloud_revision.thumbnail_bytes` feeds accounting. Excluding derived files
  changes `reconcile()` and the quota SQL; it only ever grows free space.
- **Worker cost.** One invocation per range request; fair-use caps are the cost guard.
- **Better Auth pin.** The workspace pins `better-auth` 1.4.18; the organization-plugin
  options cited in ADR 0014 are _to verify_ against that version.
- **Media route shape.** Streaming with `Range` likely needs a plain Hono route in
  `src/index.ts` rather than oRPC, and an R2 binding in `wrangler.jsonc` (today R2 is reached
  through S3 credentials) — _to verify_ in sub-issue 3.
- Depends on NIW2-222 (player, fast start), NIW2-221 (library and share dialog), NIW2-219
  (Google sign-in eases the Kaipu-users mode).

## Comparable products

Loom: Public / Open to workspace / Restricted, plus password; not indexed; admins can
disable public links ([privacy settings](https://support.atlassian.com/loom/docs/use-looms-privacy-settings/)).
Google Drive: General access Restricted / organization / Anyone with the link, separate from
per-person grants, plus request access ([Drive sharing](https://support.google.com/drive/answer/2494822)).
Both keep one stable URL and evaluate access at view time — the model adopted here.
