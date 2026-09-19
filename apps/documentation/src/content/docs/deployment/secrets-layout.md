---
title: "Secrets layout — folders and tags"
description: "How secrets are organised in Infisical: folders by blast radius, tags by consumer, and the complete variable-to-location map."
---

# Secrets layout — folders and tags

**Status: 🟢 Applied for `dev`.** The six folders exist, root is empty, tags are
assigned, and the scripts filter by tag. Verified end to end: `server-hono`
resolves its nine values and `GET /api/auth/get-session` returns 200, while
`web-hono` and `kaipu-record` receive zero credentials.

`prod` is untouched — the release workflows still read GitHub Secrets.

Infisical organises secrets along two independent axes. They answer different
questions, and using only one forces a compromise that neither needs to make.

| Axis              | Question it answers              | Shape               |
| ----------------- | -------------------------------- | ------------------- |
| **Folder** (path) | What does it cost if this leaks? | One home per secret |
| **Tag**           | Who uses this?                   | Many-to-many        |

A secret in `/database` tagged `server-hono` + `console` + `db-scripts` tells you
both: how much damage a leak does, and who breaks if you rotate it.

Both are enforceable. Infisical permission conditions accept `environment`,
`secretPath`, `secretName` **and** `secretTags`, so either axis can back a real
access boundary rather than a client-side convention.

## Folders: one per distinct consequence

Name folders by blast radius, because that is the only question tags cannot
answer. The test for a new folder is whether a leak there has a _different_
consequence from every existing one — not whether it belongs to a different app.

These strings are the folder descriptions set in Infisical, so the consequence
is visible at the moment someone is about to touch one. Each names what an
attacker gains and where the value is rotated.

| Folder        | Description (as set in Infisical)                                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `/public`     | Not a credential. Reading these grants nothing — most already ship to users or are committed in the repo.                                |
| `/database`   | Full read and write access to every user's data. Rotate in Neon.                                                                         |
| `/cloudflare` | Read and write every stored recording, and deploy or destroy Workers. Rotate in the Cloudflare dashboard.                                |
| `/auth`       | Forge session tokens and impersonate any user. Rotating it signs everyone out.                                                           |
| `/email`      | Send mail as Kaipu and spend against the account. Rotate in the Resend dashboard.                                                        |
| `/signing`    | Sign and notarize software as the registered Apple developer. A leak means malware signed with your identity. Rotate in Apple Developer. |

## Tags: one per consumer

| Tag            | Consumer                                     |
| -------------- | -------------------------------------------- |
| `server-hono`  | The API Worker                               |
| `web-hono`     | The web Worker                               |
| `kaipu-record` | The Electron desktop app                     |
| `console`      | The admin console                            |
| `db-scripts`   | Repo-root `db:*`, `plan`, `test:integration` |
| `ci-deploy`    | Release workflows                            |

Consumers are apps and script groups — not packages. `@kaipu/infra-env` declares
variables and `@kaipu/infra-db` reads one, but neither is a consumer: they are
libraries used _by_ the apps that are.

## Complete map — `dev`

| Secret                     | Folder        | Tags                                 |
| -------------------------- | ------------- | ------------------------------------ |
| `CORS_ORIGIN`              | `/public`     | `server-hono`                        |
| `PUBLIC_WEB_URL`           | `/public`     | `server-hono`                        |
| `R2_BUCKET`                | `/public`     | `server-hono`                        |
| `R2_ACCOUNT_ID`            | `/public`     | `server-hono`                        |
| `VITE_SERVER_URL`          | `/public`     | `web-hono`                           |
| `VITE_PUBLIC_DOWNLOAD_URL` | `/public`     | `web-hono`                           |
| `MAIN_VITE_SERVER_URL`     | `/public`     | `kaipu-record`                       |
| `MAIN_VITE_POSTHOG_HOST`   | `/public`     | `kaipu-record`                       |
| `MAIN_VITE_POSTHOG_KEY`    | `/public`     | `kaipu-record`                       |
| `VITE_POSTHOG_HOST`        | `/public`     | `kaipu-record`                       |
| `VITE_POSTHOG_KEY`         | `/public`     | `kaipu-record`                       |
| `VITE_POSTHOG_PRODUCT`     | `/public`     | `kaipu-record`                       |
| `VITE_POSTHOG_SURFACE`     | `/public`     | `kaipu-record`                       |
| `VITE_VERSION_GATE_URL`    | `/public`     | `kaipu-record`                       |
| `CONSOLE_API_URL`          | `/public`     | `console`                            |
| `CONSOLE_ENVIRONMENT`      | `/public`     | `console`                            |
| `CONSOLE_ADMIN_USER_IDS`   | `/public`     | `console`                            |
| `DATABASE_URL`             | `/database`   | `server-hono` `console` `db-scripts` |
| `R2_ACCESS_KEY_ID`         | `/cloudflare` | `server-hono`                        |
| `R2_SECRET_ACCESS_KEY`     | `/cloudflare` | `server-hono`                        |
| `BETTER_AUTH_SECRET`       | `/auth`       | `server-hono`                        |
| `RESEND_API_KEY`           | `/email`      | `server-hono`                        |

