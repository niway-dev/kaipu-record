---
title: "Plan 02 — Entitlements v2 (quotas, unlimited, grants, overrides, DB config)"
description: "Implementation plan for the capacity-resolution model: 250 MB / 1 GB / 15 GB / unlimited, dated grants, per-user overrides and runtime capacity configuration."
---

> **Historical plan numbers.** Capacities in this document are as of its date. Current values: [Plans — Free and Pro](/features/plans/).

# Entitlements v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One capacity-resolution function drives every quota in Kaipu: trial 250 MB, beta 1 GB, Pro 15 GB, an explicit `unlimited` plan, dated manual grants with reasons, per-user byte overrides, and capacities editable at runtime from a DB record with safe domain defaults.

**Architecture:** Domain gains the new enums, config schema and a pure `resolveCapacity`; `deriveEntitlements` is reworked to take `{ emailVerified, accessStatus, config, override }`. Infra-db adds two tables (`entitlement_config`, `quota_override`) and a `reason` column on `subscription`. Application's `getEntitlements` gathers the inputs; `grantManualPlan` becomes date-and-reason mandatory for `pro`. **Behavioral bridge:** until plan 03 persists access states, the server passes `accessStatus: "approved"` for every account, so verified users keep today's 1 GB — no capacity regression ships from this plan alone (Pro drops 25 → 15 GB by decision).

**Tech Stack:** TypeScript, Zod, Drizzle ORM (PostgreSQL, `kaipu_record_` prefix), Vitest with hand-written fakes (no mocking libraries).

**Spec:** `apps/documentation/src/content/docs/specs/2026-09-15-cloud-trial-and-approval.md` — sections "Effective capacity resolution", "Decision 4 — Pro capacity", "Temporary Pro grants".

## Global Constraints

- Decimal bytes only: `1 GB = 1_000_000_000` (`BYTES_PER_GB`), `1 MB = 1_000_000` (`BYTES_PER_MB`). Never 1024-based.
- Capacity precedence (first match wins): `banned|revoked → 0` → in-force override → in-force `unlimited`/`pro` plan → `approved → betaCapacityBytes` → `trial → trialCapacityBytes`.
- Per-file caps (`MAX_VIDEO_BYTES`, `MAX_SCREENSHOT_BYTES`, `MAX_THUMBNAIL_BYTES`) and `MAX_PENDING_UPLOADS_PER_ACCOUNT` are system protections: they apply even under `unlimited`. Do not touch them.
- Defaults are domain constants — `250 MB / 1 GB / 15 GB`; the DB record, when present and valid, overrides them. A missing or invalid record must silently fall back (with a `console.error`), never crash or zero out.
- Manual `pro` grants require `currentPeriodEnd` and a `reason`; `unlimited` is the only plan grantable without expiry. Never create plan names like `founder-pro`.
- Expiry is evaluated at read time (`isSubscriptionInForce`); no cron downgrades plans.
- Layering: domain ← application ← infra; only apps wire. Tests use in-memory fakes implementing domain interfaces (see `packages/application/src/cloud/fakes.ts` for the house style).
- All artifacts in English. Lint `bun run lint`, format `bun run format` from root.

## File Structure

```
packages/domain/src/constants/cloud-limits.ts        # capacity constants reworked
packages/domain/src/schemas/subscription.ts          # plan enum + reason + deriveEntitlements v2
packages/domain/src/schemas/cloud-access.ts          # NEW: access/request status enums
packages/domain/src/schemas/entitlement-config.ts    # NEW: CloudCapacityConfig + defaults
packages/domain/src/schemas/quota-override.ts        # NEW: QuotaOverride + isOverrideInForce
packages/domain/src/schemas/capacity.ts              # NEW: resolveCapacity
packages/domain/src/repositories/entitlement-config.repository.ts  # NEW
packages/domain/src/repositories/quota-override.repository.ts      # NEW
packages/domain/src/repositories/manual-plan-grant.repository.ts   # signature change
packages/infra-db/src/schema/entitlements.ts         # NEW: two tables
packages/infra-db/src/schema/subscription.ts         # + reason column
packages/infra-db/src/repositories/entitlement-config.repository.ts  # NEW
packages/infra-db/src/repositories/quota-override.repository.ts      # NEW
packages/infra-db/src/repositories/manual-plan-grant.repository.ts   # updated
packages/application/src/entitlements/get-entitlements.ts       # v2 inputs
packages/application/src/entitlements/capacity-config.ts        # NEW: get/set use cases
packages/application/src/entitlements/manual-plan-grant.ts      # v2 rules
apps/server-hono/src/modules/me/me.router.ts         # new deps + accessStatus bridge
apps/server-hono/src/modules/cloud/cloud.router.ts   # same deps
apps/server-hono/scripts/plan.ts                     # grant now takes plan + days
```

