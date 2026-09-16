---
title: "Plan 04 — Kaipu Console operations (approve, revoke, grants, overrides, config)"
description: "Implementation plan to commit the Console prototype and add operator actions: expansion review, access status, plan grants, quota overrides and runtime capacity config."
---

# Kaipu Console Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the read-only Console prototype into the operator surface: review expansion requests, set access status (revoke/ban/restore/downgrade), grant and revoke plans with expiry+reason, set per-user overrides, edit runtime capacities — and retire the `bun run plan` CLI.

**Architecture:** The Console stays a separate TanStack Start Worker (`console.kaipu.app`) that authorizes every server function via `requireConsoleAdmin()` (live Better Auth session + `CONSOLE_ADMIN_USER_IDS` allowlist) and only then lazy-imports database code. Mutations call the application-layer use cases from plans 02/03 with `@kaipu/infra-db` repositories — no new admin REST API on server-hono. The approval email goes out via `@kaipu/infra-email` directly from the Console Worker (its own `RESEND_API_KEY`).

**Tech Stack:** TanStack Start server functions, Better Auth session validation over a Cloudflare Service Binding, Drizzle, `@kaipu/application` use cases, Vitest.

**Spec:** `apps/documentation/src/content/docs/specs/2026-09-15-kaipu-console.md` and `2026-09-15-cloud-trial-and-approval.md` (Remaining administration design, Decision 4).

**Depends on:** Plans 02 and 03 merged. Plan 01 merged (EXPANSION_APPROVED template).

## Global Constraints

- Console UI is **English only**. All artifacts in English.
- Authorization is server-side on EVERY operation: `requireConsoleAdmin()` first, database imports only after it succeeds, `Cache-Control: private, no-store` on data responses. Identity is the immutable user ID from the live session — never an email, never a client-supplied field.
- Fail closed: empty allowlist denies all; backend outage is never authorization.
- Every mutation records the operator: `reviewedBy`/`updatedBy` = the session user id returned by `requireConsoleAdmin()`.
- No signup in Console; the auth proxy allowlist stays exactly `sign-in/email`, `sign-out`, `get-session`.
- Never return passwords, session tokens or provider refs to the browser.
- The `bun run plan` CLI is removed in this plan — Console replaces it (owner decision 2026-09-15: no command-line operator scripts).

## File Structure

```
apps/console/                                    # prototype, committed as-is first
apps/console/src/lib/session.server.ts           # requireConsoleAdmin returns userId
apps/console/src/lib/actions.server.ts           # NEW: db-side mutation implementations
apps/console/src/lib/email.server.ts             # NEW: notification service factory
apps/console/src/server-functions/actions.ts     # NEW: authorized server functions
apps/console/src/lib/actions.test.ts             # NEW: authorization tests for mutations
apps/console/src/routes/index.tsx                # row actions UI
apps/console/src/routes/config.tsx               # NEW: capacity config page
apps/console/.env.example                        # + RESEND_API_KEY
.github/workflows/release-console.yml            # NEW deploy workflow
apps/server-hono/scripts/plan.ts                 # DELETED
package.json                                     # "plan" script removed
```

---

### Task 1: Commit the prototype and branch

**Files:** the entire untracked `apps/console/` tree plus the modified root `package.json`/`bun.lock` entries that belong to it.

- [ ] **Step 1: Verify the prototype still passes on its own**

Run: `cd apps/console && bun run test && bun run check-types && bun run build`
Expected: 8 tests pass, typecheck and build succeed. (If plan 02 changed `deriveEntitlements` and `users.server.ts` was already updated per plan 02 Task 2 Step 5, this passes; if not, apply that call-site fix now.)

- [ ] **Step 2: Branch and commit the prototype verbatim** (do not refactor it in this commit — history should show the prototype, then the changes):

```bash
git checkout -b feat/console-operations
git add apps/console package.json bun.lock
git commit -m "feat(console): commit the Kaipu Console read-only prototype"
```

If `package.json`/`bun.lock` contain unrelated uncommitted changes, stage only the console workspace hunks (`git add -p package.json`).

