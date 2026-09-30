---
title: AI Briefing
description: Everything a model needs to answer questions or write code about Kaipu Record, self-contained.
---

# Kaipu Record — AI Briefing

> Paste this whole document into a model with no access to this repository. It
> should be able to answer questions about Kaipu Record and generate correct code
> against its interfaces from this file alone — no "see the docs" needed.
> Current as of 2026-09-02.

## What it is

**Brand update (2026-09-27):** consult [Brand identity](/marketing/brand-identity/) before naming, logo, mascot, onboarding, or marketing work. It preserves the creator's adopted name construction and distinguishes it from a literal translation. The [rollout plan](/plans/2026-09-27-brand-and-website-rollout/) records implementation status. This note does not revalidate the older technical snapshot below.

Kaipu Record is a local-first macOS desktop app (Electron) for screen and camera
recording, screenshot capture/annotation, and lightweight video editing, backed by a
Cloudflare Workers web app and API for the marketing site, authentication, and an
emerging cloud-storage capability. The whole thing lives in one Bun/Turborepo
monorepo (`kaipu-record-monorepo`) using DDD + hexagonal layering:
`packages/domain` (pure schemas/types/interfaces) ← `packages/application`
(use cases) ← `packages/infra-*` (Drizzle, Better Auth, R2) ← the four `apps/*`
that wire it together.

1. **The recording is the product, not the upload.** A file is complete and playable
   the instant it's written to disk; cloud sync is an optional layer on top, never a
   precondition.
2. **No account required to record.** The desktop app works fully offline; an
   account only exists for the emerging cloud-recordings capability (see Status).
3. **A real MP4 pipeline, not a patched one.** Capture goes through WebCodecs
   (via the `mediabunny` library) instead of `MediaRecorder` + FFmpeg — see
   [ADR 0001](../architecture/decisions/0001-mediabunny-over-ffmpeg).
4. **Contract-first API.** The Hono/oRPC backend and the TanStack Start web app
   share one Zod-schema-defined contract — no generated client, no drift.

## Status that changes how you should answer

- **Desktop app**: latest tag `desktop-v0.4.0` on GitHub Releases (pre-release
  channel), distributed via `kaipu.app` + GitHub Releases — **not** published to
  npm. Web app is at `web-v0.4.0`, the API at `api-v0.1.2` (all released
  independently via `release-please`, each app versioned on its own).
- **Cloud recordings (accounts + R2 upload) is built but not shipped.** The full
  backend vertical (domain → application → infra-storage → API) exists and is
  unit-tested, but it is on an **open, unmerged PR** as of this writing, and the
  private R2 bucket / API token / Worker secrets it needs have not been
  provisioned yet. The **desktop upload UI doesn't exist yet** — the backend has
  no caller. Do not assume a user can currently upload a recording to the cloud.
- **The landing page still says "No account."** That copy (`packages/i18n/messages/
en.json`, key `featureNoAccountTitle`) is accurate today and will go stale the
  moment cloud recordings ships — don't treat it as a permanent product fact.
- **Windows is not shipped.** The landing page says "coming soon"; there is no
  Windows build today.
- **The design-tokens light theme shipped in code** (`@kaipu/tokens`) but has not
  yet had a production review pass — treat it as functional, not yet fully vetted.
- **Some root-level files are stale template leftovers**, not descriptions of the
  product — see Corrections below.

## The interfaces

**Monorepo import rule** (enforced, not just convention): `domain` never imports
`application` or `infra-*`; `application` never imports `infra-*`; `infra-*` never
imports `application`. Only `apps/*` wire concrete implementations to use cases.

**Domain schema** (`packages/domain/src/schemas/recording.ts`) — Zod is the source
of truth, reused by both server and any client:

```typescript
export const recordingBaseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  kind: z.enum(["recording", "screenshot"]),
  title: z.string().min(1).max(500),
  storageKey: z.string().min(1), // e.g. "videos/<userId>/<id>.mp4"
  contentType: z.string().min(1).max(255),
  sizeBytes: z.number().int().nonnegative(),
  durationSeconds: z.number().int().nonnegative(),
  status: z.enum(["pending", "ready"]), // pending until the upload is confirmed
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB, one presigned PUT
```

**oRPC contract** (`apps/server-hono/src/contract/recording.contract.ts`) — routes,
input/output schemas, and REST paths defined once, imported by the web app for full
type safety with no code generation:

```typescript
export const recordingContract = {
  list: oc.route({ method: "GET", path: "/recordings" })
    .output(apiResponseSchema(z.array(recordingBaseSchema))),
  createUpload: oc.route({ method: "POST", path: "/recordings", successStatus: 201 })
    .input(createRecordingUploadSchema)
    .output(apiResponseSchema(z.object({ recording: recordingBaseSchema, uploadUrl: z.string() }))),
  confirm: oc.route({ method: "POST", path: "/recordings/{id}/confirm" })
    .input(z.object({ id: z.string() }))
    .output(apiResponseSchema(recordingBaseSchema)),
};
```

Every route responds with the same envelope: `{ data, error }` (`shared.contract.ts`,
`apiResponseSchema`), plus an optional `meta.pagination` for list routes. Uploads are
a presigned **PUT straight to R2** — bytes never pass through the Worker — followed
by a `confirm` call that flips `status` to `ready`.

**Desktop IPC** — the Electron renderer never touches `electron` or `node:*`
directly; everything goes through `window.electronAPI`, exposed by the preload via
`contextBridge`, backed by ~49 named channels in `src/shared/types/ipc.ts` (the
compiler-checked source of truth, not this document):

```typescript
// renderer
await window.electronAPI.getAppVersion();
// preload bridges to → ipcRenderer.invoke("app:get-version")
// main → registered in src/main/index.ts
```

**i18n** — copy is never hardcoded; every user-facing string is a key in
`packages/i18n/messages/{en,es}.json`, read via `useTranslations(namespace)` from
`@kaipu/i18n` (built on `use-intl`) in both the web app and the desktop renderer.

## Corrections

- The **actual apps** are `apps/kaipu-record` (Electron desktop), `apps/web-hono`
  (TanStack Start web + landing), `apps/server-hono` (Hono/oRPC API), and
  `apps/documentation` (Astro Starlight) — **not** `apps/web` / `apps/server` /
  `apps/mobile`. The root `README.md`, `package.json` description, and
  `apps/documentation`'s own landing page describe an earlier generic
  "monorepo template with a Todo CRUD example" — that's leftover scaffold copy
  from before this repo was customized into Kaipu Record, not a description of
  what's actually in `apps/`.
- The docs site runs on **Astro Starlight**, not Fumadocs/Next.js — the root
  `README.md`'s tech-stack table is wrong on this one point.
- The recording pipeline captures through **WebCodecs via `mediabunny`**, not
  `MediaRecorder` + FFmpeg — FFmpeg was the legacy approach and is kept only as an
  optional, lazy, on-demand offline tool, never embedded in the live capture path.
- The GitHub repo is **`csdev19/kaipu-record-monorepo`** (a personal-account repo,
  `github-personal` SSH alias) — the `Niway` author field in `apps/kaipu-record/
package.json` is a business name, not a separate GitHub org this code lives in.
- Cloud is a **capability**, not the product's category — don't describe or pitch
  Kaipu Record as "cloud-first" or "a Loom competitor" in the collaboration-platform
  sense; the desktop app is the product, and sync/sharing is what you turn on.
