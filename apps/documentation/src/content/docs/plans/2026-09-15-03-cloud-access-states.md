---
title: "Plan 03 — Cloud access states and the expansion request flow"
description: "Implementation plan for requestStatus/cloudAccessStatus persistence, the 30-day reapply cooldown, API gating, the approval email and the desktop request UI."
---

# Cloud Access States Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the request lifecycle (`none → pending → approved | rejected`, 30-day reapply cooldown) and the effective access state (`trial | approved | revoked | banned`), gate the API with them, send the approval email, and let the desktop request the 1 GB expansion.

**Architecture:** A new `kaipu_record_cloud_access_state` row per user (missing row = `none`/`trial`); a one-time backfill grandfathers every already-verified account to `approved` so nobody's capacity drops. Application use cases own the transitions; the repository is a dumb `get`/`upsert`. `getEntitlements` stops taking the `accessStatus` constant from plan 02 and reads the persisted state. The desktop gets two new IPC calls and a request section on the Cloud page.

**Tech Stack:** TypeScript, Zod, Drizzle, oRPC contracts (`@orpc/server` + the existing `implement(contract)` pattern), Electron IPC, Vitest.

**Spec:** `apps/documentation/src/content/docs/specs/2026-09-15-cloud-trial-and-approval.md` — "Request and access state", "Effective capacity resolution", "Reduced-quota behavior", copy table under "Copy prepared in this change".

**Depends on:** Plan 01 (EXPANSION_APPROVED template, `tryGetEmail`) and Plan 02 (enums, `resolveCapacity`, `getEntitlements` v2) — both merged.

## Global Constraints

- State semantics (spec, accepted 2026-09-15):
  - `revoked` and `banned` → capacity 0, uploads blocked. `banned` additionally blocks reapplication until an operator lifts it; `revoked` can be restored.
  - Undoing only the beta expansion is the transition `approved → trial`, not `revoked`.
  - Rejection stores `canReapplyAt = reviewedAt + 30 days`; the server refuses earlier resubmissions.
  - `reviewing` is not a state; audit lives in `reviewedAt`, `reviewedBy`, `reviewReason`.