---

### Task 2: `requireConsoleAdmin` returns the operator id

**Files:**

- Modify: `apps/console/src/lib/session.server.ts`
- Modify: `apps/console/src/lib/session.test.ts`

**Interfaces:**

- Produces: the authorized return becomes `{ status: "authorized"; userId: string; name: string; environment: string }`. Every mutation uses `userId` as the audit identity.

- [ ] **Step 1: Extend the existing test** asserting the authorized branch — in `session.test.ts`, the test `"allows the configured user ID"` gains:

```ts
expect(result).toMatchObject({ status: "authorized", userId: "user-1" });
```

(use the id that test already configures in its allowlist).

- [ ] **Step 2: Run to see it fail**, then **Step 3:** in `session.server.ts`'s authorized return add `userId: session.user.id,`. Run `cd apps/console && bun run test` → PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/console/src/lib
git commit -m "feat(console): expose the operator user id from authorization"
```

---

### Task 3: Mutation implementations behind authorization

**Files:**

- Create: `apps/console/src/lib/actions.server.ts`
- Create: `apps/console/src/lib/email.server.ts`
- Create: `apps/console/src/server-functions/actions.ts`
- Test: `apps/console/src/lib/actions.test.ts`
- Modify: `apps/console/.env.example` (+ `RESEND_API_KEY=`)
- Modify: `apps/console/package.json` (+ `"@kaipu/application": "workspace:*"`, `"@kaipu/infra-email": "workspace:*"`)

**Interfaces:**

- Consumes: `reviewCloudExpansion`, `setCloudAccess` (plan 03); `grantManualPlan`, `revokeManualPlan`, `setCapacityConfig`, `getCapacityConfig` (plan 02); repositories `CloudAccessStateRepository`, `ManualPlanGrantRepository`, `QuotaOverrideRepository`, `EntitlementConfigRepository` from `@kaipu/infra-db/repositories`; `EmailService`/`ResendEmailProvider`/`EMAIL_TEMPLATE_VALUES` (plan 01); `requireConsoleAdmin` (Task 2).
- Produces server functions (each validates input with zod, authorizes, then lazy-imports `actions.server.ts`):
  - `reviewExpansion({ userId, decision: "approved" | "rejected", reason: string | null })`
  - `setAccessStatus({ userId, status: "trial" | "approved" | "revoked" | "banned", reason: string })`
  - `grantPlan({ email, plan: "pro" | "unlimited", days: number | null, reason: string })`
  - `revokePlan({ email })`
  - `setOverride({ userId, quotaBytesOverride, reason, expiresAt: string | null })`
  - `clearOverride({ userId })`
  - `readCapacityConfig()` / `writeCapacityConfig({ trialCapacityBytes, betaCapacityBytes, proCapacityBytes })`
  - Every one returns `{ ok: true, ... } | { ok: false, error: string }` and 403-equivalent `{ ok: false, error: "forbidden" }` when unauthorized.

- [ ] **Step 1: Write the failing authorization tests** (`actions.test.ts`). Follow the exact mocking approach `session.test.ts` uses for `requireConsoleAdmin` dependencies. The contract to prove for EVERY action:

```ts
import { describe, expect, it, vi } from "vitest";

// Mock the session module before importing the server functions.
vi.mock("./session.server", () => ({
  requireConsoleAdmin: vi.fn(),
}));
// Mock the db-side module so an authorization failure that leaked through
// would be visible as an unexpected call.
vi.mock("./actions.server", () => ({
  performReviewExpansion: vi.fn(),
  performSetAccessStatus: vi.fn(),
  performGrantPlan: vi.fn(),
  performRevokePlan: vi.fn(),
  performSetOverride: vi.fn(),
  performClearOverride: vi.fn(),
  performReadCapacityConfig: vi.fn(),
  performWriteCapacityConfig: vi.fn(),
}));

import { requireConsoleAdmin } from "./session.server";
import * as db from "./actions.server";
import { reviewExpansionAction } from "../server-functions/actions"; // adapt to real export style

