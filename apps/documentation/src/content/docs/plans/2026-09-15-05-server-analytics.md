---
title: "Plan 05 — Server analytics (PostHog EU) and the /ingest proxy"
description: "Implementation plan for server-side business events on the API worker and the first-party ingestion proxy on kaipu.app."
---

# Server Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reliable server-side funnel events (signup → verified → expansion → upload) captured from `kaipu-api` into PostHog EU, plus a `/ingest` proxy on `kaipu.app` so browser/desktop clients (plan 06) reach PostHog without ad-blocker loss.

**Architecture:** No SDK on the Worker — a tiny `captureServerEvent` helper POSTs single events to PostHog's HTTP endpoint (`/i/v0/e/`), deferred with `executionCtx.waitUntil` where a context is available and awaited otherwise. Events are wired at the same composition points the features already own: Better Auth `databaseHooks`/`onEmailVerification`, the cloud router handlers, and a Hono `onError`. The web worker adds a transparent `/ingest/$` proxy to `https://eu.i.posthog.com` that strips cookies.

**Tech Stack:** Cloudflare Workers fetch, Hono, Better Auth 1.4 hooks, TanStack Start server routes, Vitest.

**Spec:** `apps/documentation/src/content/docs/specs/2026-09-15-cloud-trial-and-approval.md` — "Decision 6 — local-first diagnostics" (Service telemetry paragraph and the PostHog EU / `/ingest` paragraph).

**Depends on:** Plan 03 merged (the expansion endpoints exist to instrument). Independent of plans 01/02/04/06 otherwise.

## Global Constraints

- Region: **PostHog EU** (`https://eu.i.posthog.com`). Never the US host.
- Server events are operational records: always on, NOT gated by any desktop telemetry switch.
- Forbidden in any event property: file names, titles, local paths, content, passwords, tokens, authorization headers, cookies. Allowed: user id, event name, coarse context (plan name, byte counts, HTTP status, client version string).
- The API must boot and serve normally with `POSTHOG_API_KEY` unset: capture becomes a no-op (no log spam per request — one boot-time notice at most).
- Analytics must never break a request: every capture path is fire-and-forget with its own `catch`.
- English artifacts; Vitest with fakes; oxlint/oxfmt from root.

## File Structure

```
packages/infra-env/src/server.ts                 # + POSTHOG_API_KEY, POSTHOG_HOST
apps/server-hono/src/lib/analytics.ts            # NEW: captureServerEvent
apps/server-hono/src/lib/analytics.test.ts       # NEW
apps/server-hono/src/lib/auth.ts                 # databaseHooks + onEmailVerification
apps/server-hono/src/index.ts                    # executionCtx into oRPC context + onError
apps/server-hono/src/modules/cloud/cloud.router.ts   # upload/download events
apps/server-hono/src/modules/me/me.router.ts         # expansion request event
apps/web-hono/src/routes/ingest/$.ts             # NEW: proxy
apps/web-hono/public/robots.txt                  # Disallow /ingest
```

---

### Task 1: Env and the capture helper

**Files:**

- Modify: `packages/infra-env/src/server.ts`
- Create: `apps/server-hono/src/lib/analytics.ts`
- Test: `apps/server-hono/src/lib/analytics.test.ts`

**Interfaces:**

- Produces:
  - env: `POSTHOG_API_KEY?: string`, `POSTHOG_HOST?: string`
  - `type ServerEvent = "user_signed_up" | "user_signed_in" | "email_verified" | "cloud_expansion_requested" | "cloud_expansion_reviewed" | "upload_completed" | "download_url_issued" | "api_error"`
  - `captureServerEvent(event: ServerEvent, distinctId: string, properties?: Record<string, string | number | boolean | null>, waitUntil?: (p: Promise<unknown>) => void): void`
  - Internal, exported for tests: `buildCaptureRequest(host, apiKey, event, distinctId, properties): { url: string; init: RequestInit }`

- [ ] **Step 1: Env.** Add to `serverEnvSchema` after the email block:

```ts
  // Server-side analytics (PostHog EU). Optional: unset disables capture.
  POSTHOG_API_KEY: z.string().optional(),
  /** Defaults to the EU ingestion host. */
  POSTHOG_HOST: z.string().optional(),
```

- [ ] **Step 2: Failing test** (`analytics.test.ts`)

```ts
import { describe, expect, it } from "vitest";

import { buildCaptureRequest } from "./analytics";

describe("buildCaptureRequest", () => {
  it("targets the EU single-event endpoint with the api key in the body", () => {
    const { url, init } = buildCaptureRequest(
      "https://eu.i.posthog.com",
      "phc_test",
      "user_signed_up",
      "u1",
      { plan: "free" },
    );
    expect(url).toBe("https://eu.i.posthog.com/i/v0/e/");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      api_key: "phc_test",
      event: "user_signed_up",
      distinct_id: "u1",
      properties: { plan: "free", source: "kaipu-api" },
    });
    expect(typeof body.timestamp).toBe("string");
  });

  it("tolerates a trailing slash on the host", () => {
    const { url } = buildCaptureRequest("https://eu.i.posthog.com/", "k", "api_error", "anon", {});
    expect(url).toBe("https://eu.i.posthog.com/i/v0/e/");
  });
});
```

- [ ] **Step 3: Run to verify it fails**, then **Step 4: implement `analytics.ts`**

```ts
/**
 * Server-side business events → PostHog EU. Always-on operational telemetry
 * (spec Decision 6): no file names, titles, paths, content or credentials.
 * Fire-and-forget: analytics must never break a request.
 */
import { env } from "../env";

export type ServerEvent =
  | "user_signed_up"
  | "user_signed_in"
  | "email_verified"
  | "cloud_expansion_requested"
  | "cloud_expansion_reviewed"
  | "upload_completed"
  | "download_url_issued"
  | "api_error";

const DEFAULT_HOST = "https://eu.i.posthog.com";

export function buildCaptureRequest(
  host: string,
  apiKey: string,
  event: ServerEvent,
  distinctId: string,
  properties: Record<string, string | number | boolean | null>,
): { url: string; init: RequestInit } {
  return {
    url: `${host.replace(/\/$/, "")}/i/v0/e/`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        event,
        distinct_id: distinctId,
        timestamp: new Date().toISOString(),
        properties: { ...properties, source: "kaipu-api" },
      }),
    },
  };
}

export function captureServerEvent(
  event: ServerEvent,
  distinctId: string,
  properties: Record<string, string | number | boolean | null> = {},
  waitUntil?: (p: Promise<unknown>) => void,
): void {
  if (!env.POSTHOG_API_KEY) return;
  const { url, init } = buildCaptureRequest(env.POSTHOG_HOST ?? DEFAULT_HOST, env.POSTHOG_API_KEY, event, distinctId, properties);
  const send = fetch(url, init).catch((err) => {
    console.error("analytics capture failed", event, err);
  });
  if (waitUntil) waitUntil(send);
  // Without a waitUntil the promise floats; on Workers this only matters for
  // hooks that already run inside an awaited request (Better Auth), where the
  // response is not sent until the hook returns.
}
```

Test note: `env` is parsed at module import; if importing `../env` explodes under vitest (no `cloudflare:workers`), keep `buildCaptureRequest` pure (no env import) and have only `captureServerEvent` touch `env` — the test imports only the pure builder. If even that fails, split the builder into its own file `analytics-request.ts` and test that.

- [ ] **Step 5: Run tests to verify they pass** — `cd apps/server-hono && bun run test -- analytics` → PASS.

- [ ] **Step 6: Pass the secret on deploy.** Add `POSTHOG_API_KEY` to the wrangler-action `secrets:` list in `.github/workflows/release-api.yml`, same style as the existing entries.

- [ ] **Step 7: Commit**

```bash
git add packages/infra-env apps/server-hono .github/workflows/release-api.yml
git commit -m "feat(analytics): server-side PostHog EU capture helper"
```