## Complete map — `prod`

Everything above, plus:

| Secret                 | Folder        | Tags           |
| ---------------------- | ------------- | -------------- |
| `CSC_LINK`             | `/signing`    | `kaipu-record` |
| `CSC_KEY_PASSWORD`     | `/signing`    | `kaipu-record` |
| `APPLE_API_KEY`        | `/signing`    | `kaipu-record` |
| `APPLE_API_KEY_ID`     | `/signing`    | `kaipu-record` |
| `APPLE_API_ISSUER`     | `/signing`    | `kaipu-record` |
| `CLOUDFLARE_API_TOKEN` | `/cloudflare` | `ci-deploy`    |

`/signing` also carries a `dev` copy of the five signing secrets, so
`bun run build:mac` works on a laptop without granting it `prod` access.

`RELEASE_PLEASE_TOKEN` stays in GitHub Secrets deliberately: it authenticates to
GitHub, from GitHub, so routing it through an external service adds a bootstrap
dependency and no protection.

## Decisions worth knowing

**`R2_BUCKET` and `R2_ACCOUNT_ID` live in `/public`.** Neither is a credential —
a bucket name and an account identifier, both already committed in plaintext in
release workflows. They were previously kept beside the R2 keys to avoid
splitting a credential set across two homes; tags remove that reason, because
the tag keeps the group legible even when folders separate it. What remains in
`/cloudflare` is only what actually opens something.

**`CONSOLE_ADMIN_USER_IDS` sits in `/public`, not `/auth`.** It is the console's
authorisation allow-list, which makes `/auth` tempting — but that folder means
"forge sessions and impersonate any user", and a list of user ids does none of
that. Reading it reveals which accounts are admins; it grants nothing, because
you would still have to authenticate as one of them. It is the least public
thing in `/public`, which is why that folder's description says "reading these
grants nothing" rather than "these are already published".

Note the asymmetry the blast-radius test does not capture: _writing_ this value
would grant admin to anyone you add. Write access is governed by the identity's
permissions, not by the folder, so the folder still answers the question it is
meant to.

**`/auth` and `/email` hold one secret each.** That looks over-filed, but they
are different systems with different rotation procedures: `BETTER_AUTH_SECRET`
you generate yourself, the Resend key you rotate in their dashboard. Same
argument as `/database` holding one.

**Root is left empty.** `infisical export` defaults to `/`, so a fetch that
forgets `--path` now returns nothing instead of silently handing over config.
The default becomes safe rather than convenient.

## How scripts consume it

Filter by **tag**, not by path — an app's secrets deliberately span folders:

```bash
infisical run --env=dev --recursive --tags kaipu-record -- electron-vite dev
```

`scripts/with-env.sh` wraps this. It requires an explicit filter: there is no
"fetch everything" mode, because a desktop build has no business holding a
database credential.

**One asymmetry to remember:** `infisical run` supports `--recursive`, so a tag
filter reaches every folder. **`infisical export` does not** — it reads one
`--path` at a time. Anything that needs a generated file (a Cloudflare Worker,
because `wrangler` populates bindings from a file rather than the parent
process) must list its paths explicitly and concatenate.

## Operational notes

- **Move secrets before tagging.** Moving between folders can reset tags.
- **Mirror the structure across environments.** The script names a folder or tag
  once and lets `--env` choose; that only works if `dev` and `prod` agree.
- **An untagged secret is invisible.** It silently drops out of every filtered
  fetch — the same mute-failure class as a mistyped Vite prefix. A path at least
  has a default; a missing tag has nothing. Worth a guard that lists untagged
  secrets and fails.