describe("console mutation authorization", () => {
  it("denies every mutation for a non-operator without touching the database", async () => {
    vi.mocked(requireConsoleAdmin).mockResolvedValue({ status: "forbidden" });
    const result = await reviewExpansionAction({ data: { userId: "u1", decision: "approved", reason: null } });
    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(db.performReviewExpansion).not.toHaveBeenCalled();
  });

  it("passes the operator id as the audit identity", async () => {
    vi.mocked(requireConsoleAdmin).mockResolvedValue({
      status: "authorized", userId: "op1", name: "Op", environment: "Test",
    });
    vi.mocked(db.performReviewExpansion).mockResolvedValue({ ok: true });
    await reviewExpansionAction({ data: { userId: "u1", decision: "approved", reason: null } });
    expect(db.performReviewExpansion).toHaveBeenCalledWith(
      expect.objectContaining({ reviewedBy: "op1" }),
    );
  });

  it("rejects invalid input before authorization side effects reach the database", async () => {
    vi.mocked(requireConsoleAdmin).mockResolvedValue({
      status: "authorized", userId: "op1", name: "Op", environment: "Test",
    });
    const result = await reviewExpansionAction({ data: { userId: "u1", decision: "maybe", reason: null } as never });
    expect(result.ok).toBe(false);
    expect(db.performReviewExpansion).not.toHaveBeenCalled();
  });
});
```

Repeat the forbidden test for each of the 8 actions in a loop over `[name, fn, sampleInput]` tuples so it stays one test body. If TanStack `createServerFn` handlers are awkward to invoke directly in tests, structure `actions.ts` as thin wrappers around exported plain functions (`export async function reviewExpansionHandler(input, deps)`) and test those — the prototype's own test files show which style it used for `listUsers`; mirror it.

- [ ] **Step 2: Run to verify failures.** `cd apps/console && bun run test` → new file FAILS (modules missing).

- [ ] **Step 3: Implement `actions.server.ts`** (database side — only ever imported after authorization):

```ts
import {
  getCapacityConfig, setCapacityConfig,
  grantManualPlan, revokeManualPlan, ManualPlanGrantError,
  reviewCloudExpansion, setCloudAccess, CloudAccessError,
} from "@kaipu/application";
import { createDatabaseClient } from "@kaipu/infra-db/client";
import {
  CloudAccessStateRepository, EntitlementConfigRepository,
  ManualPlanGrantRepository, QuotaOverrideRepository,
} from "@kaipu/infra-db/repositories";

import { consoleConfig } from "./backend.server"; // wherever the prototype defines it
import { makeConsoleNotifications } from "./email.server";

function repos() {
  const { databaseUrl } = consoleConfig();
  if (!databaseUrl) throw new Error("Console database is not configured.");
  const db = createDatabaseClient(databaseUrl);
  return {
    db,
    states: new CloudAccessStateRepository(db),
    grants: new ManualPlanGrantRepository(db),
    overrides: new QuotaOverrideRepository(db),
    config: new EntitlementConfigRepository(db),
  };
}