- A pending request keeps the trial capacity working; requesting is an explicit user action, never a signup side effect.
- Backfill: every user with `email_verified = true` at migration time gets `cloudAccessStatus = 'approved'`, `requestStatus = 'none'`, `reviewReason = 'grandfathered-2026-09'`. New accounts default to `trial` via the missing-row default. Never silently reduce an existing account.
- Notification: approval sends ONE email (plan 01's `EXPANSION_APPROVED`); rejection/revocation/ban send none — the app and Console show the state.
- Tests use hand-written fakes (house style: `packages/application/src/cloud/fakes.ts`). English artifacts everywhere; product copy es/en in `@kaipu/i18n` with parity.

## File Structure

```
packages/domain/src/constants/cloud-limits.ts             # + REAPPLY_COOLDOWN_DAYS
packages/domain/src/schemas/cloud-access.ts               # + cloudAccessStateSchema + default factory
packages/domain/src/repositories/cloud-access-state.repository.ts  # NEW port
packages/domain/src/services/notification.service.ts      # NEW port ICloudNotificationService
packages/infra-db/src/schema/cloud-access.ts              # NEW table
packages/infra-db/src/repositories/cloud-access-state.repository.ts  # NEW
packages/application/src/cloud-access/request-expansion.ts  # NEW
packages/application/src/cloud-access/review-expansion.ts   # NEW
packages/application/src/cloud-access/set-cloud-access.ts   # NEW
packages/application/src/cloud-access/cloud-access.test.ts  # NEW
packages/application/src/cloud-access/fakes.ts              # NEW
apps/server-hono/scripts/backfill-cloud-access.ts           # one-time backfill
apps/server-hono/src/contract/me.contract.ts                # + cloud-access endpoints
apps/server-hono/src/modules/me/me.router.ts                # handlers + state-fed entitlements
apps/server-hono/src/modules/cloud/cloud.router.ts          # state-fed entitlements
apps/server-hono/src/modules/cloud/errors.ts                # CloudAccessDeniedError reason data
packages/domain/src/schemas/cloud-asset.ts                  # CloudAccessDeniedError gains reason
apps/kaipu-record/src/shared/types/cloud-access.ts          # NEW shared type
apps/kaipu-record/src/main/cloud/access-client.ts           # NEW main-process client
apps/kaipu-record/src/main/cloud/index.ts                   # register IPC
apps/kaipu-record/src/{shared/types/ipc.ts, shared/types/electron-api.ts, preload/index.ts}
apps/kaipu-record/src/renderer/src/features/storage-cloud/expansion-request.tsx  # NEW
apps/kaipu-record/src/renderer/src/features/storage-cloud/storage-cloud-settings.tsx
packages/i18n/messages/{en,es}.json                         # storageCloud request keys
```

---

### Task 1: Domain state schema, cooldown constant, repository and notification ports

**Files:**

- Modify: `packages/domain/src/constants/cloud-limits.ts`
- Modify: `packages/domain/src/schemas/cloud-access.ts`
- Create: `packages/domain/src/repositories/cloud-access-state.repository.ts`
- Create: `packages/domain/src/services/notification.service.ts`
- Test: `packages/domain/src/schemas/cloud-access.test.ts`

**Interfaces:**

- Produces:
  - `REAPPLY_COOLDOWN_DAYS = 30`
  - `cloudAccessStateSchema` / `type CloudAccessState { userId; requestStatus; cloudAccessStatus; requestedAt: Date | null; reviewedAt: Date | null; reviewedBy: string | null; reviewReason: string | null; canReapplyAt: Date | null; createdAt: Date; updatedAt: Date }`
  - `defaultCloudAccessState(userId: string, now: Date): CloudAccessState` (`requestStatus: "none"`, `cloudAccessStatus: "trial"`, nullable fields null, timestamps `now`)
  - `ICloudAccessStateRepository { get(userId: string): Promise<CloudAccessState | null>; upsert(state: CloudAccessState): Promise<CloudAccessState> }`
  - `ICloudNotificationService { sendExpansionApproved(userId: string): Promise<void> }`

- [ ] **Step 1: Failing test** (`cloud-access.test.ts`)

```ts
import { describe, expect, it } from "vitest";

import { defaultCloudAccessState } from "./cloud-access";

describe("defaultCloudAccessState", () => {
  it("starts at trial with no request", () => {
    const now = new Date("2026-09-15T12:00:00Z");
    const state = defaultCloudAccessState("u1", now);
    expect(state).toEqual({
      userId: "u1",
      requestStatus: "none",
      cloudAccessStatus: "trial",
      requestedAt: null,
      reviewedAt: null,
      reviewedBy: null,
      reviewReason: null,
      canReapplyAt: null,
      createdAt: now,
      updatedAt: now,
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**, then **Step 3: implement.** In `cloud-limits.ts` add:

```ts
/** Cooldown before a rejected account may request the expansion again. */
export const REAPPLY_COOLDOWN_DAYS = 30;
```

In `cloud-access.ts` add below the enums:

```ts
export const cloudAccessStateSchema = z.object({
  userId: z.string(),
  requestStatus: cloudRequestStatusSchema,
  cloudAccessStatus: cloudAccessStatusSchema,
  requestedAt: z.date().nullable(),
  reviewedAt: z.date().nullable(),
  reviewedBy: z.string().nullable(),
  reviewReason: z.string().nullable(),
  canReapplyAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type CloudAccessState = z.infer<typeof cloudAccessStateSchema>;

/** The implicit state of an account with no row. */
export function defaultCloudAccessState(userId: string, now: Date): CloudAccessState {
  return {
    userId,
    requestStatus: "none",
    cloudAccessStatus: "trial",
    requestedAt: null,
    reviewedAt: null,
    reviewedBy: null,
    reviewReason: null,
    canReapplyAt: null,
    createdAt: now,
    updatedAt: now,
  };
}
```

`cloud-access-state.repository.ts`:

```ts
import type { CloudAccessState } from "../schemas/cloud-access";

/** Dumb persistence — transitions live in application use cases. */
export interface ICloudAccessStateRepository {
  get(userId: string): Promise<CloudAccessState | null>;
  upsert(state: CloudAccessState): Promise<CloudAccessState>;
}
```

`notification.service.ts`:

```ts
/** Outbound notification port; implemented over @kaipu/infra-email at the server boundary. */
export interface ICloudNotificationService {
  sendExpansionApproved(userId: string): Promise<void>;
}
```

Export all from the respective barrels. Run `cd packages/domain && bun run test` → PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/domain
git commit -m "feat(domain): cloud access state schema, cooldown constant and state/notification ports"
```

---

### Task 2: Application transitions (request / review / set)

**Files:**

- Create: `packages/application/src/cloud-access/fakes.ts`
- Create: `packages/application/src/cloud-access/request-expansion.ts`
- Create: `packages/application/src/cloud-access/review-expansion.ts`
- Create: `packages/application/src/cloud-access/set-cloud-access.ts`
- Create: `packages/application/src/cloud-access/index.ts`
- Test: `packages/application/src/cloud-access/cloud-access.test.ts`
- Modify: `packages/application/src/index.ts` (or wherever module barrels are aggregated — check how `entitlements` is exported and match)

**Interfaces:**

- Consumes: Task 1 ports; `ICloudAccessRepository.hasAccess` (emailVerified check); `REAPPLY_COOLDOWN_DAYS`.
- Produces:
  - `class CloudAccessError extends Error { code: "email-unverified" | "already-pending" | "already-approved" | "cooldown" | "blocked" | "not-pending"; canReapplyAt?: Date }`
  - `requestCloudExpansion(params: { states: ICloudAccessStateRepository; cloudAccessRepo: ICloudAccessRepository; userId: string; now?: Date }): Promise<CloudAccessState>`
  - `reviewCloudExpansion(params: { states; notifications: ICloudNotificationService | null; userId: string; decision: "approved" | "rejected"; reviewedBy: string; reason: string | null; now?: Date }): Promise<CloudAccessState>`
  - `setCloudAccess(params: { states; userId: string; status: CloudAccessStatus; updatedBy: string; reason: string | null; now?: Date }): Promise<CloudAccessState>`
  - `makeFakeStates()` test fake.

- [ ] **Step 1: Write the fake** (`fakes.ts`)

```ts
import type { CloudAccessState } from "@kaipu/domain/schemas";
import type { ICloudAccessStateRepository } from "@kaipu/domain/repositories";

export function makeFakeStates(
  initial: CloudAccessState[] = [],
): ICloudAccessStateRepository & { rows: Map<string, CloudAccessState> } {
  const rows = new Map(initial.map((s) => [s.userId, s]));
  return {
    rows,
    async get(userId) {
      return rows.get(userId) ?? null;
    },
    async upsert(state) {
      rows.set(state.userId, state);
      return state;
    },
  };
}
```

- [ ] **Step 2: Write the failing tests** (`cloud-access.test.ts`)

```ts
import { defaultCloudAccessState } from "@kaipu/domain/schemas";
import { describe, expect, it } from "vitest";

import { makeFakeStates } from "./fakes";
import { requestCloudExpansion } from "./request-expansion";
import { reviewCloudExpansion } from "./review-expansion";
import { setCloudAccess } from "./set-cloud-access";

const NOW = new Date("2026-09-15T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const verified = { hasAccess: async () => true, getControl: async () => ({ uploadsEnabled: true }) };
const unverified = { ...verified, hasAccess: async () => false };

describe("requestCloudExpansion", () => {
  it("moves a trial account to pending", async () => {
    const states = makeFakeStates();
    const state = await requestCloudExpansion({ states, cloudAccessRepo: verified, userId: "u1", now: NOW });
    expect(state.requestStatus).toBe("pending");
    expect(state.requestedAt).toEqual(NOW);
    expect(state.cloudAccessStatus).toBe("trial"); // pending keeps the trial working
  });

  it("refuses unverified emails", async () => {
    await expect(
      requestCloudExpansion({ states: makeFakeStates(), cloudAccessRepo: unverified, userId: "u1", now: NOW }),
    ).rejects.toMatchObject({ code: "email-unverified" });
  });

  it("refuses while pending, when approved, when blocked, and during the cooldown", async () => {
    const pending = { ...defaultCloudAccessState("u1", NOW), requestStatus: "pending" as const };
    await expect(requestCloudExpansion({ states: makeFakeStates([pending]), cloudAccessRepo: verified, userId: "u1", now: NOW }))
      .rejects.toMatchObject({ code: "already-pending" });

    const approved = { ...defaultCloudAccessState("u1", NOW), cloudAccessStatus: "approved" as const };
    await expect(requestCloudExpansion({ states: makeFakeStates([approved]), cloudAccessRepo: verified, userId: "u1", now: NOW }))
      .rejects.toMatchObject({ code: "already-approved" });

    const banned = { ...defaultCloudAccessState("u1", NOW), cloudAccessStatus: "banned" as const };
    await expect(requestCloudExpansion({ states: makeFakeStates([banned]), cloudAccessRepo: verified, userId: "u1", now: NOW }))
      .rejects.toMatchObject({ code: "blocked" });

    const rejected = {
      ...defaultCloudAccessState("u1", NOW),
      requestStatus: "rejected" as const,
      canReapplyAt: new Date(NOW.getTime() + DAY),
    };
    await expect(requestCloudExpansion({ states: makeFakeStates([rejected]), cloudAccessRepo: verified, userId: "u1", now: NOW }))
      .rejects.toMatchObject({ code: "cooldown" });
  });

  it("allows reapplying after the cooldown", async () => {
    const rejected = {
      ...defaultCloudAccessState("u1", NOW),
      requestStatus: "rejected" as const,
      canReapplyAt: new Date(NOW.getTime() - 1),
    };
    const state = await requestCloudExpansion({ states: makeFakeStates([rejected]), cloudAccessRepo: verified, userId: "u1", now: NOW });
    expect(state.requestStatus).toBe("pending");
  });
});

describe("reviewCloudExpansion", () => {
  function pendingStates() {
    return makeFakeStates([{ ...defaultCloudAccessState("u1", NOW), requestStatus: "pending" as const, requestedAt: NOW }]);
  }

  it("approval grants access, audits and notifies once", async () => {
    const sent: string[] = [];
    const notifications = { sendExpansionApproved: async (userId: string) => void sent.push(userId) };
    const state = await reviewCloudExpansion({
      states: pendingStates(), notifications, userId: "u1",
      decision: "approved", reviewedBy: "op1", reason: null, now: NOW,
    });
    expect(state.cloudAccessStatus).toBe("approved");
    expect(state.requestStatus).toBe("approved");
    expect(state.reviewedBy).toBe("op1");
    expect(sent).toEqual(["u1"]);
  });

  it("a failed notification does not fail the approval", async () => {
    const notifications = { sendExpansionApproved: async () => { throw new Error("smtp down"); } };
    const state = await reviewCloudExpansion({
      states: pendingStates(), notifications, userId: "u1",
      decision: "approved", reviewedBy: "op1", reason: null, now: NOW,
    });
    expect(state.cloudAccessStatus).toBe("approved");
  });

  it("rejection sets the 30-day cooldown and keeps trial access", async () => {
    const state = await reviewCloudExpansion({
      states: pendingStates(), notifications: null, userId: "u1",
      decision: "rejected", reviewedBy: "op1", reason: "not yet", now: NOW,
    });
    expect(state.requestStatus).toBe("rejected");
    expect(state.cloudAccessStatus).toBe("trial");
    expect(state.canReapplyAt).toEqual(new Date(NOW.getTime() + 30 * DAY));
    expect(state.reviewReason).toBe("not yet");
  });

  it("refuses to review a non-pending request", async () => {
    await expect(
      reviewCloudExpansion({ states: makeFakeStates(), notifications: null, userId: "u1", decision: "approved", reviewedBy: "op1", reason: null, now: NOW }),
    ).rejects.toMatchObject({ code: "not-pending" });
  });
});

describe("setCloudAccess", () => {
  it("revoke, ban, restore and downgrade-to-trial are all recorded with audit fields", async () => {
    const states = makeFakeStates([{ ...defaultCloudAccessState("u1", NOW), cloudAccessStatus: "approved" as const }]);
    const revoked = await setCloudAccess({ states, userId: "u1", status: "revoked", updatedBy: "op1", reason: "abuse", now: NOW });
    expect(revoked.cloudAccessStatus).toBe("revoked");
    expect(revoked.reviewedBy).toBe("op1");
    expect(revoked.reviewReason).toBe("abuse");

    const restored = await setCloudAccess({ states, userId: "u1", status: "trial", updatedBy: "op1", reason: "restored", now: NOW });
    expect(restored.cloudAccessStatus).toBe("trial");
  });

  it("creates the row for a user never seen before", async () => {
    const states = makeFakeStates();
    const banned = await setCloudAccess({ states, userId: "u9", status: "banned", updatedBy: "op1", reason: "fraud", now: NOW });
    expect(banned.cloudAccessStatus).toBe("banned");
  });
});
```

- [ ] **Step 3: Run to verify failures**, then **Step 4: implement.** Shared error class (put it in `request-expansion.ts` and re-export):

```ts
export class CloudAccessError extends Error {
  constructor(
    readonly code:
      | "email-unverified"
      | "already-pending"
      | "already-approved"
      | "cooldown"
      | "blocked"
      | "not-pending",
    message: string,
    readonly canReapplyAt?: Date,
  ) {
    super(message);
    this.name = "CloudAccessError";
  }
}

export async function requestCloudExpansion(params: {
  states: ICloudAccessStateRepository;
  cloudAccessRepo: ICloudAccessRepository;
  userId: string;
  now?: Date;
}): Promise<CloudAccessState> {
  const now = params.now ?? new Date();
  if (!(await params.cloudAccessRepo.hasAccess(params.userId))) {
    throw new CloudAccessError("email-unverified", "Verify your email before requesting more space.");
  }
  const state = (await params.states.get(params.userId)) ?? defaultCloudAccessState(params.userId, now);
  if (state.cloudAccessStatus === "banned" || state.cloudAccessStatus === "revoked") {
    throw new CloudAccessError("blocked", "Cloud access is blocked for this account.");
  }
  if (state.requestStatus === "pending") {
    throw new CloudAccessError("already-pending", "A request is already waiting for review.");
  }
  if (state.cloudAccessStatus === "approved") {
    throw new CloudAccessError("already-approved", "This account already has the expanded capacity.");
  }
  if (state.requestStatus === "rejected" && state.canReapplyAt && state.canReapplyAt.getTime() > now.getTime()) {
    throw new CloudAccessError("cooldown", "Please wait before requesting again.", state.canReapplyAt);
  }
  return params.states.upsert({ ...state, requestStatus: "pending", requestedAt: now, updatedAt: now });
}
```

`review-expansion.ts`:

```ts
const DAY_MS = 24 * 60 * 60 * 1000;

export async function reviewCloudExpansion(params: {
  states: ICloudAccessStateRepository;
  notifications: ICloudNotificationService | null;
  userId: string;
  decision: "approved" | "rejected";
  reviewedBy: string;
  reason: string | null;
  now?: Date;
}): Promise<CloudAccessState> {
  const now = params.now ?? new Date();
  const state = await params.states.get(params.userId);
  if (!state || state.requestStatus !== "pending") {
    throw new CloudAccessError("not-pending", "There is no pending request to review.");
  }
  const saved = await params.states.upsert({
    ...state,
    requestStatus: params.decision,
    cloudAccessStatus: params.decision === "approved" ? "approved" : state.cloudAccessStatus,
    reviewedAt: now,
    reviewedBy: params.reviewedBy,
    reviewReason: params.reason,
    canReapplyAt: params.decision === "rejected" ? new Date(now.getTime() + REAPPLY_COOLDOWN_DAYS * DAY_MS) : null,
    updatedAt: now,
  });
  if (params.decision === "approved" && params.notifications) {
    try {
      await params.notifications.sendExpansionApproved(params.userId);
    } catch (err) {
      // The state change is the source of truth; a failed email must not undo it.
      console.error("expansion approved but the notification failed", err);
    }
  }
  return saved;
}
```

`set-cloud-access.ts`:

```ts
export async function setCloudAccess(params: {
  states: ICloudAccessStateRepository;
  userId: string;
  status: CloudAccessStatus;
  updatedBy: string;
  reason: string | null;
  now?: Date;
}): Promise<CloudAccessState> {
  const now = params.now ?? new Date();
  const state = (await params.states.get(params.userId)) ?? defaultCloudAccessState(params.userId, now);
  return params.states.upsert({
    ...state,
    cloudAccessStatus: params.status,
    reviewedAt: now,
    reviewedBy: params.updatedBy,
    reviewReason: params.reason,
    updatedAt: now,
  });
}
```

`index.ts` barrel exports all four modules; add `cloud-access` to the package's main barrel next to `entitlements`.

- [ ] **Step 5: Run tests** — `cd packages/application && bun run test` → PASS. **Step 6: Commit**

```bash
git add packages/application
git commit -m "feat(application): cloud access request, review and set transitions"
```

---

### Task 3: Infra-db table, repository and backfill

**Files:**

- Create: `packages/infra-db/src/schema/cloud-access.ts`
- Create: `packages/infra-db/src/repositories/cloud-access-state.repository.ts`
- Create: `apps/server-hono/scripts/backfill-cloud-access.ts`
- Modify: root `package.json` (script `backfill:cloud-access`)

**Interfaces:**

- Consumes: `ICloudAccessStateRepository`, `cloudAccessStateSchema`.
- Produces: table `kaipu_record_cloud_access_state`; `class CloudAccessStateRepository implements ICloudAccessStateRepository`.

- [ ] **Step 1: Table** (`schema/cloud-access.ts`, matching `schema/cloud.ts` imports):

```ts
import { text, timestamp } from "drizzle-orm/pg-core";

import { createTable } from "../utils/table-creator";
import { userTable } from "./auth";

/** Request lifecycle + effective Cloud access. Missing row = none/trial. */
export const cloudAccessStateTable = createTable("cloud_access_state", {
  userId: text("user_id")
    .primaryKey()
    .references(() => userTable.id, { onDelete: "cascade" }),
  requestStatus: text("request_status").default("none").notNull(),
  cloudAccessStatus: text("cloud_access_status").default("trial").notNull(),
  requestedAt: timestamp("requested_at"),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: text("reviewed_by"),
  reviewReason: text("review_reason"),
  canReapplyAt: timestamp("can_reapply_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

Export from the schema barrel.

- [ ] **Step 2: Repository** — `get` selects by `userId` and parses through `cloudAccessStateSchema` (statuses come back as `text`; `.parse` guarantees the enum); `upsert` inserts the full state with `onConflictDoUpdate({ target: cloudAccessStateTable.userId, set: { requestStatus, cloudAccessStatus, requestedAt, reviewedAt, reviewedBy, reviewReason, canReapplyAt, updatedAt } })` and `.returning()`. Follow `ManualPlanGrantRepository`'s constructor/client typing exactly.

- [ ] **Step 3: Backfill script** (`apps/server-hono/scripts/backfill-cloud-access.ts`):

```ts
/**
 * One-time backfill (spec 2026-09-15): grandfather every already-verified
 * account to `approved` so nobody's capacity drops when access states go live.
 * Idempotent: ON CONFLICT DO NOTHING.
 *
 *   bun run backfill:cloud-access            # local .env
 *   DATABASE_URL='…' bun run backfill:cloud-access   # production, inline
 */
import { sql } from "drizzle-orm";
import { createDatabaseClient } from "@kaipu/infra-db/client";

async function main(): Promise<number> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set.");
    return 1;
  }
  const db = createDatabaseClient(databaseUrl);
  const result = await db.execute(sql`
    insert into kaipu_record_cloud_access_state
      (user_id, request_status, cloud_access_status, review_reason, created_at, updated_at)
    select id, 'none', 'approved', 'grandfathered-2026-09', now(), now()
    from kaipu_record_user
    where email_verified = true
    on conflict (user_id) do nothing
  `);
  console.log("Backfill done.", result);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
```

Root `package.json` script (same dotenvx pattern as `"plan"`): `"backfill:cloud-access": "dotenvx run -f apps/server-hono/.env -- bun apps/server-hono/scripts/backfill-cloud-access.ts"`.

- [ ] **Step 4: Push and backfill locally**

Run: `bun run db:push` then `bun run backfill:cloud-access`.
Expected: table created; script prints "Backfill done."; re-running is a no-op.

- [ ] **Step 5: Commit**

```bash
git add packages/infra-db apps/server-hono/scripts package.json
git commit -m "feat(db): cloud_access_state table, repository and grandfather backfill"
```

---

### Task 4: Server — state-fed entitlements, endpoints and error reasons

**Files:**

- Modify: `packages/domain/src/schemas/cloud-asset.ts` (`CloudAccessDeniedError` gains `reason`)
- Modify: `packages/application/src/entitlements/get-entitlements.ts` (+ callers/tests)
- Modify: `apps/server-hono/src/contract/me.contract.ts`
- Modify: `apps/server-hono/src/modules/me/me.router.ts`
- Modify: `apps/server-hono/src/modules/cloud/cloud.router.ts`
- Modify: `apps/server-hono/src/modules/cloud/errors.ts` (+ its test)

**Interfaces:**

- Consumes: Tasks 1–3; plan 01's `tryGetEmail`, `EMAIL_TEMPLATE_VALUES.EXPANSION_APPROVED`, `formatDecimalBytes` (domain).
- Produces:
  - `getEntitlements` signature v3: replace `accessStatus: CloudAccessStatus` with `states: ICloudAccessStateRepository`; internally `const accessStatus = (await states.get(userId))?.cloudAccessStatus ?? "trial"`.
  - `GET /me/cloud-access` → `{ data: { requestStatus, cloudAccessStatus, canReapplyAt: string | null, capacityBytes: number }, error: null }`
  - `POST /me/cloud-access/request` → same shape on success; errors: `email-unverified` → FORBIDDEN `{ kind: "email-unverified" }`; `blocked` → FORBIDDEN `{ kind: "blocked" }`; `already-pending`/`already-approved` → CONFLICT; `cooldown` → TOO_MANY_REQUESTS `{ canReapplyAt }`.
  - `CloudAccessDeniedError` constructor takes `reason: "email-unverified" | "revoked" | "banned"`; `toOrpcError` maps it to FORBIDDEN with `data: { kind: err.reason }` (closes gap 1 of `backlog/cloud-error-states.md`).

- [ ] **Step 1: Domain error.** In `cloud-asset.ts`, change `CloudAccessDeniedError` to:

```ts
export class CloudAccessDeniedError extends Error {
  constructor(readonly reason: "email-unverified" | "revoked" | "banned") {
    super("Cloud access is not enabled for this account");
    this.name = "CloudAccessDeniedError";
  }
}
```

Grep its construction sites (`grep -rn "new CloudAccessDeniedError" packages apps`) and pass the reason: in `create-upload-intent.ts` the check is on `entitlements.features.cloudUploads`; extend the use case params with `accessStatus: CloudAccessStatus` and throw `new CloudAccessDeniedError(accessStatus === "banned" ? "banned" : accessStatus === "revoked" ? "revoked" : "email-unverified")`. Routers pass the status they already loaded.

- [ ] **Step 2: `getEntitlements` v3.** Apply the signature change above; update `entitlements.test.ts` (fake states repo from `packages/application/src/cloud-access/fakes.ts`); update `me.router.ts` and `cloud.router.ts` to instantiate `CloudAccessStateRepository` and pass `states` (deleting the plan-02 `accessStatus: "approved"` bridge and its comment).

- [ ] **Step 3: Error mapping test first.** In `errors.test.ts` add:

```ts
it("maps CloudAccessDeniedError with its reason", () => {
  const err = toOrpcError(new CloudAccessDeniedError("banned")) as ORPCError<string, { kind: string }>;
  expect(err.code).toBe("FORBIDDEN");
  expect(err.data).toEqual({ kind: "banned" });
});
```

Run → FAIL → update `errors.ts`:

```ts
if (err instanceof CloudAccessDeniedError) {
  return new ORPCError("FORBIDDEN", {
    message: "Cloud upload access is not enabled for this account",
    data: { kind: err.reason },
  });
}
```

Run → PASS.

- [ ] **Step 4: No notifications adapter in server-hono.** The review action (the only caller of `reviewCloudExpansion` with a non-null `notifications`) lives in Kaipu Console — plan 04 implements `ICloudNotificationService` there (`apps/console/src/lib/email.server.ts`). Do NOT create a `lib/notifications.ts` in server-hono; this API worker never sends the approval email. Locale note for plan 04: the server does not know the user's UI locale at review time; English is the documented fallback (the spec allows it).

- [ ] **Step 5: Contract + handlers.** In `me.contract.ts` add (matching the file's oRPC contract style — copy the `storage` entry's shape):

```ts
cloudAccess: oc
  .route({ method: "GET", path: "/me/cloud-access" })
  .output(apiResponseSchema(cloudAccessViewSchema)),
requestCloudAccess: oc
  .route({ method: "POST", path: "/me/cloud-access/request" })
  .output(apiResponseSchema(cloudAccessViewSchema)),
```

with `cloudAccessViewSchema` (define next to the contract or in domain):

```ts
export const cloudAccessViewSchema = z.object({
  requestStatus: cloudRequestStatusSchema,
  cloudAccessStatus: cloudAccessStatusSchema,
  canReapplyAt: z.date().nullable(),
  capacityBytes: z.number().int().nonnegative(),
});
```

Handlers in `me.router.ts` (both `.use(authMiddleware)`):

```ts
cloudAccess: impl.cloudAccess.use(authMiddleware).handler(async ({ context }) => {
  const state = (await states.get(context.user.id)) ?? defaultCloudAccessState(context.user.id, new Date());
  const entitlements = await getEntitlements({ repo, cloudAccessRepo, configRepo, overrideRepo, states, userId: context.user.id });
  return {
    data: {
      requestStatus: state.requestStatus,
      cloudAccessStatus: state.cloudAccessStatus,
      canReapplyAt: state.canReapplyAt,
      capacityBytes: entitlements.features.cloudStorageBytes,
    },
    error: null,
  };
}),
requestCloudAccess: impl.requestCloudAccess.use(authMiddleware).handler(async ({ context }) => {
  try {
    const state = await requestCloudExpansion({ states, cloudAccessRepo, userId: context.user.id });
    const entitlements = await getEntitlements({ repo, cloudAccessRepo, configRepo, overrideRepo, states, userId: context.user.id });
    return {
      data: { requestStatus: state.requestStatus, cloudAccessStatus: state.cloudAccessStatus, canReapplyAt: state.canReapplyAt, capacityBytes: entitlements.features.cloudStorageBytes },
      error: null,
    };
  } catch (err) {
    if (err instanceof CloudAccessError) {
      if (err.code === "email-unverified" || err.code === "blocked") {
        throw new ORPCError("FORBIDDEN", { message: err.message, data: { kind: err.code } });
      }
      if (err.code === "cooldown") {
        throw new ORPCError("TOO_MANY_REQUESTS", { message: err.message, data: { canReapplyAt: err.canReapplyAt } });
      }
      throw new ORPCError("CONFLICT", { message: err.message, data: { kind: err.code } });
    }
    throw err;
  }
}),
```

- [ ] **Step 6: Full checks**

Run: `bun run check-types && cd apps/server-hono && bun run test && cd ../../packages/application && bun run test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages apps/server-hono
git commit -m "feat(api): cloud access endpoints, state-fed entitlements and typed denial reasons"
```

---

### Task 5: Desktop — request UI

**Files:**

- Create: `apps/kaipu-record/src/shared/types/cloud-access.ts`
- Create: `apps/kaipu-record/src/main/cloud/access-client.ts`
- Modify: `apps/kaipu-record/src/main/cloud/index.ts`, `src/shared/types/ipc.ts`, `src/shared/types/electron-api.ts`, `src/preload/index.ts`, `src/renderer/src/test/setup.ts`
- Create: `apps/kaipu-record/src/renderer/src/features/storage-cloud/expansion-request.tsx`
- Modify: `apps/kaipu-record/src/renderer/src/features/storage-cloud/storage-cloud-settings.tsx`
- Modify: `packages/i18n/messages/{en,es}.json`
- Test: `apps/kaipu-record/src/renderer/src/features/storage-cloud/expansion-request.test.tsx`

**Interfaces:**

- Consumes: `GET/POST /api/v1/me/cloud-access[...]` (Task 4); IPC/preload patterns from `storage-client.ts` / `cloud/index.ts`.
- Produces:
  - `type CloudAccessView = { requestStatus: "none" | "pending" | "approved" | "rejected"; cloudAccessStatus: "trial" | "approved" | "revoked" | "banned"; canReapplyAt: string | null; capacityBytes: number }`
  - IPC channels `cloudGetAccess: "cloud:get-access"`, `cloudRequestExpansion: "cloud:request-expansion"`; preload methods `getCloudAccess(): Promise<CloudAccessResult>`, `requestCloudExpansion(): Promise<CloudAccessResult>` where `CloudAccessResult = { kind: "ok"; access: CloudAccessView } | { kind: "signed-out" } | { kind: "error" }`.

- [ ] **Step 1: i18n keys** (`storageCloud`, en shown / es equivalents):

```json
"expansionRequest": "Request an increase to 1 GB",
"expansionPending": "Your request is pending. You can keep using your 250 MB.",
"expansionApproved": "You now have 1 GB total in Kaipu Cloud.",
"expansionRejected": "Your request wasn't approved this time. You can request again after {date}.",
"expansionRevoked": "Cloud access was removed for this account.",
"expansionBanned": "Cloud is blocked for this account.",
"expansionError": "Couldn't send the request. Try again."
```

es: "Solicitar ampliación a 1 GB" / "Tu solicitud está pendiente. Puedes seguir usando tus 250 MB." / "Ya tienes 1 GB total en Kaipu Cloud." / "Tu solicitud no fue aprobada esta vez. Puedes volver a solicitar después del {date}." / "El acceso a Cloud fue retirado para esta cuenta." / "Cloud está bloqueado para esta cuenta." / "No se pudo enviar la solicitud. Inténtalo de nuevo." — run the i18n parity test.

- [ ] **Step 2: Main-process client** (`access-client.ts`, mirroring `storage-client.ts`'s fetch/timeout/401 style):

```ts
import type { CloudAccessView } from "../../shared/types/cloud-access";

export async function fetchCloudAccess(
  config: { serverUrl: string },
  token: string,
): Promise<CloudAccessView> {
  const res = await fetch(`${config.serverUrl}/api/v1/me/cloud-access`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`cloud access failed: ${res.status}`);
  const body = (await res.json()) as { data?: CloudAccessView };
  if (!body.data) throw new Error("cloud access returned an invalid body");
  return body.data;
}

export async function postCloudExpansionRequest(
  config: { serverUrl: string },
  token: string,
): Promise<CloudAccessView> {
  const res = await fetch(`${config.serverUrl}/api/v1/me/cloud-access/request`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`expansion request failed: ${res.status}`);
  const body = (await res.json()) as { data?: CloudAccessView };
  if (!body.data) throw new Error("expansion request returned an invalid body");
  return body.data;
}
```

Register both in `cloud/index.ts` next to `getStorageUsage`, resolving the account via `deps.auth.getCurrentAccount()` and returning `{ kind: "signed-out" }` without an account, `{ kind: "error" }` on throw. Add channels/preload/electron-api entries and test-setup stubs (`getCloudAccess: async () => ({ kind: "signed-out" })`, same for `requestCloudExpansion`).

- [ ] **Step 3: Failing component test** (`expansion-request.test.tsx`) — render `<ExpansionRequest />` with `getCloudAccess` mocked to `{ kind: "ok", access: { requestStatus: "none", cloudAccessStatus: "trial", canReapplyAt: null, capacityBytes: 250_000_000 } }`; assert the button "Request an increase to 1 GB" renders; click it with `requestCloudExpansion` mocked to return `requestStatus: "pending"`; assert the pending copy appears. Second test: access `{ requestStatus: "none", cloudAccessStatus: "banned", … }` renders the banned copy and no button.

- [ ] **Step 4: Implement `ExpansionRequest`** — a self-contained component: loads access on mount (drop stale answers with the `generation` ref pattern from `use-storage-usage.ts`), renders by state:
  - `trial` + (`none` or reapply-allowed `rejected`) → button → on click POST, swap to returned state, show `expansionError` on failure;
  - `pending` → `expansionPending` text;
  - `approved` (either field) → `expansionApproved` text;
  - `rejected` inside cooldown → `expansionRejected` with the date via `useFormatter().dateTime(new Date(canReapplyAt))`;
  - `revoked` / `banned` → their copy.
    Mount it in `storage-cloud-settings.tsx` under the capacity card, only when `hasAccount` and the capacity view is not `loading`.

- [ ] **Step 5: Run the desktop suite** — `cd apps/kaipu-record && bun run test` → PASS. **Step 6: Commit**

```bash
git add apps/kaipu-record packages/i18n/messages
git commit -m "feat(desktop): cloud expansion request flow on the Cloud page"
```

---

### Task 6: Docs

**Files:**

- Modify: `apps/documentation/src/content/docs/backlog/cloud-error-states.md` (gap 1 → done; add the two new endpoints to section 2/3 tables)
- Modify: `apps/documentation/src/content/docs/specs/2026-09-15-cloud-trial-and-approval.md` (request/access state marked implemented; deploy order note)

- [ ] **Step 1: Update both docs.** Deploy order (record verbatim in the spec): "Deploy order: `db:push` → run `DATABASE_URL='…' bun run backfill:cloud-access` once against production → deploy the API → verify a grandfathered account still shows 1 GB and a fresh signup shows 250 MB."

- [ ] **Step 2: Commit and open the PR**

```bash
git add apps/documentation
git commit -m "docs(cloud): access states implemented; record deploy order and closed gaps"
```

PR title: `feat(cloud): access states, expansion requests and typed denial reasons`.