Schema exports: remember every new schema/repository file must be re-exported from the package barrel (`packages/domain/src/schemas/index.ts`, `packages/domain/src/repositories/index.ts`, `packages/infra-db/src/schema/index.ts`, `packages/infra-db/src/repositories/index.ts` — check each barrel's existing style and match it).

---

### Task 1: Domain constants and new schemas

**Files:**

- Modify: `packages/domain/src/constants/cloud-limits.ts`
- Modify: `packages/domain/src/constants/cloud-limits.test.ts`
- Create: `packages/domain/src/schemas/cloud-access.ts`
- Create: `packages/domain/src/schemas/entitlement-config.ts`
- Create: `packages/domain/src/schemas/quota-override.ts`

**Interfaces:**

- Produces (exact names later tasks import):
  - `TRIAL_CLOUD_CAPACITY_BYTES = 250_000_000`, `BETA_CLOUD_CAPACITY_BYTES = 1_000_000_000`, `PRO_CLOUD_CAPACITY_BYTES = 15_000_000_000`, `UNLIMITED_CLOUD_CAPACITY_BYTES = Number.MAX_SAFE_INTEGER`
  - `cloudAccessStatusSchema` (`"trial" | "approved" | "revoked" | "banned"`), `type CloudAccessStatus`; `cloudRequestStatusSchema` (`"none" | "pending" | "approved" | "rejected"`), `type CloudRequestStatus`
  - `cloudCapacityConfigSchema`, `type CloudCapacityConfig`, `DEFAULT_CLOUD_CAPACITY_CONFIG`
  - `quotaOverrideSchema`, `type QuotaOverride`, `isOverrideInForce(override, now): boolean`

- [ ] **Step 1: Update the failing constants test.** In `cloud-limits.test.ts`, replace the assertions for `FREE_CLOUD_CAPACITY_BYTES`/`PRO_CLOUD_CAPACITY_BYTES` with:

```ts
it("defines the decided capacities in decimal bytes", () => {
  expect(TRIAL_CLOUD_CAPACITY_BYTES).toBe(250_000_000);
  expect(BETA_CLOUD_CAPACITY_BYTES).toBe(1_000_000_000);
  expect(PRO_CLOUD_CAPACITY_BYTES).toBe(15_000_000_000);
  expect(UNLIMITED_CLOUD_CAPACITY_BYTES).toBe(Number.MAX_SAFE_INTEGER);
});
```

Keep every other assertion in the file untouched (per-file caps, TTLs).

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/domain && bun run test -- cloud-limits`
Expected: FAIL (new names not exported).

- [ ] **Step 3: Rework the constants.** In `cloud-limits.ts` replace the two capacity lines:

```ts
/** Trial capacity for a verified account (decision 2026-09-15). */
export const TRIAL_CLOUD_CAPACITY_BYTES = 250 * BYTES_PER_MB;
/** Total capacity after the owner approves the beta expansion. */
export const BETA_CLOUD_CAPACITY_BYTES = 1 * BYTES_PER_GB;
/** Pro capacity (decision 2026-09-15: 15 GB, down from the historical 25 GB). */
export const PRO_CLOUD_CAPACITY_BYTES = 15 * BYTES_PER_GB;
/** Sentinel for the owner's `unlimited` plan; fits in a Postgres bigint. */
export const UNLIMITED_CLOUD_CAPACITY_BYTES = Number.MAX_SAFE_INTEGER;
```

Delete `FREE_CLOUD_CAPACITY_BYTES`. Then `grep -rn "FREE_CLOUD_CAPACITY_BYTES" packages apps` and fix every usage (expected: `packages/domain/src/schemas/subscription.ts` — handled in Task 2 — and possibly tests).

- [ ] **Step 4: Create `cloud-access.ts`**

```ts
import { z } from "zod";

/** What the account may use right now (spec: Effective capacity resolution). */
export const cloudAccessStatusSchema = z.enum(["trial", "approved", "revoked", "banned"]);
export type CloudAccessStatus = z.infer<typeof cloudAccessStatusSchema>;

/** What happened to the user's request for the beta expansion. */
export const cloudRequestStatusSchema = z.enum(["none", "pending", "approved", "rejected"]);
export type CloudRequestStatus = z.infer<typeof cloudRequestStatusSchema>;
```

- [ ] **Step 5: Create `entitlement-config.ts`**

```ts
import { z } from "zod";

import {
  BETA_CLOUD_CAPACITY_BYTES,
  PRO_CLOUD_CAPACITY_BYTES,
  TRIAL_CLOUD_CAPACITY_BYTES,
} from "../constants/cloud-limits";

/** Runtime-editable capacities; validated integer decimal bytes. */
export const cloudCapacityConfigSchema = z.object({
  trialCapacityBytes: z.number().int().positive(),
  betaCapacityBytes: z.number().int().positive(),
  proCapacityBytes: z.number().int().positive(),
});
export type CloudCapacityConfig = z.infer<typeof cloudCapacityConfigSchema>;

/** Fallback when the DB record is missing or invalid — never leaves the system without quotas. */
export const DEFAULT_CLOUD_CAPACITY_CONFIG: CloudCapacityConfig = {
  trialCapacityBytes: TRIAL_CLOUD_CAPACITY_BYTES,
  betaCapacityBytes: BETA_CLOUD_CAPACITY_BYTES,
  proCapacityBytes: PRO_CLOUD_CAPACITY_BYTES,
};
```

- [ ] **Step 6: Create `quota-override.ts`**

```ts
import { z } from "zod";

/** Operator-only escape hatch; changes effective capacity without a new plan name. */
export const quotaOverrideSchema = z.object({
  userId: z.string(),
  quotaBytesOverride: z.number().int().nonnegative(),
  reason: z.string().min(1),
  updatedBy: z.string(),
  expiresAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type QuotaOverride = z.infer<typeof quotaOverrideSchema>;

export function isOverrideInForce(override: QuotaOverride, now: Date): boolean {
  return override.expiresAt === null || override.expiresAt.getTime() > now.getTime();
}
```

- [ ] **Step 7: Export from the schemas barrel, run domain tests**

Add the three new files to `packages/domain/src/schemas/index.ts` (match existing export style). Run: `cd packages/domain && bun run test`
Expected: `cloud-limits` passes; `subscription.test.ts` may fail on the deleted constant — if it references `FREE_CLOUD_CAPACITY_BYTES`, update it to `TRIAL_CLOUD_CAPACITY_BYTES` only as a placeholder; Task 2 rewrites those tests properly.

- [ ] **Step 8: Commit**

```bash
git add packages/domain
git commit -m "feat(domain): capacity constants (250MB/1GB/15GB/unlimited), access enums, config and override schemas"
```

---

### Task 2: `resolveCapacity` and `deriveEntitlements` v2

**Files:**

- Create: `packages/domain/src/schemas/capacity.ts`
- Test: `packages/domain/src/schemas/capacity.test.ts`
- Modify: `packages/domain/src/schemas/subscription.ts`
- Modify: `packages/domain/src/schemas/subscription.test.ts`

**Interfaces:**

- Consumes: Task 1's schemas and constants; existing `isSubscriptionInForce`, `SubscriptionBase`.
- Produces:
  - `resolveCapacity(params: { accessStatus: CloudAccessStatus; subscription: SubscriptionBase | null; override: QuotaOverride | null; config: CloudCapacityConfig; now: Date }): number`
  - `planSchema = z.enum(["free", "pro", "unlimited"])`
  - `subscriptionBaseSchema` gains `reason: z.string().nullable()`
  - `deriveEntitlements(sub: SubscriptionBase | null, now: Date, inputs: EntitlementInputs): Entitlements` with `EntitlementInputs { emailVerified: boolean; accessStatus: CloudAccessStatus; config: CloudCapacityConfig; override: QuotaOverride | null }`
  - `FREE_ENTITLEMENTS` recomputed from `DEFAULT_CLOUD_CAPACITY_CONFIG.trialCapacityBytes`

- [ ] **Step 1: Write the failing capacity test** (`capacity.test.ts`)

```ts
import { describe, expect, it } from "vitest";

import { UNLIMITED_CLOUD_CAPACITY_BYTES } from "../constants/cloud-limits";
import { resolveCapacity } from "./capacity";
import { DEFAULT_CLOUD_CAPACITY_CONFIG } from "./entitlement-config";
import type { QuotaOverride } from "./quota-override";
import type { SubscriptionBase } from "./subscription";

const NOW = new Date("2026-09-15T12:00:00Z");
const config = DEFAULT_CLOUD_CAPACITY_CONFIG;

function sub(plan: SubscriptionBase["plan"], end: Date | null): SubscriptionBase {
  return {
    id: "s1", userId: "u1", plan, status: "active", currentPeriodEnd: end,
    provider: "manual", providerRef: null, reason: "support",
    createdAt: NOW, updatedAt: NOW,
  };
}

function override(bytes: number, expiresAt: Date | null): QuotaOverride {
  return {
    userId: "u1", quotaBytesOverride: bytes, reason: "support case",
    updatedBy: "op1", expiresAt, createdAt: NOW, updatedAt: NOW,
  };
}

describe("resolveCapacity", () => {
  const base = { subscription: null, override: null, config, now: NOW };

  it("blocks banned and revoked accounts entirely, even with a plan and an override", () => {
    for (const accessStatus of ["banned", "revoked"] as const) {
      expect(
        resolveCapacity({ ...base, accessStatus, subscription: sub("pro", null), override: override(5, null) }),
      ).toBe(0);
    }
  });

  it("an in-force override beats the plan", () => {
    expect(
      resolveCapacity({ ...base, accessStatus: "approved", subscription: sub("pro", null), override: override(123, null) }),
    ).toBe(123);
  });

  it("an expired override is ignored", () => {
    const past = new Date(NOW.getTime() - 1000);
    expect(
      resolveCapacity({ ...base, accessStatus: "trial", override: override(123, past) }),
    ).toBe(config.trialCapacityBytes);
  });

  it("unlimited and pro use the plan capacity", () => {
    expect(resolveCapacity({ ...base, accessStatus: "trial", subscription: sub("unlimited", null) }))
      .toBe(UNLIMITED_CLOUD_CAPACITY_BYTES);
    expect(resolveCapacity({ ...base, accessStatus: "trial", subscription: sub("pro", new Date(NOW.getTime() + 1000)) }))
      .toBe(config.proCapacityBytes);
  });

  it("an expired pro falls through to the access ladder", () => {
    const expired = sub("pro", new Date(NOW.getTime() - 1000));
    expect(resolveCapacity({ ...base, accessStatus: "approved", subscription: expired }))
      .toBe(config.betaCapacityBytes);
    expect(resolveCapacity({ ...base, accessStatus: "trial", subscription: expired }))
      .toBe(config.trialCapacityBytes);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/domain && bun run test -- capacity`
Expected: FAIL (`./capacity` not found; `reason` missing on `SubscriptionBase`).

- [ ] **Step 3: Extend the subscription schema.** In `subscription.ts`:
  - `planSchema`: `z.enum(["free", "pro", "unlimited"])`.
  - `subscriptionBaseSchema`: add `reason: z.string().nullable(),` after `providerRef`.

- [ ] **Step 4: Write `capacity.ts`**

```ts
import { UNLIMITED_CLOUD_CAPACITY_BYTES } from "../constants/cloud-limits";
import type { CloudAccessStatus } from "./cloud-access";
import type { CloudCapacityConfig } from "./entitlement-config";
import { isOverrideInForce, type QuotaOverride } from "./quota-override";
import { isSubscriptionInForce, type SubscriptionBase } from "./subscription";

/**
 * The single capacity resolver — no other layer computes quotas.
 * Precedence (spec 2026-09-15): banned/revoked → 0; in-force override;
 * in-force unlimited/pro plan; approved → beta; trial → trial.
 */
export function resolveCapacity(params: {
  accessStatus: CloudAccessStatus;
  subscription: SubscriptionBase | null;
  override: QuotaOverride | null;
  config: CloudCapacityConfig;
  now: Date;
}): number {
  const { accessStatus, subscription, override, config, now } = params;
  if (accessStatus === "banned" || accessStatus === "revoked") return 0;
  if (override && isOverrideInForce(override, now)) return override.quotaBytesOverride;
  if (subscription && isSubscriptionInForce(subscription, now)) {
    if (subscription.plan === "unlimited") return UNLIMITED_CLOUD_CAPACITY_BYTES;
    if (subscription.plan === "pro") return config.proCapacityBytes;
  }
  if (accessStatus === "approved") return config.betaCapacityBytes;
  return config.trialCapacityBytes;
}
```

- [ ] **Step 5: Rework `deriveEntitlements`.** Replace the current `EntitlementInputs` and function body in `subscription.ts`:

```ts
export interface EntitlementInputs {
  emailVerified: boolean;
  accessStatus: CloudAccessStatus;
  config: CloudCapacityConfig;
  override: QuotaOverride | null;
}

export function deriveEntitlements(
  sub: SubscriptionBase | null,
  now: Date,
  inputs: EntitlementInputs,
): Entitlements {
  const inForce = sub ? isSubscriptionInForce(sub, now) : false;
  const paidInForce = inForce && (sub?.plan === "pro" || sub?.plan === "unlimited");
  const blocked = inputs.accessStatus === "revoked" || inputs.accessStatus === "banned";
  return {
    // Expiry is evaluated at read time: an expired grant reports "free".
    plan: inForce && sub ? sub.plan : "free",
    status: sub?.status ?? "active",
    currentPeriodEnd: sub?.currentPeriodEnd ?? null,
    features: {
      watermarkRemoval: paidInForce,
      cloudUploads: inputs.emailVerified && !blocked,
      cloudStorageBytes: resolveCapacity({
        accessStatus: inputs.accessStatus,
        subscription: sub,
        override: inputs.override,
        config: inputs.config,
        now,
      }),
    },
  };
}
```

`FREE_ENTITLEMENTS` becomes:

```ts
export const FREE_ENTITLEMENTS: Entitlements = {
  plan: "free",
  status: "active",
  currentPeriodEnd: null,
  features: {
    watermarkRemoval: false,
    cloudUploads: false,
    cloudStorageBytes: DEFAULT_CLOUD_CAPACITY_CONFIG.trialCapacityBytes,
  },
};
```

The old default parameter (`inputs = { cloudAccess: false }`) is gone — `inputs` is now required. This is a deliberate compile break so every caller is reviewed. Note `deriveEntitlements` is also called by `apps/console/src/lib/users.server.ts` (uncommitted prototype) — if that file is present in the working tree, update its call to `deriveEntitlements(subscription, new Date(), { emailVerified: user.emailVerified, accessStatus: "approved", config: DEFAULT_CLOUD_CAPACITY_CONFIG, override: null })` (plan 04 wires it properly).

- [ ] **Step 6: Rewrite `subscription.test.ts` expectations.** Update the existing `deriveEntitlements` tests to the new inputs. Cover at minimum:

```ts
const INPUTS = {
  emailVerified: true,
  accessStatus: "approved" as const,
  config: DEFAULT_CLOUD_CAPACITY_CONFIG,
  override: null,
};

it("reports free with trial capacity for a null subscription in trial", () => {
  const e = deriveEntitlements(null, NOW, { ...INPUTS, accessStatus: "trial" });
  expect(e.plan).toBe("free");
  expect(e.features.cloudStorageBytes).toBe(250_000_000);
});

it("an expired pro reports plan free and beta capacity when approved", () => {
  const e = deriveEntitlements(sub("pro", new Date(NOW.getTime() - 1)), NOW, INPUTS);
  expect(e.plan).toBe("free");
  expect(e.features.watermarkRemoval).toBe(false);
  expect(e.features.cloudStorageBytes).toBe(1_000_000_000);
});

it("cloudUploads requires a verified email and a non-blocked status", () => {
  expect(deriveEntitlements(null, NOW, { ...INPUTS, emailVerified: false }).features.cloudUploads).toBe(false);
  expect(deriveEntitlements(null, NOW, { ...INPUTS, accessStatus: "banned" }).features.cloudUploads).toBe(false);
  expect(deriveEntitlements(null, NOW, INPUTS).features.cloudUploads).toBe(true);
});
```

(reuse the file's existing fixture helpers, adding `reason: null` to them).

- [ ] **Step 7: Run domain tests**

Run: `cd packages/domain && bun run test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/domain
git commit -m "feat(domain): resolveCapacity ladder and deriveEntitlements v2"
```

---

### Task 3: Repository ports and infra-db tables

**Files:**

- Create: `packages/domain/src/repositories/entitlement-config.repository.ts`
- Create: `packages/domain/src/repositories/quota-override.repository.ts`
- Modify: `packages/domain/src/repositories/manual-plan-grant.repository.ts`
- Create: `packages/infra-db/src/schema/entitlements.ts`
- Modify: `packages/infra-db/src/schema/subscription.ts` (+ `reason` column)
- Create: `packages/infra-db/src/repositories/entitlement-config.repository.ts`
- Create: `packages/infra-db/src/repositories/quota-override.repository.ts`
- Modify: `packages/infra-db/src/repositories/manual-plan-grant.repository.ts`
- Modify: `packages/infra-db/src/mappers/subscription.mapper.ts` (map `reason`)

**Interfaces:**

- Produces:
  - `IEntitlementConfigRepository { get(): Promise<CloudCapacityConfig | null>; set(config: CloudCapacityConfig, updatedBy: string): Promise<void> }`
  - `IQuotaOverrideRepository { findByUserId(userId: string): Promise<QuotaOverride | null>; upsert(input: { userId: string; quotaBytesOverride: number; reason: string; updatedBy: string; expiresAt: Date | null }): Promise<QuotaOverride>; deleteByUserId(userId: string): Promise<void> }`
  - `IManualPlanGrantRepository.upsertManualGrant(userId: string, plan: Plan, expiresAt: Date | null, reason: string): Promise<SubscriptionBase>` (signature change; other methods unchanged)
  - Tables `kaipu_record_entitlement_config` (single row, id `"global"`) and `kaipu_record_quota_override` (pk `user_id`).

- [ ] **Step 1: Write the domain ports.** `entitlement-config.repository.ts`:

```ts
import type { CloudCapacityConfig } from "../schemas/entitlement-config";

/** Single global record, id "global". `get` returns null when the row is absent. */
export interface IEntitlementConfigRepository {
  get(): Promise<CloudCapacityConfig | null>;
  set(config: CloudCapacityConfig, updatedBy: string): Promise<void>;
}
```

`quota-override.repository.ts`:

```ts
import type { QuotaOverride } from "../schemas/quota-override";

export interface IQuotaOverrideRepository {
  findByUserId(userId: string): Promise<QuotaOverride | null>;
  upsert(input: {
    userId: string;
    quotaBytesOverride: number;
    reason: string;
    updatedBy: string;
    expiresAt: Date | null;
  }): Promise<QuotaOverride>;
  deleteByUserId(userId: string): Promise<void>;
}
```

Change `IManualPlanGrantRepository.upsertManualGrant` to `(userId: string, plan: Plan, expiresAt: Date | null, reason: string): Promise<SubscriptionBase>`. Export both new ports from the repositories barrel.

- [ ] **Step 2: Write the tables.** `packages/infra-db/src/schema/entitlements.ts` (mirror the column/index style of `schema/cloud.ts`, using the same `createTable`, `bigint(..., { mode: "number" })`, `timestamp` helpers that file imports):

```ts
import { bigint, text, timestamp } from "drizzle-orm/pg-core";

import { createTable } from "../utils/table-creator";
import { userTable } from "./auth";

/** Single-row runtime capacities. `id` is always "global"; editable only from Kaipu Console. */
export const entitlementConfigTable = createTable("entitlement_config", {
  id: text("id").primaryKey(),
  trialCapacityBytes: bigint("trial_capacity_bytes", { mode: "number" }).notNull(),
  betaCapacityBytes: bigint("beta_capacity_bytes", { mode: "number" }).notNull(),
  proCapacityBytes: bigint("pro_capacity_bytes", { mode: "number" }).notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Operator-only per-user capacity override; audited escape hatch. */
export const quotaOverrideTable = createTable("quota_override", {
  userId: text("user_id")
    .primaryKey()
    .references(() => userTable.id, { onDelete: "cascade" }),
  quotaBytesOverride: bigint("quota_bytes_override", { mode: "number" }).notNull(),
  reason: text("reason").notNull(),
  updatedBy: text("updated_by").notNull(),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

Add `reason: text("reason"),` to `subscriptionTable` in `schema/subscription.ts` (nullable — existing rows have none). Export `entitlements.ts` from the schema barrel. Update `mapSubscriptionToDomain` to map `reason: row.reason ?? null`.

- [ ] **Step 3: Implement the repositories** (follow `subscription.repository.ts` house style — class over the drizzle client, mapper at the edge):

`entitlement-config.repository.ts`:

```ts
import { eq } from "drizzle-orm";

import type { CloudCapacityConfig, IEntitlementConfigRepository } from "@kaipu/domain/...";
import { entitlementConfigTable } from "../schema/entitlements";

const GLOBAL_ID = "global";

export class EntitlementConfigRepository implements IEntitlementConfigRepository {
  constructor(private readonly db: /* same client type the other repos use */) {}

  async get(): Promise<CloudCapacityConfig | null> {
    const [row] = await this.db
      .select()
      .from(entitlementConfigTable)
      .where(eq(entitlementConfigTable.id, GLOBAL_ID))
      .limit(1);
    if (!row) return null;
    return {
      trialCapacityBytes: row.trialCapacityBytes,
      betaCapacityBytes: row.betaCapacityBytes,
      proCapacityBytes: row.proCapacityBytes,
    };
  }

  async set(config: CloudCapacityConfig, updatedBy: string): Promise<void> {
    await this.db
      .insert(entitlementConfigTable)
      .values({ id: GLOBAL_ID, ...config, updatedBy, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: entitlementConfigTable.id,
        set: { ...config, updatedBy, updatedAt: new Date() },
      });
  }
}
```

`quota-override.repository.ts` — same pattern: `findByUserId` select + map to `QuotaOverride`; `upsert` with `onConflictDoUpdate({ target: quotaOverrideTable.userId, set: {...} })` returning the mapped row (use `.returning()`); `deleteByUserId` a `delete().where(eq(...))`. Copy the exact constructor/client typing from `ManualPlanGrantRepository`.

Update `ManualPlanGrantRepository.upsertManualGrant` to accept `(userId, plan, expiresAt, reason)` and write `currentPeriodEnd: expiresAt, reason` in both the insert values and the conflict `set` (it already uses `onConflictDoUpdate` on `userId`).

- [ ] **Step 4: Push the schema locally and run checks**

Run: `bun run db:push` (root; local `.env`) — confirm the diff shows exactly `kaipu_record_entitlement_config` created, `kaipu_record_quota_override` created, `kaipu_record_subscription.reason` added. Then `bun run check-types`.
Expected: push applies; typecheck fails only in `application`/`server-hono` callers of the changed grant signature — that is Task 4's work; if the typecheck command is monorepo-wide, defer running it to Task 4 Step 6 and typecheck only `packages/infra-db` here.

- [ ] **Step 5: Commit**

```bash
git add packages/domain packages/infra-db
git commit -m "feat(db): entitlement_config and quota_override tables, dated manual grants"
```

---

### Task 4: Application use cases v2

**Files:**

- Create: `packages/application/src/entitlements/capacity-config.ts`
- Test: `packages/application/src/entitlements/capacity-config.test.ts`
- Modify: `packages/application/src/entitlements/get-entitlements.ts`
- Modify: `packages/application/src/entitlements/entitlements.test.ts`
- Modify: `packages/application/src/entitlements/manual-plan-grant.ts`
- Modify: `packages/application/src/entitlements/manual-plan-grant.test.ts`
- Modify: `packages/application/src/entitlements/index.ts`

**Interfaces:**

- Consumes: Task 1–3 outputs.
- Produces:
  - `getCapacityConfig(repo: IEntitlementConfigRepository): Promise<CloudCapacityConfig>` (defaults on missing/invalid/error)
  - `setCapacityConfig(params: { repo: IEntitlementConfigRepository; config: CloudCapacityConfig; updatedBy: string }): Promise<CloudCapacityConfig>`
  - `getEntitlements(params: { repo: ISubscriptionRepository; cloudAccessRepo: ICloudAccessRepository; configRepo: IEntitlementConfigRepository; overrideRepo: IQuotaOverrideRepository; accessStatus: CloudAccessStatus; userId: string; now?: Date }): Promise<Entitlements>` — plan 03 replaces the explicit `accessStatus` param with a states repository.
  - `grantManualPlan(params: { repo; email: string; plan: Plan; expiresAt: Date | null; reason: string }): Promise<SubscriptionBase>`; `ManualPlanGrantError` codes now `"user-not-found" | "provider-owned" | "invalid-plan" | "expiry-required" | "reason-required"`.

- [ ] **Step 1: Write the failing config test** (`capacity-config.test.ts`)

```ts
import type { CloudCapacityConfig, IEntitlementConfigRepository } from "@kaipu/domain/...";
import { DEFAULT_CLOUD_CAPACITY_CONFIG } from "@kaipu/domain/schemas";
import { describe, expect, it } from "vitest";

import { getCapacityConfig, setCapacityConfig } from "./capacity-config";

function makeFakeConfigRepo(initial: CloudCapacityConfig | null = null) {
  return {
    row: initial,
    updatedBy: null as string | null,
    async get() {
      return this.row;
    },
    async set(config: CloudCapacityConfig, updatedBy: string) {
      this.row = config;
      this.updatedBy = updatedBy;
    },
  } satisfies IEntitlementConfigRepository & { row: CloudCapacityConfig | null; updatedBy: string | null };
}

describe("getCapacityConfig", () => {
  it("returns the stored record when present", async () => {
    const stored = { trialCapacityBytes: 1, betaCapacityBytes: 2, proCapacityBytes: 3 };
    expect(await getCapacityConfig(makeFakeConfigRepo(stored))).toEqual(stored);
  });

  it("falls back to the domain defaults when the row is missing", async () => {
    expect(await getCapacityConfig(makeFakeConfigRepo(null))).toEqual(DEFAULT_CLOUD_CAPACITY_CONFIG);
  });

  it("falls back to the defaults when the read throws", async () => {
    const repo = makeFakeConfigRepo();
    repo.get = async () => {
      throw new Error("db down");
    };
    expect(await getCapacityConfig(repo)).toEqual(DEFAULT_CLOUD_CAPACITY_CONFIG);
  });

  it("falls back when the stored values are invalid", async () => {
    const repo = makeFakeConfigRepo({ trialCapacityBytes: -5, betaCapacityBytes: 2, proCapacityBytes: 3 });
    expect(await getCapacityConfig(repo)).toEqual(DEFAULT_CLOUD_CAPACITY_CONFIG);
  });
});

describe("setCapacityConfig", () => {
  it("validates and stores with the operator id", async () => {
    const repo = makeFakeConfigRepo();
    const config = { trialCapacityBytes: 250_000_000, betaCapacityBytes: 1_000_000_000, proCapacityBytes: 15_000_000_000 };
    await setCapacityConfig({ repo, config, updatedBy: "op1" });
    expect(repo.row).toEqual(config);
    expect(repo.updatedBy).toBe("op1");
  });

  it("rejects non-integer or non-positive values", async () => {
    const repo = makeFakeConfigRepo();
    await expect(
      setCapacityConfig({ repo, config: { trialCapacityBytes: 0, betaCapacityBytes: 1, proCapacityBytes: 1 }, updatedBy: "op1" }),
    ).rejects.toThrow();
  });
});
```

(Use the domain package's real import paths — check how `entitlements.test.ts` imports domain types and match it.)

- [ ] **Step 2: Run it to verify it fails**, then **Step 3: implement `capacity-config.ts`**

```ts
import type { IEntitlementConfigRepository } from "@kaipu/domain/repositories";
import {
  cloudCapacityConfigSchema,
  DEFAULT_CLOUD_CAPACITY_CONFIG,
  type CloudCapacityConfig,
} from "@kaipu/domain/schemas";

/** Reads the runtime capacities. A missing or invalid record falls back to the
 * domain defaults — the system is never left without quotas. */
export async function getCapacityConfig(
  repo: IEntitlementConfigRepository,
): Promise<CloudCapacityConfig> {
  try {
    const row = await repo.get();
    if (row) {
      const parsed = cloudCapacityConfigSchema.safeParse(row);
      if (parsed.success) return parsed.data;
      console.error("entitlement config record is invalid; using defaults", parsed.error);
    }
  } catch (err) {
    console.error("entitlement config read failed; using defaults", err);
  }
  return DEFAULT_CLOUD_CAPACITY_CONFIG;
}

export async function setCapacityConfig(params: {
  repo: IEntitlementConfigRepository;
  config: CloudCapacityConfig;
  updatedBy: string;
}): Promise<CloudCapacityConfig> {
  const config = cloudCapacityConfigSchema.parse(params.config);
  await params.repo.set(config, params.updatedBy);
  return config;
}
```

- [ ] **Step 4: Rework `getEntitlements`**

```ts
export async function getEntitlements(params: {
  repo: ISubscriptionRepository;
  cloudAccessRepo: ICloudAccessRepository;
  configRepo: IEntitlementConfigRepository;
  overrideRepo: IQuotaOverrideRepository;
  /** Until plan 03 persists access states, callers pass "approved" so verified
   * accounts keep 1 GB (no silent reduction of existing accounts). */
  accessStatus: CloudAccessStatus;
  userId: string;
  now?: Date;
}): Promise<Entitlements> {
  const now = params.now ?? new Date();
  const [subscription, emailVerified, config, override] = await Promise.all([
    params.repo.findByUserId(params.userId),
    params.cloudAccessRepo.hasAccess(params.userId),
    getCapacityConfig(params.configRepo),
    params.overrideRepo.findByUserId(params.userId),
  ]);
  return deriveEntitlements(subscription, now, { emailVerified, accessStatus: params.accessStatus, config, override });
}
```

Update `entitlements.test.ts` with fakes for the two new repos (config fake from Step 1's factory; override fake returning `null` by default) and add one test proving an override changes `cloudStorageBytes`.

- [ ] **Step 5: Rework `grantManualPlan`.** New body rules before the upsert (keep `resolveUserId`/`assertNotProviderOwned` as-is):

```ts
export async function grantManualPlan(params: {
  repo: IManualPlanGrantRepository;
  email: string;
  plan: Plan;
  expiresAt: Date | null;
  reason: string;
}): Promise<SubscriptionBase> {
  if (params.plan === "free") {
    throw new ManualPlanGrantError("invalid-plan", "Grant pro or unlimited; revoke to return an account to free.");
  }
  if (params.plan === "pro" && params.expiresAt === null) {
    throw new ManualPlanGrantError("expiry-required", "Manual pro grants need an expiry date (unlimited is the only open-ended plan).");
  }
  const reason = params.reason.trim();
  if (!reason) {
    throw new ManualPlanGrantError("reason-required", "A grant needs a reason (referral, early_access, support, …).");
  }
  const userId = await resolveUserId(params.repo, params.email);
  assertNotProviderOwned(await params.repo.findByUserId(userId), params.email);
  return params.repo.upsertManualGrant(userId, params.plan, params.expiresAt, reason);
}
```

Extend the `ManualPlanGrantError` code union accordingly. Update `manual-plan-grant.test.ts`: the fake repo's `upsertManualGrant` takes the new arguments and writes `currentPeriodEnd: expiresAt, reason`; existing tests pass `expiresAt: new Date("2026-12-14T12:00:00Z"), reason: "support"`; add tests for `invalid-plan`, `expiry-required`, `reason-required`, and one granting `unlimited` with `expiresAt: null` succeeding.

- [ ] **Step 6: Fix compile breaks across the repo.** `grep -rn "getEntitlements\|grantManualPlan\|deriveEntitlements" apps packages --include="*.ts" --include="*.tsx" -l` (run through bash without zsh glob issues: `grep -rln --include='*.ts' --include='*.tsx' -e getEntitlements -e grantManualPlan -e deriveEntitlements apps packages`). Update:
  - `apps/server-hono/src/modules/me/me.router.ts` and `modules/cloud/cloud.router.ts`: instantiate `EntitlementConfigRepository` and `QuotaOverrideRepository` next to the existing repos and pass `configRepo`, `overrideRepo`, `accessStatus: "approved"` with the comment `// Plan 03 replaces this constant with the persisted access state.`
  - `apps/server-hono/scripts/plan.ts`: Task 5 below.
  - `apps/console/src/lib/users.server.ts` if present (see Task 2 Step 5 note).

Run: `bun run check-types && bun run test` (root).
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add packages/application apps/server-hono apps/console 2>/dev/null || git add packages/application apps/server-hono
git commit -m "feat(application): capacity config use cases, entitlements v2 and dated manual grants"
```

---

### Task 5: Update the operator CLI (interim, retired by plan 04)

**Files:**

- Modify: `apps/server-hono/scripts/plan.ts`

**Interfaces:**

- Consumes: `grantManualPlan` v2.
- Produces: `bun run plan grant <email> <pro|unlimited> [days]` (default 90 days for pro; ignored for unlimited) with `reason: "support"`.

- [ ] **Step 1: Update the grant branch**

```ts
case "grant": {
  const plan = planSchema.safeParse(planArg);
  if (!plan.success || plan.data === "free") {
    console.error(`Grant pro or unlimited (got "${planArg}").`);
    return 1;
  }
  const days = Number(process.argv[5] ?? "90");
  if (!Number.isInteger(days) || days <= 0) {
    console.error("Days must be a positive integer.");
    return 1;
  }
  const expiresAt = plan.data === "unlimited" ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const row = await grantManualPlan({ repo, email, plan: plan.data, expiresAt, reason: "support" });
  console.log(
    `Granted ${row.plan} to ${email}` +
      (row.currentPeriodEnd ? ` until ${row.currentPeriodEnd.toISOString()}.` : " (no expiry)."),
  );
  break;
}
```

Update the usage comment at the top of the file to `bun run plan grant <email> <pro|unlimited> [days=90]`. Note in the same comment: `// This CLI is retired once Kaipu Console covers granting (plan 04).`

- [ ] **Step 2: Smoke-test against the local DB**

Run: `bun run plan show <a-local-test-email>` then `bun run plan grant <that-email> pro 30` then `show` again.
Expected: `show` prints `pro (active, manual)`.

- [ ] **Step 3: Commit**

```bash
git add apps/server-hono/scripts/plan.ts
git commit -m "feat(cli): plan grant takes an explicit plan and expiry in days"
```

---

### Task 6: Documentation and deploy notes

**Files:**

- Modify: `apps/documentation/src/content/docs/specs/2026-09-15-cloud-trial-and-approval.md` (Decision 4: mark model implemented, note the accessStatus bridge)
- Modify: `apps/documentation/src/content/docs/backlog/optional-cloud.md` or the relevant cloud backlog doc if it states the 25 GB figure (grep `25 GB` under `apps/documentation` and fix stale mentions)

- [ ] **Step 1: Docs.** In Decision 4, add: "Implemented in plan 02. Until plan 03 lands, the server passes `accessStatus: 'approved'` for every account, so verified users keep 1 GB and existing accounts are not reduced. Pro is now 15 GB effective on deploy." Fix any stale `25 GB` mention found by `grep -rn "25 GB" apps/documentation/src`.

- [ ] **Step 2: Deploy notes in the PR body.** The release requires `bun run db:push` against production (inline `DATABASE_URL='…' bun run db:push`, as done on 2026-09-15) **before** deploying the API. Capacity changes for existing Pro users: 25 → 15 GB is a decided reduction; per the terms, if any Pro account were over 15 GB it must be notified — as of 2026-09-15 there are no paying users, so this is a no-op, but say so in the PR.

- [ ] **Step 3: Commit and open the PR**

```bash
git add apps/documentation
git commit -m "docs(entitlements): record v2 model, 15 GB Pro and the plan-03 bridge"
```

PR title: `feat(entitlements): capacity resolution v2 with runtime config, unlimited plan and dated grants`.

## Execution order note

Land after plan 01 is merged (no hard dependency, but plan 03 needs both). Plans 03 and 04 build directly on this model — do not start them until this plan's PR is merged.