export async function performReviewExpansion(input: {
  userId: string;
  decision: "approved" | "rejected";
  reason: string | null;
  reviewedBy: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { db, states, config } = repos();
  try {
    await reviewCloudExpansion({
      states,
      notifications: makeConsoleNotifications(db, config),
      userId: input.userId,
      decision: input.decision,
      reviewedBy: input.reviewedBy,
      reason: input.reason,
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof CloudAccessError) return { ok: false, error: err.code };
    throw err;
  }
}

export async function performSetAccessStatus(input: {
  userId: string;
  status: "trial" | "approved" | "revoked" | "banned";
  reason: string;
  updatedBy: string;
}): Promise<{ ok: true }> {
  const { states } = repos();
  await setCloudAccess({ states, userId: input.userId, status: input.status, updatedBy: input.updatedBy, reason: input.reason });
  return { ok: true };
}

export async function performGrantPlan(input: {
  email: string;
  plan: "pro" | "unlimited";
  days: number | null;
  reason: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { grants } = repos();
  const expiresAt =
    input.plan === "unlimited" ? null : new Date(Date.now() + (input.days ?? 90) * 24 * 60 * 60 * 1000);
  try {
    await grantManualPlan({ repo: grants, email: input.email, plan: input.plan, expiresAt, reason: input.reason });
    return { ok: true };
  } catch (err) {
    if (err instanceof ManualPlanGrantError) return { ok: false, error: err.code };
    throw err;
  }
}

export async function performRevokePlan(input: { email: string }): Promise<{ ok: boolean; error?: string }> {
  const { grants } = repos();
  try {
    const removed = await revokeManualPlan({ repo: grants, email: input.email });
    return { ok: removed, error: removed ? undefined : "no-grant" };
  } catch (err) {
    if (err instanceof ManualPlanGrantError) return { ok: false, error: err.code };
    throw err;
  }
}

export async function performSetOverride(input: {
  userId: string;
  quotaBytesOverride: number;
  reason: string;
  expiresAt: Date | null;
  updatedBy: string;
}): Promise<{ ok: true }> {
  const { overrides } = repos();
  await overrides.upsert(input);
  return { ok: true };
}

export async function performClearOverride(input: { userId: string }): Promise<{ ok: true }> {
  const { overrides } = repos();
  await overrides.deleteByUserId(input.userId);
  return { ok: true };
}

export async function performReadCapacityConfig() {
  const { config } = repos();
  return { ok: true as const, config: await getCapacityConfig(config) };
}

export async function performWriteCapacityConfig(input: {
  trialCapacityBytes: number;
  betaCapacityBytes: number;
  proCapacityBytes: number;
  updatedBy: string;
}) {
  const { config } = repos();
  const saved = await setCapacityConfig({
    repo: config,
    config: {
      trialCapacityBytes: input.trialCapacityBytes,
      betaCapacityBytes: input.betaCapacityBytes,
      proCapacityBytes: input.proCapacityBytes,
    },
    updatedBy: input.updatedBy,
  });
  return { ok: true as const, config: saved };
}
```

- [ ] **Step 4: Implement `email.server.ts`**

```ts
import { eq } from "drizzle-orm";
import { formatDecimalBytes } from "@kaipu/domain/constants";
import type { ICloudNotificationService } from "@kaipu/domain/services";
import type { IEntitlementConfigRepository } from "@kaipu/domain/repositories";
import { getCapacityConfig } from "@kaipu/application";
import { EMAIL_TEMPLATE_VALUES, EmailService, ResendEmailProvider } from "@kaipu/infra-email";
import { userTable } from "@kaipu/infra-db/schemas";

const FROM = "Kaipu <no-reply-kaipu@updates.niway.dev>";
const REPLY_TO = "contacto@niway.dev";

/** Approval notification from the Console Worker. Missing key = logged no-op. */
export function makeConsoleNotifications(
  db: Parameters<typeof userTable extends never ? never : any>[0] extends never ? never : ReturnType<typeof import("@kaipu/infra-db/client").createDatabaseClient>,
  configRepo: IEntitlementConfigRepository,
): ICloudNotificationService {
  return {
    async sendExpansionApproved(userId) {
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) {
        console.error("RESEND_API_KEY is not set on the Console; approval email skipped.");
        return;
      }
      const [row] = await db.select({ email: userTable.email }).from(userTable).where(eq(userTable.id, userId)).limit(1);
      if (!row?.email) return;
      const service = new EmailService(new ResendEmailProvider(apiKey), FROM, { replyTo: REPLY_TO });
      const config = await getCapacityConfig(configRepo);
      await service.sendEmail(EMAIL_TEMPLATE_VALUES.EXPANSION_APPROVED, row.email, {
        locale: "en",
        capacityLabel: formatDecimalBytes(config.betaCapacityBytes),
        openUrl: "https://kaipu.app",
      });
    },
  };
}
```

(Type the `db` parameter with the actual client type the prototype's `users.server.ts` uses — read that file and reuse its typing rather than the placeholder above.)

- [ ] **Step 5: Implement the server functions** (`server-functions/actions.ts`) — one pattern, eight instances. Follow the exact `createServerFn` style of the prototype's `server-functions/users.ts` (validator, method):

```ts
import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";

import { requireConsoleAdmin } from "../lib/session.server";

const reviewSchema = z.object({
  userId: z.string().min(1),
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().nullable(),
});

export const reviewExpansionAction = createServerFn({ method: "POST" })
  .validator(reviewSchema)
  .handler(async ({ data }) => {
    const access = await requireConsoleAdmin();
    if (access.status !== "authorized") return { ok: false as const, error: "forbidden" };
    const { performReviewExpansion } = await import("../lib/actions.server");
    return performReviewExpansion({ ...data, reviewedBy: access.userId });
  });
```

The other seven follow identically with their schemas: `setAccessStatusAction` (`status: z.enum(["trial","approved","revoked","banned"]), reason: z.string().min(1)`), `grantPlanAction` (`email: z.string().email(), plan: z.enum(["pro","unlimited"]), days: z.number().int().positive().nullable(), reason: z.string().min(1)`), `revokePlanAction`, `setOverrideAction` (`quotaBytesOverride: z.number().int().nonnegative(), reason: z.string().min(1), expiresAt: z.string().datetime().nullable()` → convert to `Date` in the handler), `clearOverrideAction`, `readCapacityConfigAction` (GET, no input), `writeCapacityConfigAction` (three `z.number().int().positive()`).

- [ ] **Step 6: Run the tests** — `cd apps/console && bun run test` → all PASS (old 8 + new suite). **Step 7: Commit**

```bash
git add apps/console
git commit -m "feat(console): authorized mutations for review, access, grants, overrides and config"
```

---

### Task 4: UI — row actions and config page

**Files:**

- Modify: `apps/console/src/routes/index.tsx`
- Create: `apps/console/src/routes/config.tsx`
- Modify: `apps/console/src/lib/users.server.ts` (include `requestStatus`, `cloudAccessStatus`, `canReapplyAt`, override fields in the row query via `leftJoin(cloudAccessStateTable)` and `leftJoin(quotaOverrideTable)`; feed `deriveEntitlements` its real inputs)

**Interfaces:**

- Consumes: Task 3's server functions; plan 03's `cloudAccessStateTable`, plan 02's `quotaOverrideTable`.
- Produces: per-row action cluster and a `/config` page; a "Pending requests" filter.

- [ ] **Step 1: Extend the user query.** Add the two left joins and select `requestStatus`, `cloudAccessStatus`, `canReapplyAt`, `quotaBytesOverride`, `overrideExpiresAt`. Change the `deriveEntitlements` call to pass `{ emailVerified: user.emailVerified, accessStatus: row.cloudAccessStatus ?? "trial", config: await getCapacityConfig(configRepo), override: mappedOverrideOrNull }` (fetch the config once per request, not per row). Also add a `filter=pending` search param handled server-side (`where(eq(cloudAccessStateTable.requestStatus, "pending"))`).

- [ ] **Step 2: Row actions.** In `index.tsx`, add an actions cell per row rendering by state:
  - `requestStatus === "pending"` → **Approve** and **Reject** buttons (Reject opens an inline `<input>` for the reason). On click call `reviewExpansionAction`/refresh.
  - `cloudAccessStatus` select (`trial/approved/revoked/banned`) + reason input → `setAccessStatusAction`. Destructive statuses (`revoked`, `banned`) require a non-empty reason and a `window.confirm` naming the account email.
  - **Grant plan** inline form (plan select, days number defaulting 90 — disabled for `unlimited` —, reason input) → `grantPlanAction`; **Revoke plan** button → `revokePlanAction` with `window.confirm`.
  - **Override** inline form (bytes, reason, optional expiry `datetime-local`) → `setOverrideAction`; **Clear** → `clearOverrideAction`.
    Show each action's `{ ok: false, error }` inline next to the control (plain `<span role="alert">`). Add a "Pending requests" toggle above the table that sets `filter=pending`.
- [ ] **Step 3: Config page** (`/config`): load via `readCapacityConfigAction`, render three labeled number inputs (bytes) with their human labels computed by `formatDecimalBytes`, save via `writeCapacityConfigAction`, show the saved values and a warning line: "Changes apply to every account on the next entitlement read. Reductions below current usage block new uploads (Terms: notice + 60 days before any deletion)." Link it from the index header. English only.

- [ ] **Step 4: Manual verification.** Run API + Console locally (`bun run dev:server-hono` / `bun run dev:console` — check root scripts for exact names; `.env` per the Console spec), sign in as the operator and exercise: approve a pending request (seeded via the desktop flow or a direct DB row), grant pro 30 days, set an override, edit config, revoke access with a reason. Confirm a non-operator session sees no actions succeed.

- [ ] **Step 5: Typecheck/build/tests, commit**

```bash
cd apps/console && bun run check-types && bun run test && bun run build
git add apps/console
git commit -m "feat(console): operator UI for requests, access, grants, overrides and capacities"
```

---

### Task 5: Retire the CLI

**Files:**

- Delete: `apps/server-hono/scripts/plan.ts`
- Modify: root `package.json` (remove the `"plan"` script)

- [ ] **Step 1: Delete and clean**

```bash
git rm apps/server-hono/scripts/plan.ts
```

Remove the `"plan"` line from root `package.json`. `grep -rn "bun run plan" apps packages README.md` and update any doc that mentions it to point at Kaipu Console (expected: `backlog/cloud-error-states.md` gap 2 historical note and possibly the cloud product spec).

- [ ] **Step 2: Root checks** — `bun run check-types && bun run test` → PASS. **Step 3: Commit**

```bash
git add -A
git commit -m "chore(cli): retire the plan operator script in favor of Kaipu Console"
```

---

### Task 6: Deployment workflow and rollout

**Files:**

- Create: `.github/workflows/release-console.yml`
- Modify: `apps/console/.env.example`, `apps/documentation/src/content/docs/specs/2026-09-15-kaipu-console.md`

- [ ] **Step 1: Workflow.** Model it 1:1 on `.github/workflows/release-api.yml` (read it first; reuse its trigger style, bun setup, and wrangler-action version). Shape:

```yaml
name: Release Console

on:
  workflow_dispatch:

concurrency:
  group: release-console
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run --filter console build
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: apps/console
          command: deploy
          secrets: |
            DATABASE_URL
            CONSOLE_ADMIN_USER_IDS
            CONSOLE_API_URL
            RESEND_API_KEY
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          CONSOLE_ADMIN_USER_IDS: ${{ secrets.CONSOLE_ADMIN_USER_IDS }}
          CONSOLE_API_URL: ${{ vars.CONSOLE_API_URL }}
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
```

Adjust step versions/commands to exactly match `release-api.yml`'s working pattern (that file is the proven reference — copy its skeleton, change the workspace and secret list).

- [ ] **Step 2: Document rollout** in the Console spec's deployment section:

```md
Rollout checklist: (1) add `CONSOLE_ADMIN_USER_IDS` (the owner's Better Auth
user id), `CONSOLE_API_URL` (`https://kaipu-api.cristiansotomayor-dev.workers.dev`)
and reuse `DATABASE_URL`/`RESEND_API_KEY` in the GitHub production environment;
(2) append `https://console.kaipu.app` to the API's `CORS_ORIGIN` variable and
redeploy the API so Better Auth trusts the Console origin; (3) run the Release
Console workflow; (4) verify: anonymous → sign-in page; non-operator account →
forbidden; operator → directory with actions.
```

- [ ] **Step 3: Commit and open the PR**

```bash
git add .github/workflows/release-console.yml apps/console apps/documentation
git commit -m "ci(console): deploy workflow and rollout checklist"
```

PR title: `feat(console): operator actions, capacity config and deployment`.