---

### Task 2: Wire the events

**Files:**

- Modify: `apps/server-hono/src/lib/auth.ts`
- Modify: `apps/server-hono/src/index.ts`
- Modify: `apps/server-hono/src/middleware/auth.ts` (context type) — only if executionCtx is threaded, see Step 2
- Modify: `apps/server-hono/src/modules/cloud/cloud.router.ts`
- Modify: `apps/server-hono/src/modules/me/me.router.ts`

**Interfaces:**

- Consumes: `captureServerEvent` (Task 1).
- Produces: the eight events with these exact properties:
  - `user_signed_up` — `{}` (distinctId = user id)
  - `user_signed_in` — `{}` (distinctId = session.userId)
  - `email_verified` — `{}`
  - `cloud_expansion_requested` — `{}`
  - `cloud_expansion_reviewed` — emitted by Console operations later; SKIP here (Console is a separate worker; note it in the doc task)
  - `upload_completed` — `{ kind, sizeBytes }` (asset kind and confirmed size — no title, no key)
  - `download_url_issued` — `{ kind }`
  - `api_error` — `{ status, path }` (Hono onError; path only, never query strings)

- [ ] **Step 1: Better Auth hooks.** In `lib/auth.ts` add to the `betterAuth({...})` options (alongside plan 01's blocks):

```ts
databaseHooks: {
  user: {
    create: {
      after: async (user) => {
        captureServerEvent("user_signed_up", user.id);
      },
    },
  },
  session: {
    create: {
      after: async (session) => {
        captureServerEvent("user_signed_in", session.userId);
      },
    },
  },
},
```

and inside the `emailVerification` block:

```ts
onEmailVerification: async (user) => {
  captureServerEvent("email_verified", user.id);
},
```

(If plan 01 is not yet merged when this executes, create the `emailVerification` block with only `onEmailVerification` — the blocks merge trivially at rebase.)

- [ ] **Step 2: Thread `waitUntil` into oRPC handlers.** In `src/index.ts`, where the OpenAPIHandler is dispatched with `context: { headers: c.req.raw.headers }`, extend to:

```ts
context: {
  headers: c.req.raw.headers,
  waitUntil: (p: Promise<unknown>) => c.executionCtx.waitUntil(p),
},
```

and widen the oRPC base context type accordingly (the `os.$context<{ headers: Headers }>()` in `middleware/auth.ts` becomes `{ headers: Headers; waitUntil?: (p: Promise<unknown>) => void }`). Compile errors will point at every context literal to update.

- [ ] **Step 3: Router events.**
  - `cloud.router.ts` `confirmUpload` handler: after a successful confirm returning a summary, add `captureServerEvent("upload_completed", context.user.id, { kind: summary.kind, sizeBytes: summary.sizeBytes }, context.waitUntil);` — read the actual summary field names from `cloudAssetSummarySchema` in `packages/domain/src/schemas/cloud-asset.ts` and use those (`kind` exists; size may be `sizeBytes` on the summary or on the revision — if the summary lacks a size field, send only `{ kind }`).
  - `downloadUrl` handler: `captureServerEvent("download_url_issued", context.user.id, { kind: asset.kind }, context.waitUntil);` (or `{}` if kind is not in scope without an extra query).
  - `me.router.ts` `requestCloudAccess` handler (plan 03): after a successful request, `captureServerEvent("cloud_expansion_requested", context.user.id, {}, context.waitUntil);`
- [ ] **Step 4: Global error event.** In `src/index.ts` add before the export:

```ts
app.onError((err, c) => {
  captureServerEvent("api_error", "server", {
    status: 500,
    path: new URL(c.req.url).pathname,
  }, (p) => c.executionCtx.waitUntil(p));
  console.error("unhandled error", err);
  return c.json({ data: null, error: { message: "Internal error" } }, 500);
});
```

If the app already has an `onError` or the oRPC handler swallows errors before Hono sees them, attach to whichever error boundary actually fires (verify by throwing a test error in dev); do not double-report.

- [ ] **Step 5: Checks.** `cd apps/server-hono && bun run check-types && bun run test && bun run build` → all pass. Manual: run dev, sign up a user, confirm `POSTHOG_API_KEY` unset produces no fetches and no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/server-hono
git commit -m "feat(analytics): capture signup, sign-in, verification, expansion and upload events"
```

---

### Task 3: The `/ingest` proxy on kaipu.app

**Files:**

- Create: `apps/web-hono/src/routes/ingest/$.ts`
- Modify: `apps/web-hono/public/robots.txt`

**Interfaces:**

- Produces: `https://kaipu.app/ingest/*` → `https://eu.i.posthog.com/*` (path suffix preserved, query preserved, cookies stripped). Plan 06 points posthog-js/posthog-node at `https://kaipu.app/ingest`.

- [ ] **Step 1: Proxy route.** Follow the server-route shape of `routes/api/v1/$.ts` but with a hand-rolled forwarder (the PostHog host is external — the Service Binding proxy helper does not apply):

```ts
import { createFileRoute } from "@tanstack/react-router";

const POSTHOG_HOST = "https://eu.i.posthog.com";

/** First-party analytics ingestion: forwards /ingest/* to PostHog EU.
 * Cookies never leave our origin; PostHog auth travels in the body/api_key. */
async function forward(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const target = `${POSTHOG_HOST}${url.pathname.replace(/^\/ingest/, "") || "/"}${url.search}`;
  const headers = new Headers(request.headers);
  headers.delete("cookie");
  headers.delete("host");
  const response = await fetch(target, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
  });
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

export const Route = createFileRoute("/ingest/$")({
  server: {
    handlers: {
      GET: async ({ request }) => forward(request),
      POST: async ({ request }) => forward(request),
      OPTIONS: async ({ request }) => forward(request),
    },
  },
});
```

If streaming the request `body` needs `duplex: "half"` on workerd, add it to the fetch init. posthog-js also loads `/ingest/static/*` scripts — GET is covered by the catch-all.

- [ ] **Step 2: robots.txt.** Add `Disallow: /ingest` under the existing `User-agent: *` block in `apps/web-hono/public/robots.txt`.

- [ ] **Step 3: Smoke test.** `cd apps/web-hono && bun run wrangler:dev`, then:

```bash
curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001/ingest/decide/?v=3" -X POST -H 'Content-Type: application/json' -d '{"api_key":"test"}'
```

Expected: an HTTP status from PostHog (401 for the fake key is fine — it proves the forward round-trips), not a 404 from the router.

- [ ] **Step 4: Build and commit**

```bash
cd apps/web-hono && bun run build
git add apps/web-hono
git commit -m "feat(web): first-party /ingest proxy to PostHog EU"
```

---

### Task 4: Docs

**Files:**

- Modify: `apps/documentation/src/content/docs/specs/2026-09-15-cloud-trial-and-approval.md` (Decision 6: server events + proxy implemented; note `cloud_expansion_reviewed` is emitted by Console when plan 04's review action lands — add `captureServerEvent`-equivalent there or accept the gap)
- Modify: `apps/documentation/src/content/docs/backlog/index.mdx` + new backlog doc `backlog/analytics.md` if the backlog convention requires a row (status 🟡, listing implemented events, the proxy, and the pending Console event; add the manual sidebar entry in `apps/documentation/astro.config.mjs` per the docs rules)

- [ ] **Step 1: Write the docs** listing the event catalog verbatim (names + properties from Task 2) — this doubles as the privacy-policy source of truth for plan 06.

- [ ] **Step 2: Commit and open the PR**

```bash
git add apps/documentation
git commit -m "docs(analytics): server event catalog and ingestion proxy"
```

PR title: `feat(analytics): server-side PostHog EU events and /ingest proxy`. PR body must note: requires the `POSTHOG_API_KEY` production secret (EU project) before events flow; zero user-facing changes.
