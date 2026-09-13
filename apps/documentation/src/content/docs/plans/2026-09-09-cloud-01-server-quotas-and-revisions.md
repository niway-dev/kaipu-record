---
title: Cloud 01 — server quotas, revisions and immutable tickets
description: Task-by-task TDD plan for the server side of optional cloud — atomic quota reservations, idempotent upload intents, size/type/hash-bound presigned tickets, verified confirmation, scheduled cleanup and account purge.
---

# Cloud 01 — Server Quotas, Revisions and Immutable Tickets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** replace the unmetered `recording` upload vertical with an account-scoped asset/revision
model whose quota, per-file limits, ticket integrity and cleanup are enforced by the server even
against a modified client.

**Architecture:** the domain gains a `cloud-asset` module (asset identity chosen by the client,
immutable revisions, decimal byte limits, pure quota rules). Quota is enforced by a single
conditional `UPDATE … WHERE used + reserved + new <= capacity RETURNING` on a per-account
accounting row, which serialises concurrent reservations without an interactive transaction
(the Neon HTTP driver has none). Presigned PUT tickets bind the object key, `Content-Length`,
`Content-Type`, `x-amz-checksum-sha256` and `If-None-Match: *`, so the bytes that can land are
exactly the declared revision and can never be overwritten. A Cloudflare Cron Trigger sweeps
expired reservations, retries physical deletes and purges the objects of deleted accounts. The
existing `recording` vertical (table, use cases, contract, web consumer) is removed at the end.

**Tech Stack:** Zod 4 (domain), Drizzle + Neon HTTP (infra-db), aws4fetch (infra-storage),
Hono + oRPC on Cloudflare Workers (server-hono), Vitest. No new runtime dependencies.

**Spec:** `/specs/2026-09-09-cloud-product`, `/specs/2026-09-09-cloud-data-model`, umbrella plan
`/plans/2026-09-09-cloud-delivery` (Phase 1). Sibling plan: `/plans/2026-09-09-cloud-02-local-identity-and-combined-library`
(desktop, independent; consumes the wire contract in the "Interfaces" blocks below).

## Global Constraints

- Repo content (code, comments, commit messages, docs) is **English**.
- No TS enums — `as const` arrays + Zod enums (house rule).
- **Decimal units**: `1 GB = 1_000_000_000 bytes`. Every limit and every display value is an
  integer number of bytes; the old binary `MAX_UPLOAD_BYTES = 2 GiB` is deleted, not kept.
- **Free capacity 1 GB total, future plan 25 GB total, max 1 GB per video, max 25 MB per
  screenshot** (screenshot value is a proposal — confirmed in Task 0). Capacity is occupied space,
  never a monthly allowance.
- **Quota rule (authoritative, server-side):** `usedBytes + reservedBytes + newBytes <= capacity`.
  `newBytes` includes auxiliaries (thumbnail). Two concurrent requests for the last bytes must not
  both succeed; a client lying about size must not bypass the limit.
- **Idempotency:** one upload intent key (client UUID) per account maps to exactly one revision
  and one reservation. Repeating the call returns the same revision, never a second one.
- **Tickets are immutable and restricted:** a ticket writes exactly one object of the declared
  length/type/hash; a reused ticket cannot replace a ready object (`If-None-Match: *` → 412).
- **Confirmation verifies**: HEAD length, content type and sha256 checksum must equal the declared
  values before a revision becomes `ready`. Repeated confirmation is idempotent (no double count).
- **No presigned URL, token or raw file name is ever logged, returned in errors or sent to
  telemetry.** Structured events carry ids and byte counts only.
- **Private bucket** (`kaipu-private-bucket`, no custom domain) stays separate from the public
  installer bucket. Object keys never leave the server except inside a presigned URL.
- **Deletion:** cloud delete is physical; failures leave the revision `deleting` and are retried
  by the sweep; tombstones (`expired`/`deleted` rows) prevent resurrection. Accounting never goes
  negative on repeated cancel/delete.
- **Sharing, share links and the public player are NOT in this plan** (plan 04). Automatic
  upload is NOT in this plan (plan 05). The desktop client is NOT in this plan (plans 02/03).
- Every new `wrangler.jsonc` change is followed by `bun run cf:gen-types` in `apps/server-hono`.
- Run from the monorepo root unless a step says otherwise. Package tests: `bun run test --filter=<pkg>`;
  types: `bun run check-types --filter=<pkg>`; lint/format: `bun run check`.

---

## Task 0: Decision gate — values the spec leaves open

**This task blocks every task after Task 1.** The user (founder) fills the "Decided" column and
commits this file. Implementers copy the decided values into `cloud-limits.ts` (Task 2) and
`wrangler.jsonc` (Task 11). Do not start Task 2 while a cell says "pending".

| Value                             | Where it applies                                                                                                              | Proposed                                                                                                                                                              | Decided                                                                                                                                                                                                       |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MAX_SCREENSHOT_BYTES`            | per-file cap for `kind = "screenshot"`                                                                                        | `25_000_000` (25 MB)                                                                                                                                                  | `25_000_000` — decided 2026-09-13                                                                                                                                                                             |
| `MAX_PENDING_UPLOADS_PER_ACCOUNT` | reservations in `reserved` state per user                                                                                     | `3`                                                                                                                                                                   | `3` — decided 2026-09-13                                                                                                                                                                                      |
| `UPLOAD_TICKET_TTL_SECONDS`       | presigned PUT lifetime                                                                                                        | `900` (15 min, current default)                                                                                                                                       | pending — founder leaning shorter; `300` (5 min) proposed, since R2 checks expiry only when the PUT starts                                                                                                    |
| `RESERVATION_GRACE_SECONDS`       | sweep only touches a reservation this long after its ticket expired (a 1 GB PUT started at second 899 must be able to finish) | `3600`                                                                                                                                                                | pending — `10800` (3 h) proposed: 1 GB at ~1 Mbps takes ~2 h 15 min, and 1 h would cut off uploads at 2 Mbps                                                                                                  |
| `DOWNLOAD_URL_TTL_SECONDS`        | presigned GET lifetime                                                                                                        | `600` (10 min)                                                                                                                                                        | `600` — decided 2026-09-13                                                                                                                                                                                    |
| Cron schedule                     | `triggers.crons` for the sweep                                                                                                | `"*/15 * * * *"`                                                                                                                                                      | under discussion — sweep frequency, not free-tier size                                                                                                                                                        |
| Sweep batch size                  | rows per scheduled invocation (Worker CPU limit)                                                                              | `50` reservations + `50` deletes + `1` purge                                                                                                                          | under discussion                                                                                                                                                                                              |
| Beta access                       | how accounts get `cloudUploads`                                                                                               | manual `cloud_access` rows (same pattern as manual `pro` grants); target 100 accounts, not enforced in code                                                           | decided 2026-09-13: founder grants access through a script (`cloud:grant` / `cloud:revoke`) that updates plan + cloud access together; the future payment webhook reuses the same logic. No hand-written SQL. |
| Global upload switch              | how the operator stops new tickets                                                                                            | `cloud_control` row `uploads_enabled` toggled by SQL, no deploy                                                                                                       | under discussion                                                                                                                                                                                              |
| Rate limits                       | who limits `POST /assets/upload-intents`, `confirm`, `download-url`, `DELETE`                                                 | Cloudflare WAF rate-limiting rules keyed on the session cookie / `Authorization` header hash, documented in Task 13; app-level cap is the pending-uploads limit above | decided 2026-09-13: Cloudflare WAF rate limiting. Check the plan's rule allowance (Free includes one rule) in Task 13.                                                                                        |

**Also open (raised 2026-09-13, not a Task 0 row):** the Free plan's total capacity — the founder
does not want to give away too much; `FREE_CLOUD_CAPACITY_BYTES = 1 GB` stays a proposal until
that conversation closes.

- [ ] **Step 1:** Fill every "Decided" cell. If a decision differs from "Proposed", say so in the
      commit message body.
- [ ] **Step 2: Commit**

```bash
git add apps/documentation/src/content/docs/plans/2026-09-09-cloud-01-server-quotas-and-revisions.md
git commit -m "docs(plans): decide the open values for cloud server limits"
```

---

## Task 1: Spike — prove R2 enforces size, type, hash and no-overwrite at write time

The whole plan rests on the presigned PUT being restricted **while bytes are written**, not only
checked afterwards (a 1 GB object that landed already cost storage). This spike runs against the
real private bucket with throwaway keys and records the evidence. **If checks (a) or (b) fail,
stop and design a Worker-proxied alternative before Task 6.**

**Files:**

- Create: `packages/infra-storage/scripts/r2-ticket-spike.ts`
- Modify: `apps/documentation/src/content/docs/backlog/r2-upload-integrity.md` (add "Evidence" section)

- [ ] **Step 1: Write the spike script**

```ts
// packages/infra-storage/scripts/r2-ticket-spike.ts
// Run: R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=kaipu-private-bucket \
//      bun packages/infra-storage/scripts/r2-ticket-spike.ts
// Writes only under `spike/<uuid>/` and deletes everything it created.
import { AwsClient } from "aws4fetch";
import { createHash } from "node:crypto";

const env = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
};

const client = new AwsClient({
  accessKeyId: env("R2_ACCESS_KEY_ID"),
  secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
  region: "auto",
  service: "s3",
});
const endpoint = `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com/${env("R2_BUCKET")}`;
const key = `spike/${crypto.randomUUID()}/object.bin`;
const url = `${endpoint}/${key}`;

const body = Buffer.alloc(1024 * 1024, 7); // 1 MiB
const sha256 = createHash("sha256").update(body).digest("base64");

async function presign(headers: Record<string, string>): Promise<string> {
  const u = new URL(url);
  u.searchParams.set("X-Amz-Expires", "600");
  const signed = await client.sign(u.toString(), {
    method: "PUT",
    headers,
    aws: { signQuery: true, allHeaders: true },
  });
  return signed.url;
}

const ticketHeaders = {
  "content-type": "application/octet-stream",
  "content-length": String(body.byteLength),
  "if-none-match": "*",
  "x-amz-checksum-sha256": sha256,
};

const results: Record<string, string> = {};

// (a) wrong length must be rejected (signature covers content-length)
{
  const ticket = await presign(ticketHeaders);
  const res = await fetch(ticket, {
    method: "PUT",
    headers: { ...ticketHeaders, "content-length": String(body.byteLength * 2) },
    body: Buffer.concat([body, body]),
  });
  results["a. wrong length rejected"] = `${res.status} ${res.status >= 400 ? "OK" : "FAIL"}`;
}
// (c) wrong checksum must be rejected
{
  const ticket = await presign(ticketHeaders);
  const wrong = Buffer.alloc(body.byteLength, 9);
  const res = await fetch(ticket, { method: "PUT", headers: ticketHeaders, body: wrong });
  results["c. wrong sha256 rejected"] = `${res.status} ${res.status >= 400 ? "OK" : "FAIL"}`;
}
// happy path
{
  const ticket = await presign(ticketHeaders);
  const res = await fetch(ticket, { method: "PUT", headers: ticketHeaders, body });
  results["happy path"] = `${res.status} ${res.ok ? "OK" : "FAIL"}`;
}
// (b) second PUT through a fresh ticket for the same key must be refused (If-None-Match: *)
{
  const ticket = await presign(ticketHeaders);
  const res = await fetch(ticket, { method: "PUT", headers: ticketHeaders, body });
  results["b. overwrite refused (expect 412)"] = `${res.status} ${res.status === 412 ? "OK" : "FAIL"}`;
}
// (d) HEAD exposes length, type and the stored checksum
{
  const res = await client.fetch(url, { method: "HEAD", headers: { "x-amz-checksum-mode": "ENABLED" } });
  results["d. head"] =
    `${res.status} len=${res.headers.get("content-length")} type=${res.headers.get("content-type")} ` +
    `sha256=${res.headers.get("x-amz-checksum-sha256")} etag=${res.headers.get("etag")}`;
}
// (e) Range GET works (player seeking)
{
  const get = await client.sign(url, { method: "GET", aws: { signQuery: true } });
  const res = await fetch(get.url, { headers: { range: "bytes=10-19" } });
  results["e. range get (expect 206, 10 bytes)"] =
    `${res.status} len=${(await res.arrayBuffer()).byteLength}`;
}
// (f) cleanup
{
  const res = await client.fetch(url, { method: "DELETE" });
  results["f. delete"] = `${res.status}`;
}

console.table(results);
```

- [ ] **Step 2: Run it against the real bucket**

Run (from the monorepo root, with the four R2 variables exported from `apps/server-hono/.env`):
`bun packages/infra-storage/scripts/r2-ticket-spike.ts`
Expected: every row ends with `OK`; `b.` is `412`; `d.` prints a non-null `sha256`; `e.` is `206 len=10`.

- [ ] **Step 3: Record the evidence**

Append to `apps/documentation/src/content/docs/backlog/r2-upload-integrity.md`:

```markdown
## Evidence (spike, YYYY-MM-DD)

Ran `packages/infra-storage/scripts/r2-ticket-spike.ts` against `kaipu-private-bucket`:

| Check | Result |
| --- | --- |
| a. body longer than the signed `Content-Length` | `<status>` rejected |
| b. second PUT on an existing key with signed `If-None-Match: *` | `412` |
| c. body whose sha256 differs from the signed `x-amz-checksum-sha256` | `<status>` rejected |
| d. HEAD returns `content-length`, `content-type`, `x-amz-checksum-sha256` | yes / no |
| e. Range GET | `206` |

Conclusion: the presigned ticket bounds the bytes at write time; plan 01 proceeds with presigned PUT.
```

(Replace the placeholders with the real statuses printed by the script.)

- [ ] **Step 4: Commit**

```bash
git add packages/infra-storage/scripts/r2-ticket-spike.ts apps/documentation/src/content/docs/backlog/r2-upload-integrity.md
git commit -m "chore(infra-storage): spike proving R2 presigned tickets bound length, type, hash and overwrite"
```

---

## File Structure

**Domain (`packages/domain/src/`)**

- Create `constants/cloud-limits.ts` (+ test) — decimal byte units, per-kind caps, TTLs, pending cap.
- Create `schemas/cloud-asset.ts` (+ test) — asset/revision/intent/usage schemas, errors, key builders, pure quota rules.
- Modify `schemas/subscription.ts` (+ test) — `features.cloudUploads`, `features.cloudStorageBytes`.
- Create `repositories/cloud-asset.repository.ts`, `repositories/cloud-access.repository.ts` — ports.
- Modify `services/storage.service.ts` — `createUploadTicket`, `headObject`, `listObjectKeys`.
- Modify `constants/index.ts`, `schemas/index.ts`, `repositories/index.ts`, `services/index.ts` — barrels.
- Delete (Task 12) `schemas/recording.ts` + test, `repositories/recording.repository.ts`.

**Application (`packages/application/src/`)**

- Create `cloud/create-upload-intent.ts`, `cloud/confirm-upload.ts`, `cloud/cancel-upload.ts`,
  `cloud/list-cloud-assets.ts`, `cloud/get-asset-download-url.ts`, `cloud/delete-cloud-copy.ts`,
  `cloud/get-storage-usage.ts`, `cloud/sweep-expired-reservations.ts`, `cloud/retry-pending-deletes.ts`,
  `cloud/purge-account-objects.ts`, `cloud/index.ts`, `cloud/fakes.ts` (test doubles), `cloud/cloud.test.ts`.
- Modify `entitlements/get-entitlements.ts` (+ test) — cloud access input.
- Delete (Task 12) `recordings/*`.

**Infra DB (`packages/infra-db/src/`)**

- Create `schema/cloud.ts` — `cloud_asset`, `cloud_revision`, `cloud_storage_account`, `cloud_access`, `cloud_control`, `cloud_purge`.
- Create `repositories/cloud-asset.repository.ts`, `repositories/cloud-access.repository.ts`, `mappers/cloud.mapper.ts`.
- Create `src/integration/cloud-asset.repository.integration.test.ts`, `vitest.integration.config.ts`.
- Modify `schema/index.ts`, `repositories/index.ts`, `mappers/index.ts`, `package.json` (test scripts), `schema/auth.ts` (relations).
- Delete (Task 12) `schema/recording.ts`, `repositories/recording.repository.ts`, `mappers/recording.mapper.ts`.

**Infra storage (`packages/infra-storage/src/`)**

- Modify `r2-storage.ts` (+ test) — ticket with signed headers, HEAD metadata, ListObjectsV2.

**Infra auth (`packages/infra-auth/src/config/base-config.ts`)** — enable `user.deleteUser` with a `beforeDelete` hook that enqueues a purge.

**Server (`apps/server-hono/`)**

- Create `src/contract/cloud.contract.ts`, `src/modules/cloud/cloud.router.ts`, `src/modules/cloud/errors.ts`, `src/lib/events.ts`, `src/lib/storage.ts`, `src/scheduled.ts`.
- Modify `src/contract/index.ts`, `src/contract/me.contract.ts`, `src/modules/me/me.router.ts`, `src/router.ts`, `src/index.ts`, `wrangler.jsonc`.
- Delete (Task 12) `src/contract/recording.contract.ts`, `src/modules/recording/`.

**Web (`apps/web-hono/src/`)** — Task 12 migrates `hooks/use-recordings.ts` and `routes/_authenticated/recordings/index.tsx` to the assets API.

**Docs (`apps/documentation/src/content/docs/`)** — backlog status updates, `backend/cloud-storage.md` operational reference, WAF runbook.

---

## Wire contract (shared with plan 02 and later plans)

All routes are under `/api/v1`, behind `authMiddleware`, wrapped in the `{ data, error }` envelope.

| Method   | Path                                               | Input                                            | `data`                                                                 |
| -------- | -------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------- |
| `POST`   | `/assets/upload-intents` (201)                     | `CreateUploadIntent`                             | `UploadIntentResult`                                                   |
| `POST`   | `/assets/{assetId}/revisions/{revisionId}/confirm` | path params                                      | `CloudAssetSummary`                                                    |
| `POST`   | `/assets/{assetId}/revisions/{revisionId}/cancel`  | path params                                      | `{ released: boolean }`                                                |
| `GET`    | `/assets?cursor&limit`                             | `cursor?: string`, `limit?: 1..100` (default 50) | `{ items: CloudAssetSummary[], nextCursor: string \| null }`           |
| `GET`    | `/assets/{assetId}`                                | path                                             | `CloudAssetSummary`                                                    |
| `GET`    | `/assets/{assetId}/download-url`                   | path                                             | `{ asset: CloudAssetSummary, downloadUrl: string, expiresAt: string }` |
| `DELETE` | `/assets/{assetId}/cloud`                          | path                                             | `{ deleted: boolean }`                                                 |
| `POST`   | `/assets/{assetId}/auto-upload-exclusion`          | `{ excluded: boolean }`                          | `CloudAssetSummary`                                                    |
| `GET`    | `/me/storage`                                      | —                                                | `StorageUsage`                                                         |

Shapes (dates are ISO strings on the wire):

```ts
type CloudAssetSummary = {
  assetId: string; kind: "recording" | "screenshot"; title: string;
  currentRevisionId: string | null;           // null while the only revision is still reserved
  contentType: string | null; sizeBytes: number | null; contentSha256: string | null; // of the current revision
  durationSeconds: number; hasThumbnail: boolean;
  derivedFromAssetId: string | null; autoUploadExcluded: boolean;
  createdAt: string; updatedAt: string;
};
type UploadIntentResult = {
  asset: CloudAssetSummary;
  revisionId: string;
  status: "reserved" | "ready";
  ticket: null | {                            // null when status === "ready" (idempotent repeat)
    url: string; headers: Record<string, string>; expiresAt: string;
    thumbnail: null | { url: string; headers: Record<string, string> };
  };
};
type StorageUsage = {
  capacityBytes: number; usedBytes: number; reservedBytes: number; availableBytes: number;
  pendingUploads: number; uploadsEnabled: boolean; cloudUploads: boolean;
};
```

Error mapping (oRPC codes): `QuotaExceededError` → `PAYLOAD_TOO_LARGE` with `data: { missingBytes }`;
`FileTooLargeError` → `PAYLOAD_TOO_LARGE` with `data: { limitBytes }`; `UnsupportedContentTypeError` → `BAD_REQUEST`;
`TooManyPendingUploadsError` → `TOO_MANY_REQUESTS`; `UploadsDisabledError` → `SERVICE_UNAVAILABLE`;
`CloudAccessDeniedError` → `FORBIDDEN`; `UploadVerificationError` → `CONFLICT` with `data: { reason }`;
`AssetConflictError` → `CONFLICT`; not found / not owned → `NOT_FOUND` (never reveals existence).

---

### Task 2: Domain — cloud limits in decimal bytes

**Files:**

- Create: `packages/domain/src/constants/cloud-limits.ts`
- Test: `packages/domain/src/constants/cloud-limits.test.ts`
- Modify: `packages/domain/src/constants/index.ts`

**Interfaces:**

- Produces: `BYTES_PER_MB`, `BYTES_PER_GB`, `FREE_CLOUD_CAPACITY_BYTES`, `PRO_CLOUD_CAPACITY_BYTES`,
  `MAX_VIDEO_BYTES`, `MAX_SCREENSHOT_BYTES`, `MAX_PENDING_UPLOADS_PER_ACCOUNT`,
  `UPLOAD_TICKET_TTL_SECONDS`, `RESERVATION_GRACE_SECONDS`, `DOWNLOAD_URL_TTL_SECONDS`,
  `maxBytesForKind(kind)`, `formatDecimalBytes(bytes)`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/constants/cloud-limits.test.ts
import { describe, expect, it } from "vitest";
import {
  BYTES_PER_GB,
  FREE_CLOUD_CAPACITY_BYTES,
  MAX_SCREENSHOT_BYTES,
  MAX_VIDEO_BYTES,
  PRO_CLOUD_CAPACITY_BYTES,
  formatDecimalBytes,
  maxBytesForKind,
} from "./cloud-limits";

describe("cloud limits", () => {
  it("uses decimal units: 1 GB is exactly 1,000,000,000 bytes", () => {
    expect(BYTES_PER_GB).toBe(1_000_000_000);
    expect(FREE_CLOUD_CAPACITY_BYTES).toBe(1_000_000_000);
    expect(PRO_CLOUD_CAPACITY_BYTES).toBe(25_000_000_000);
    expect(MAX_VIDEO_BYTES).toBe(1_000_000_000);
  });

  it("caps each kind independently", () => {
    expect(maxBytesForKind("recording")).toBe(MAX_VIDEO_BYTES);
    expect(maxBytesForKind("screenshot")).toBe(MAX_SCREENSHOT_BYTES);
    expect(MAX_SCREENSHOT_BYTES).toBeLessThan(MAX_VIDEO_BYTES);
  });

  it("formats bytes in decimal MB/GB, never binary", () => {
    expect(formatDecimalBytes(350_000_000)).toBe("350 MB");
    expect(formatDecimalBytes(1_000_000_000)).toBe("1 GB");
    expect(formatDecimalBytes(1_250_000_000)).toBe("1.25 GB");
    expect(formatDecimalBytes(999_999)).toBe("1 MB");
    expect(formatDecimalBytes(0)).toBe("0 MB");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test --filter=@kaipu/domain`
Expected: FAIL — `Cannot find module './cloud-limits'`.

- [ ] **Step 3: Write the constants** (copy the decided values from Task 0)

```ts
// packages/domain/src/constants/cloud-limits.ts
/**
 * Cloud storage limits. All sizes are integer bytes in DECIMAL units (the units on
 * the product page and the invoice): 1 GB = 1,000,000,000 bytes. Never use 1024
 * here — the desktop shows the same numbers the server enforces.
 */
export const BYTES_PER_MB = 1_000_000;
export const BYTES_PER_GB = 1_000_000_000;

/** Total occupied space allowed per account (media + persisted thumbnails). */
export const FREE_CLOUD_CAPACITY_BYTES = 1 * BYTES_PER_GB;
export const PRO_CLOUD_CAPACITY_BYTES = 25 * BYTES_PER_GB;

/** Per-file caps, independent of the account capacity. */
export const MAX_VIDEO_BYTES = 1 * BYTES_PER_GB;
export const MAX_SCREENSHOT_BYTES = 25 * BYTES_PER_MB; // Task 0
/** A persisted thumbnail is an auxiliary object and counts toward capacity. */
export const MAX_THUMBNAIL_BYTES = 512_000;

/** Reservations a single account may hold in `reserved` state at once. */
export const MAX_PENDING_UPLOADS_PER_ACCOUNT = 3; // Task 0
/** Presigned PUT lifetime. */
export const UPLOAD_TICKET_TTL_SECONDS = 15 * 60; // Task 0
/** How long after ticket expiry the sweep waits before releasing a reservation. */
export const RESERVATION_GRACE_SECONDS = 60 * 60; // Task 0
/** Presigned GET lifetime. */
export const DOWNLOAD_URL_TTL_SECONDS = 10 * 60; // Task 0

export type CloudAssetKind = "recording" | "screenshot";

export function maxBytesForKind(kind: CloudAssetKind): number {
  return kind === "screenshot" ? MAX_SCREENSHOT_BYTES : MAX_VIDEO_BYTES;
}

/** "350 MB", "1.25 GB" — decimal, at most two decimals, no trailing zeros. */
export function formatDecimalBytes(bytes: number): string {
  if (bytes >= BYTES_PER_GB) return `${trim(bytes / BYTES_PER_GB)} GB`;
  return `${trim(bytes / BYTES_PER_MB)} MB`;
}

function trim(value: number): string {
  return String(Math.round(value * 100) / 100);
}
```

Replace the contents of `packages/domain/src/constants/index.ts` with:

```ts
export * from "./cloud-limits";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test --filter=@kaipu/domain`
Expected: PASS (3 tests in `cloud-limits.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/constants
git commit -m "feat(domain): cloud storage limits in decimal bytes"
```

---

### Task 3: Domain — asset, revision, upload intent and quota rules

**Files:**

- Create: `packages/domain/src/schemas/cloud-asset.ts`
- Test: `packages/domain/src/schemas/cloud-asset.test.ts`
- Modify: `packages/domain/src/schemas/index.ts`

**Interfaces:**

- Consumes: Task 2 constants.
- Produces (all exported from `@kaipu/domain/schemas`): `cloudAssetKindSchema`, `revisionStatusSchema`,
  `REVISION_STATUSES`, `cloudAssetSchema` / `CloudAsset`, `cloudRevisionSchema` / `CloudRevision`,
  `cloudAssetSummarySchema` / `CloudAssetSummary`, `createUploadIntentSchema` / `CreateUploadIntent`,
  `storageUsageSchema` / `StorageUsage`, `SUPPORTED_CONTENT_TYPES`, `isSupportedContentType`,
  `extensionForContentType`, `buildRevisionStorageKey`, `buildThumbnailStorageKey`, `accountPrefixes`,
  `computeMissingBytes`, `isValidUploadSize`, `toAssetSummary`, and the errors
  `QuotaExceededError`, `FileTooLargeError`, `UnsupportedContentTypeError`, `TooManyPendingUploadsError`,
  `UploadsDisabledError`, `CloudAccessDeniedError`, `UploadVerificationError`, `AssetConflictError`,
  `RevisionNotReadyError`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/schemas/cloud-asset.test.ts
import { describe, expect, it } from "vitest";
import { MAX_SCREENSHOT_BYTES, MAX_VIDEO_BYTES } from "../constants/cloud-limits";
import {
  accountPrefixes,
  buildRevisionStorageKey,
  buildThumbnailStorageKey,
  computeMissingBytes,
  createUploadIntentSchema,
  isSupportedContentType,
  isValidUploadSize,
  toAssetSummary,
  type CloudAsset,
  type CloudRevision,
} from "./cloud-asset";

const SHA = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU="; // base64 sha256 of ""
const UUID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

describe("createUploadIntentSchema", () => {
  const valid = {
    assetId: UUID,
    intentKey: "9b2c1f3e-1111-4222-8333-444455556666",
    kind: "recording" as const,
    title: "Demo",
    contentType: "video/mp4",
    sizeBytes: 1000,
    contentSha256: SHA,
    durationSeconds: 12,
    thumbnail: { sizeBytes: 2000, contentSha256: SHA },
  };

  it("accepts a well-formed intent and defaults optional fields", () => {
    const parsed = createUploadIntentSchema.parse({ ...valid, thumbnail: undefined });
    expect(parsed.durationSeconds).toBe(12);
    expect(parsed.derivedFromAssetId).toBeNull();
    expect(parsed.thumbnail).toBeNull();
  });

  it("rejects non-uuid ids, empty hashes and non-positive sizes", () => {
    expect(() => createUploadIntentSchema.parse({ ...valid, assetId: "x" })).toThrow();
    expect(() => createUploadIntentSchema.parse({ ...valid, contentSha256: "" })).toThrow();
    expect(() => createUploadIntentSchema.parse({ ...valid, sizeBytes: 0 })).toThrow();
  });
});

describe("pure rules", () => {
  it("allows only product-supported content types per kind", () => {
    expect(isSupportedContentType("recording", "video/mp4")).toBe(true);
    expect(isSupportedContentType("recording", "video/webm")).toBe(true);
    expect(isSupportedContentType("recording", "image/png")).toBe(false);
    expect(isSupportedContentType("screenshot", "image/png")).toBe(true);
    expect(isSupportedContentType("screenshot", "application/octet-stream")).toBe(false);
    expect(isSupportedContentType("recording", "video/mp4; codecs=avc1")).toBe(true);
  });

  it("validates size against the per-kind cap", () => {
    expect(isValidUploadSize("recording", MAX_VIDEO_BYTES)).toBe(true);
    expect(isValidUploadSize("recording", MAX_VIDEO_BYTES + 1)).toBe(false);
    expect(isValidUploadSize("screenshot", MAX_SCREENSHOT_BYTES + 1)).toBe(false);
    expect(isValidUploadSize("screenshot", 0)).toBe(false);
  });

  it("computes the missing bytes from committed occupation (used + reserved)", () => {
    expect(computeMissingBytes({ capacityBytes: 1000, usedBytes: 800, reservedBytes: 0 }, 550)).toBe(350);
    expect(computeMissingBytes({ capacityBytes: 1000, usedBytes: 800, reservedBytes: 150 }, 50)).toBe(0);
    expect(computeMissingBytes({ capacityBytes: 1000, usedBytes: 800, reservedBytes: 150 }, 51)).toBe(1);
  });

  it("lays out keys as <prefix>/<userId>/<assetId>/<revisionId>.<ext>", () => {
    expect(
      buildRevisionStorageKey({ userId: "u1", assetId: "a1", revisionId: "r1", kind: "recording", contentType: "video/mp4" }),
    ).toBe("videos/u1/a1/r1.mp4");
    expect(
      buildRevisionStorageKey({ userId: "u1", assetId: "a1", revisionId: "r1", kind: "screenshot", contentType: "image/png" }),
    ).toBe("img/u1/a1/r1.png");
    expect(buildThumbnailStorageKey({ userId: "u1", assetId: "a1", revisionId: "r1", kind: "recording" })).toBe(
      "videos/u1/a1/r1.thumb.jpg",
    );
    expect(accountPrefixes("u1")).toEqual(["videos/u1/", "img/u1/"]);
  });

  it("summarises an asset with its current ready revision, hiding storage keys", () => {
    const asset: CloudAsset = {
      assetId: "a1", userId: "u1", kind: "recording", title: "Demo", currentRevisionId: "r1",
      durationSeconds: 12, derivedFromAssetId: null, autoUploadExcluded: false,
      createdAt: new Date(1), updatedAt: new Date(2), deletedAt: null,
    };
    const revision: CloudRevision = {
      revisionId: "r1", assetId: "a1", userId: "u1", intentKey: "k1", status: "ready",
      storageKey: "videos/u1/a1/r1.mp4", thumbnailKey: "videos/u1/a1/r1.thumb.jpg",
      contentType: "video/mp4", sizeBytes: 1000, thumbnailBytes: 200, contentSha256: SHA,
      reservedBytes: 1200, ticketExpiresAt: new Date(3), verifiedAt: new Date(4),
      createdAt: new Date(1), updatedAt: new Date(4),
    };
    const summary = toAssetSummary(asset, revision);
    expect(summary).toMatchObject({ assetId: "a1", currentRevisionId: "r1", sizeBytes: 1000, hasThumbnail: true });
    expect(JSON.stringify(summary)).not.toContain("videos/u1");
    expect(toAssetSummary({ ...asset, currentRevisionId: null }, null)).toMatchObject({
      currentRevisionId: null, sizeBytes: null, contentSha256: null, hasThumbnail: false,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test --filter=@kaipu/domain`
Expected: FAIL — `Cannot find module './cloud-asset'`.

- [ ] **Step 3: Write the schemas and rules**

```ts
// packages/domain/src/schemas/cloud-asset.ts
import { z } from "zod";
import { maxBytesForKind, type CloudAssetKind } from "../constants/cloud-limits";

/** A cloud asset is a screen video or a screenshot (mirrors the local vault). */
export const cloudAssetKindSchema = z.enum(["recording", "screenshot"]);

/**
 * `reserved` — quota is held and a ticket may still write the object.
 * `ready`    — bytes verified in storage; counts as used space.
 * `deleting` — physical delete requested; still counts as used until it succeeds.
 * `expired`  — reservation released by cancel or by the sweep (tombstone).
 * `deleted`  — object gone and accounting settled (tombstone).
 */
export const REVISION_STATUSES = ["reserved", "ready", "deleting", "expired", "deleted"] as const;
export const revisionStatusSchema = z.enum(REVISION_STATUSES);
export type RevisionStatus = z.infer<typeof revisionStatusSchema>;

const uuid = z.string().uuid();
/** Base64 of a 32-byte digest is always 44 chars ending in "=". */
const sha256Base64 = z.string().regex(/^[A-Za-z0-9+/]{43}=$/, "Expected a base64 sha256 digest");

export const cloudAssetSchema = z.object({
  assetId: uuid,
  userId: z.string(),
  kind: cloudAssetKindSchema,
  title: z.string().min(1).max(500),
  currentRevisionId: z.string().nullable(),
  durationSeconds: z.number().int().nonnegative(),
  derivedFromAssetId: uuid.nullable(),
  autoUploadExcluded: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
  deletedAt: z.date().nullable(),
});
export type CloudAsset = z.infer<typeof cloudAssetSchema>;

export const cloudRevisionSchema = z.object({
  revisionId: z.string(),
  assetId: uuid,
  userId: z.string(),
  intentKey: z.string(),
  status: revisionStatusSchema,
  storageKey: z.string().min(1),
  thumbnailKey: z.string().nullable(),
  contentType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  thumbnailBytes: z.number().int().nonnegative(),
  contentSha256: sha256Base64,
  /** sizeBytes + thumbnailBytes — what the accounting row holds for this revision. */
  reservedBytes: z.number().int().positive(),
  ticketExpiresAt: z.date(),
  verifiedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type CloudRevision = z.infer<typeof cloudRevisionSchema>;

/** What clients see. Never carries storage keys. */
export const cloudAssetSummarySchema = z.object({
  assetId: uuid,
  kind: cloudAssetKindSchema,
  title: z.string(),
  currentRevisionId: z.string().nullable(),
  contentType: z.string().nullable(),
  sizeBytes: z.number().int().nullable(),
  contentSha256: z.string().nullable(),
  durationSeconds: z.number().int().nonnegative(),
  hasThumbnail: z.boolean(),
  derivedFromAssetId: uuid.nullable(),
  autoUploadExcluded: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type CloudAssetSummary = z.infer<typeof cloudAssetSummarySchema>;

export const createUploadIntentSchema = z.object({
  /** Stable identity minted by the client (sidecar). Same asset on re-upload. */
  assetId: uuid,
  /** One per attempt-to-upload-this-revision. Retrying with the same key is idempotent. */
  intentKey: uuid,
  kind: cloudAssetKindSchema,
  title: z.string().min(1).max(500),
  contentType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  contentSha256: sha256Base64,
  durationSeconds: z.number().int().nonnegative().default(0),
  derivedFromAssetId: uuid.nullable().default(null),
  thumbnail: z
    .object({ sizeBytes: z.number().int().positive(), contentSha256: sha256Base64 })
    .nullable()
    .default(null),
});
export type CreateUploadIntent = z.infer<typeof createUploadIntentSchema>;

export const storageUsageSchema = z.object({
  capacityBytes: z.number().int().nonnegative(),
  usedBytes: z.number().int().nonnegative(),
  reservedBytes: z.number().int().nonnegative(),
  availableBytes: z.number().int().nonnegative(),
  pendingUploads: z.number().int().nonnegative(),
  uploadsEnabled: z.boolean(),
  cloudUploads: z.boolean(),
});
export type StorageUsage = z.infer<typeof storageUsageSchema>;

// --- Pure rules (no I/O) ---------------------------------------------------

export const SUPPORTED_CONTENT_TYPES: Record<CloudAssetKind, readonly string[]> = {
  recording: ["video/mp4", "video/webm", "video/quicktime"],
  screenshot: ["image/png", "image/jpeg", "image/webp"],
};

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

function baseType(contentType: string): string {
  return contentType.toLowerCase().split(";")[0]?.trim() ?? "";
}

export function isSupportedContentType(kind: CloudAssetKind, contentType: string): boolean {
  return SUPPORTED_CONTENT_TYPES[kind].includes(baseType(contentType));
}

/** File extension for a supported content type; throws for anything else. */
export function extensionForContentType(contentType: string): string {
  const ext = EXTENSION_BY_CONTENT_TYPE[baseType(contentType)];
  if (!ext) throw new UnsupportedContentTypeError(contentType);
  return ext;
}

export function isValidUploadSize(kind: CloudAssetKind, sizeBytes: number): boolean {
  return Number.isInteger(sizeBytes) && sizeBytes > 0 && sizeBytes <= maxBytesForKind(kind);
}

/** Bytes the account must free before `newBytes` fit. 0 when it already fits. */
export function computeMissingBytes(
  usage: { capacityBytes: number; usedBytes: number; reservedBytes: number },
  newBytes: number,
): number {
  const committed = usage.usedBytes + usage.reservedBytes + newBytes;
  return Math.max(0, committed - usage.capacityBytes);
}

/** `videos/<userId>/<assetId>/<revisionId>.<ext>` or `img/…` — one prefix per account. */
export function buildRevisionStorageKey(params: {
  userId: string;
  assetId: string;
  revisionId: string;
  kind: CloudAssetKind;
  contentType: string;
}): string {
  const prefix = params.kind === "screenshot" ? "img" : "videos";
  return `${prefix}/${params.userId}/${params.assetId}/${params.revisionId}.${extensionForContentType(params.contentType)}`;
}

export function buildThumbnailStorageKey(params: {
  userId: string;
  assetId: string;
  revisionId: string;
  kind: CloudAssetKind;
}): string {
  const prefix = params.kind === "screenshot" ? "img" : "videos";
  return `${prefix}/${params.userId}/${params.assetId}/${params.revisionId}.thumb.jpg`;
}

/** Every key an account can own lives under one of these — used by the purge. */
export function accountPrefixes(userId: string): string[] {
  return [`videos/${userId}/`, `img/${userId}/`];
}

export function toAssetSummary(asset: CloudAsset, current: CloudRevision | null): CloudAssetSummary {
  return {
    assetId: asset.assetId,
    kind: asset.kind,
    title: asset.title,
    currentRevisionId: asset.currentRevisionId,
    contentType: current?.contentType ?? null,
    sizeBytes: current?.sizeBytes ?? null,
    contentSha256: current?.contentSha256 ?? null,
    durationSeconds: asset.durationSeconds,
    hasThumbnail: current?.thumbnailKey !== null && current?.thumbnailKey !== undefined,
    derivedFromAssetId: asset.derivedFromAssetId,
    autoUploadExcluded: asset.autoUploadExcluded,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

// --- Errors ----------------------------------------------------------------

export class QuotaExceededError extends Error {
  constructor(public readonly missingBytes: number) {
    super(`Not enough cloud space: ${missingBytes} more bytes are needed`);
    this.name = "QuotaExceededError";
  }
}
export class FileTooLargeError extends Error {
  constructor(public readonly limitBytes: number) {
    super(`File exceeds the per-file limit of ${limitBytes} bytes`);
    this.name = "FileTooLargeError";
  }
}
export class UnsupportedContentTypeError extends Error {
  constructor(contentType: string) {
    super(`Unsupported content type "${contentType}"`);
    this.name = "UnsupportedContentTypeError";
  }
}
export class TooManyPendingUploadsError extends Error {
  constructor(limit: number) {
    super(`Too many uploads in progress (limit ${limit})`);
    this.name = "TooManyPendingUploadsError";
  }
}
export class UploadsDisabledError extends Error {
  constructor() {
    super("New cloud uploads are temporarily disabled");
    this.name = "UploadsDisabledError";
  }
}
export class CloudAccessDeniedError extends Error {
  constructor() {
    super("This account does not have cloud upload access");
    this.name = "CloudAccessDeniedError";
  }
}
export type UploadVerificationReason = "missing" | "size" | "content-type" | "checksum" | "thumbnail";
export class UploadVerificationError extends Error {
  constructor(public readonly reason: UploadVerificationReason) {
    super(`Uploaded object does not match the declared revision (${reason})`);
    this.name = "UploadVerificationError";
  }
}
export class AssetConflictError extends Error {
  constructor(message = "Asset state conflicts with this request") {
    super(message);
    this.name = "AssetConflictError";
  }
}
export class RevisionNotReadyError extends Error {
  constructor() {
    super("The revision is not ready");
    this.name = "RevisionNotReadyError";
  }
}
```

Add to `packages/domain/src/schemas/index.ts` (keep the existing recording/subscription/pagination
blocks for now — Task 12 deletes the recording block):

```ts
// Cloud assets + revisions (optional cloud)
export {
  cloudAssetKindSchema,
  REVISION_STATUSES,
  revisionStatusSchema,
  cloudAssetSchema,
  cloudRevisionSchema,
  cloudAssetSummarySchema,
  createUploadIntentSchema,
  storageUsageSchema,
  SUPPORTED_CONTENT_TYPES,
  isSupportedContentType,
  isValidUploadSize,
  computeMissingBytes,
  buildRevisionStorageKey,
  buildThumbnailStorageKey,
  accountPrefixes,
  toAssetSummary,
  QuotaExceededError,
  FileTooLargeError,
  UnsupportedContentTypeError,
  TooManyPendingUploadsError,
  UploadsDisabledError,
  CloudAccessDeniedError,
  UploadVerificationError,
  AssetConflictError,
  RevisionNotReadyError,
  type RevisionStatus,
  type CloudAsset,
  type CloudRevision,
  type CloudAssetSummary,
  type CreateUploadIntent,
  type StorageUsage,
  type UploadVerificationReason,
} from "./cloud-asset";
```

Note: `recording.ts` also exports an `extensionForContentType`. Do **not** re-export the new one
from the barrel until Task 12 removes `recording.ts`; import it from `./cloud-asset` directly
where needed inside the domain.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test --filter=@kaipu/domain && bun run check-types --filter=@kaipu/domain`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/schemas
git commit -m "feat(domain): cloud asset, revision and upload-intent schemas with quota rules"
```

---

### Task 4: Domain + application — cloud entitlements

**Files:**

- Modify: `packages/domain/src/schemas/subscription.ts`
- Modify: `packages/domain/src/schemas/subscription.test.ts`
- Modify: `packages/application/src/entitlements/get-entitlements.ts`
- Modify: `packages/application/src/entitlements/entitlements.test.ts`
- Create: `packages/domain/src/repositories/cloud-access.repository.ts`
- Modify: `packages/domain/src/repositories/index.ts`

**Interfaces:**

- Produces: `Entitlements.features.cloudUploads: boolean`, `Entitlements.features.cloudStorageBytes: number`;
  `deriveEntitlements(sub, now, access: { cloudAccess: boolean })`;
  `ICloudAccessRepository { hasAccess(userId): Promise<boolean>; getControl(): Promise<{ uploadsEnabled: boolean }> }`;
  `getEntitlements({ repo, cloudAccessRepo, userId, now? })`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/domain/src/schemas/subscription.test.ts`:

```ts
describe("cloud entitlements", () => {
  const now = new Date("2026-09-10T00:00:00Z");
  const pro = {
    id: "s1", userId: "u1", plan: "pro" as const, status: "active" as const,
    currentPeriodEnd: null, provider: "manual" as const, providerRef: null,
    createdAt: now, updatedAt: now,
  };

  it("free accounts get 1 GB; cloudUploads follows the access grant, not the plan", () => {
    const e = deriveEntitlements(null, now, { cloudAccess: false });
    expect(e.features.cloudStorageBytes).toBe(1_000_000_000);
    expect(e.features.cloudUploads).toBe(false);
    expect(deriveEntitlements(null, now, { cloudAccess: true }).features.cloudUploads).toBe(true);
  });

  it("pro in force gets 25 GB; a lapsed pro falls back to 1 GB", () => {
    expect(deriveEntitlements(pro, now, { cloudAccess: true }).features.cloudStorageBytes).toBe(25_000_000_000);
    const lapsed = { ...pro, currentPeriodEnd: new Date("2026-01-01T00:00:00Z") };
    expect(deriveEntitlements(lapsed, now, { cloudAccess: true }).features.cloudStorageBytes).toBe(1_000_000_000);
  });

  it("FREE_ENTITLEMENTS carries the cloud fields", () => {
    expect(FREE_ENTITLEMENTS.features).toEqual({
      watermarkRemoval: false, cloudUploads: false, cloudStorageBytes: 1_000_000_000,
    });
  });
});
```

(Import `deriveEntitlements` and `FREE_ENTITLEMENTS` at the top of the test file if not already.)

Append to `packages/application/src/entitlements/entitlements.test.ts`:

```ts
it("composes billing with the cloud access grant", async () => {
  const repo = makeFakeRepo([]);
  const cloudAccessRepo = { hasAccess: async () => true, getControl: async () => ({ uploadsEnabled: true }) };
  const e = await getEntitlements({ repo, cloudAccessRepo, userId: "u1" });
  expect(e.features.cloudUploads).toBe(true);
  expect(e.features.cloudStorageBytes).toBe(1_000_000_000);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test --filter=@kaipu/domain --filter=@kaipu/application`
Expected: FAIL — `cloudStorageBytes` undefined / `deriveEntitlements` arity.

- [ ] **Step 3: Implement**

In `packages/domain/src/schemas/subscription.ts`:

```ts
import { FREE_CLOUD_CAPACITY_BYTES, PRO_CLOUD_CAPACITY_BYTES } from "../constants/cloud-limits";

export const entitlementsSchema = z.object({
  plan: planSchema,
  status: subscriptionStatusSchema,
  currentPeriodEnd: z.date().nullable(),
  features: z.object({
    watermarkRemoval: z.boolean(),
    /** May this account create upload intents (beta access grant). */
    cloudUploads: z.boolean(),
    /** Total cloud capacity in decimal bytes. Read/delete never depends on it. */
    cloudStorageBytes: z.number().int().nonnegative(),
  }),
});

export const FREE_ENTITLEMENTS: Entitlements = {
  plan: "free",
  status: "active",
  currentPeriodEnd: null,
  features: { watermarkRemoval: false, cloudUploads: false, cloudStorageBytes: FREE_CLOUD_CAPACITY_BYTES },
};

export interface EntitlementInputs {
  /** From the cloud access allowlist (`cloud_access`), not from billing. */
  cloudAccess: boolean;
}

export function deriveEntitlements(
  sub: SubscriptionBase | null,
  now: Date,
  inputs: EntitlementInputs = { cloudAccess: false },
): Entitlements {
  const inForce = sub ? isSubscriptionInForce(sub, now) : false;
  const proInForce = inForce && sub?.plan === "pro";
  return {
    plan: sub?.plan ?? "free",
    status: sub?.status ?? "active",
    currentPeriodEnd: sub?.currentPeriodEnd ?? null,
    features: {
      watermarkRemoval: proInForce,
      cloudUploads: inputs.cloudAccess,
      cloudStorageBytes: proInForce ? PRO_CLOUD_CAPACITY_BYTES : FREE_CLOUD_CAPACITY_BYTES,
    },
  };
}
```

(Delete the previous `deriveEntitlements` body; the `null → FREE_ENTITLEMENTS` shortcut is
subsumed. Existing tests asserting `deriveEntitlements(null, now)` equals `FREE_ENTITLEMENTS`
still pass because the default input yields the same object shape.)

Create `packages/domain/src/repositories/cloud-access.repository.ts`:

```ts
/**
 * Beta allowlist + operator switch for cloud uploads. Rows are written by hand
 * (SQL), never through the API — same rule as manual `pro` grants.
 */
export interface CloudControl {
  /** When false the server issues no new upload tickets; reads and deletes keep working. */
  uploadsEnabled: boolean;
}

export interface ICloudAccessRepository {
  hasAccess(userId: string): Promise<boolean>;
  getControl(): Promise<CloudControl>;
}
```

Add to `packages/domain/src/repositories/index.ts`:

```ts
export type { ICloudAccessRepository, CloudControl } from "./cloud-access.repository";
```

Replace `packages/application/src/entitlements/get-entitlements.ts`:

```ts
import type { ICloudAccessRepository, ISubscriptionRepository } from "@kaipu/domain/repositories";
import { deriveEntitlements, type Entitlements } from "@kaipu/domain/schemas";

/**
 * What the caller may do right now. Billing and the cloud allowlist are read
 * here and nowhere else; the API route and the desktop never see either row.
 */
export async function getEntitlements(params: {
  repo: ISubscriptionRepository;
  cloudAccessRepo: ICloudAccessRepository;
  userId: string;
  now?: Date;
}): Promise<Entitlements> {
  const [subscription, cloudAccess] = await Promise.all([
    params.repo.findByUserId(params.userId),
    params.cloudAccessRepo.hasAccess(params.userId),
  ]);
  return deriveEntitlements(subscription, params.now ?? new Date(), { cloudAccess });
}
```

Update the existing calls in `entitlements.test.ts` to pass a `cloudAccessRepo` fake
(`{ hasAccess: async () => false, getControl: async () => ({ uploadsEnabled: true }) }`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test --filter=@kaipu/domain --filter=@kaipu/application && bun run check-types --filter=@kaipu/domain --filter=@kaipu/application`
Expected: PASS. (`apps/server-hono` type-check will fail on `me.router.ts` until Task 10 — expected.)

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src packages/application/src/entitlements
git commit -m "feat(domain): cloud upload access and capacity in entitlements"
```

---

### Task 5: Domain ports — asset repository and restricted storage tickets

**Files:**

- Create: `packages/domain/src/repositories/cloud-asset.repository.ts`
- Modify: `packages/domain/src/repositories/index.ts`
- Modify: `packages/domain/src/services/storage.service.ts`
- Modify: `packages/domain/src/services/index.ts`

**Interfaces:**

- Produces `ICloudAssetRepository` (below) and the storage port additions
  `createUploadTicket`, `headObject`, `listObjectKeys`, `deleteObjects`. The old `createUploadUrl`
  and `objectExists` stay until Task 12.

- [ ] **Step 1: Write the repository port**

```ts
// packages/domain/src/repositories/cloud-asset.repository.ts
import type { CloudAsset, CloudRevision } from "../schemas/cloud-asset";
import type { CloudAssetKind } from "../constants/cloud-limits";

/** Everything needed to reserve quota and insert the `reserved` revision atomically. */
export interface ReserveRevisionData {
  userId: string;
  assetId: string;
  intentKey: string;
  revisionId: string;
  kind: CloudAssetKind;
  title: string;
  durationSeconds: number;
  derivedFromAssetId: string | null;
  storageKey: string;
  thumbnailKey: string | null;
  contentType: string;
  sizeBytes: number;
  thumbnailBytes: number;
  contentSha256: string;
  /** sizeBytes + thumbnailBytes. */
  reservedBytes: number;
  ticketExpiresAt: Date;
  /** Quota ceiling for this account right now (from entitlements). */
  capacityBytes: number;
  /** `MAX_PENDING_UPLOADS_PER_ACCOUNT`, passed in so the repo stays policy-free. */
  maxPending: number;
}

export type ReserveOutcome =
  | { kind: "reserved"; asset: CloudAsset; revision: CloudRevision }
  | { kind: "quota-exceeded"; usedBytes: number; reservedBytes: number }
  | { kind: "too-many-pending" };

export interface AccountUsage {
  usedBytes: number;
  reservedBytes: number;
  pendingUploads: number;
}

export interface AssetPage {
  items: Array<{ asset: CloudAsset; current: CloudRevision | null }>;
  nextCursor: string | null;
}

export interface ICloudAssetRepository {
  /** Atomic: upserts the asset, reserves `reservedBytes` on the accounting row, inserts the revision. */
  reserve(data: ReserveRevisionData): Promise<ReserveOutcome>;
  /** The revision created for this (user, intentKey), if any — idempotent retries. */
  findByIntentKey(userId: string, intentKey: string): Promise<CloudRevision | null>;
  findRevision(userId: string, assetId: string, revisionId: string): Promise<CloudRevision | null>;
  findAsset(userId: string, assetId: string): Promise<{ asset: CloudAsset; current: CloudRevision | null } | null>;
  /** Extend the ticket window of a still-`reserved` revision (re-issued ticket). */
  extendTicket(userId: string, revisionId: string, ticketExpiresAt: Date): Promise<void>;
  /**
   * `reserved` → `ready`: moves `reservedBytes` from reserved to used, decrements pending,
   * points the asset at this revision. No-op (returns the row) when already `ready`.
   */
  markReady(userId: string, revisionId: string, verifiedAt: Date): Promise<CloudRevision | null>;
  /** `reserved` → `expired`: releases the reservation. No-op when not `reserved`. */
  release(userId: string, revisionId: string): Promise<CloudRevision | null>;
  /** `ready` → `deleting`: clears the asset's current pointer if it was this revision. */
  beginDelete(userId: string, revisionId: string): Promise<CloudRevision | null>;
  /** `deleting` → `deleted`: subtracts `reservedBytes` from used. No-op when not `deleting`. */
  finishDelete(userId: string, revisionId: string): Promise<CloudRevision | null>;
  setAutoUploadExcluded(userId: string, assetId: string, excluded: boolean): Promise<CloudAsset | null>;
  /** Assets with a current ready revision, newest first, keyset-paginated. */
  listAssets(userId: string, params: { cursor: string | null; limit: number }): Promise<AssetPage>;
  usage(userId: string): Promise<AccountUsage>;
  /** Recompute the accounting row from revision rows (sweep + operator tool). */
  reconcile(userId: string): Promise<AccountUsage>;
  // --- sweep queries (cross-account, no owner scope) ---
  listReservedExpiredBefore(before: Date, limit: number): Promise<CloudRevision[]>;
  listDeleting(limit: number): Promise<CloudRevision[]>;
  /** Users whose accounting row was touched since `since` — candidates for `reconcile`. */
  listAccountsTouchedSince(since: Date, limit: number): Promise<string[]>;
}

/** Account purge queue, filled by the auth `beforeDelete` hook and drained by the sweep. */
export interface PurgeJob {
  id: string;
  userId: string;
  attempts: number;
  createdAt: Date;
}
export interface ICloudPurgeRepository {
  enqueue(userId: string): Promise<void>;
  nextPending(limit: number): Promise<PurgeJob[]>;
  markAttempt(id: string, error: string | null): Promise<void>;
  markDone(id: string): Promise<void>;
}
```

Add to `packages/domain/src/repositories/index.ts`:

```ts
export type {
  ICloudAssetRepository,
  ICloudPurgeRepository,
  ReserveRevisionData,
  ReserveOutcome,
  AccountUsage,
  AssetPage,
  PurgeJob,
} from "./cloud-asset.repository";
```

- [ ] **Step 2: Extend the storage port**

Replace `packages/domain/src/services/storage.service.ts`:

```ts
/**
 * A cloud object store port (implemented by `@kaipu/infra-storage` over R2).
 * The application layer depends only on this interface, never on R2 directly.
 */

export interface CreateUploadUrlOptions {
  contentType?: string;
  expiresInSeconds?: number;
}

export interface CreateDownloadUrlOptions {
  expiresInSeconds?: number;
}

/**
 * A restricted ticket. The signature covers every header in `headers`; the
 * client must send them byte-for-byte or storage rejects the request. That is
 * what bounds the write to exactly the declared object.
 */
export interface UploadTicketRequest {
  contentType: string;
  contentLength: number;
  /** base64 sha256 of the body; storage validates it on write. */
  checksumSha256: string;
  expiresInSeconds: number;
}

export interface UploadTicket {
  url: string;
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface ObjectMetadata {
  sizeBytes: number;
  contentType: string | null;
  etag: string | null;
  /** base64 sha256 as stored by the checksum header on PUT; null when absent. */
  checksumSha256: string | null;
}

export interface IStorageService {
  /** @deprecated removed in Task 12 — use `createUploadTicket`. */
  createUploadUrl(key: string, options?: CreateUploadUrlOptions): Promise<string>;
  /** Presigned PUT bound to key + length + type + sha256 + no-overwrite. */
  createUploadTicket(key: string, request: UploadTicketRequest): Promise<UploadTicket>;
  /** A presigned GET URL to download the object. */
  createDownloadUrl(key: string, options?: CreateDownloadUrlOptions): Promise<string>;
  /** @deprecated removed in Task 12 — use `headObject`. */
  objectExists(key: string): Promise<boolean>;
  /** Metadata of the stored object, or null when it does not exist. */
  headObject(key: string): Promise<ObjectMetadata | null>;
  /** Remove one object (idempotent: a missing object is success). */
  deleteObject(key: string): Promise<void>;
  /** Keys under a prefix, one page at a time. */
  listObjectKeys(prefix: string, cursor?: string): Promise<{ keys: string[]; nextCursor: string | null }>;
}
```

Replace `packages/domain/src/services/index.ts`:

```ts
export type {
  IStorageService,
  CreateUploadUrlOptions,
  CreateDownloadUrlOptions,
  UploadTicketRequest,
  UploadTicket,
  ObjectMetadata,
} from "./storage.service";
```

- [ ] **Step 3: Type-check** — `bun run check-types --filter=@kaipu/domain`. Expected: no errors.
      (`@kaipu/infra-storage` and the application test fake now fail to type-check — fixed in Task 6 and Task 9.)

- [ ] **Step 4: Commit**

```bash
git add packages/domain/src/repositories packages/domain/src/services
git commit -m "feat(domain): cloud asset repository port and restricted upload ticket port"
```

---

### Task 6: Infra storage — restricted tickets, HEAD metadata, list

**Files:**

- Modify: `packages/infra-storage/src/r2-storage.ts`
- Modify: `packages/infra-storage/src/r2-storage.test.ts`

**Interfaces:**

- Consumes: Task 5 port. Produces: the four new methods on `createR2Storage(...)`.

- [ ] **Step 1: Write the failing tests** (append to `r2-storage.test.ts`)

```ts
describe("createR2Storage.createUploadTicket", () => {
  it("signs content-length, content-type, if-none-match and the sha256 checksum", async () => {
    const ticket = await storage.createUploadTicket("videos/u1/a1/r1.mp4", {
      contentType: "video/mp4",
      contentLength: 1234,
      checksumSha256: "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
      expiresInSeconds: 900,
    });
    const parsed = new URL(ticket.url);
    const signed = parsed.searchParams.get("X-Amz-SignedHeaders") ?? "";
    for (const h of ["content-length", "content-type", "if-none-match", "x-amz-checksum-sha256"]) {
      expect(signed).toContain(h);
    }
    expect(ticket.headers).toEqual({
      "content-type": "video/mp4",
      "content-length": "1234",
      "if-none-match": "*",
      "x-amz-checksum-sha256": "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
    });
    expect(parsed.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(ticket.expiresAt.getTime()).toBeGreaterThan(Date.now() + 800_000);
  });
});

describe("createR2Storage.headObject", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses size, type, etag and checksum from a HEAD response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 200,
          headers: {
            "content-length": "1234",
            "content-type": "video/mp4",
            etag: '"abc"',
            "x-amz-checksum-sha256": "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
          },
        }),
      ),
    );
    await expect(storage.headObject("videos/u1/a1/r1.mp4")).resolves.toEqual({
      sizeBytes: 1234,
      contentType: "video/mp4",
      etag: '"abc"',
      checksumSha256: "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
    });
    // The checksum is only returned when the request asks for it.
    const init = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("x-amz-checksum-mode")).toBe("ENABLED");
  });

  it("returns null on 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(storage.headObject("k")).resolves.toBeNull();
  });
});

describe("createR2Storage.listObjectKeys", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses ListObjectsV2 keys and the continuation token", async () => {
    const xml = `<?xml version="1.0"?><ListBucketResult><IsTruncated>true</IsTruncated>
      <NextContinuationToken>tok&amp;1</NextContinuationToken>
      <Contents><Key>videos/u1/a1/r1.mp4</Key></Contents><Contents><Key>videos/u1/a1/r1.thumb.jpg</Key></Contents>
      </ListBucketResult>`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(xml, { status: 200 })));
    await expect(storage.listObjectKeys("videos/u1/")).resolves.toEqual({
      keys: ["videos/u1/a1/r1.mp4", "videos/u1/a1/r1.thumb.jpg"],
      nextCursor: "tok&1",
    });
    const url = new URL(String(vi.mocked(fetch).mock.calls[0]?.[0]));
    expect(url.searchParams.get("list-type")).toBe("2");
    expect(url.searchParams.get("prefix")).toBe("videos/u1/");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `bun run test --filter=@kaipu/infra-storage`. Expected: FAIL (`createUploadTicket is not a function`).

- [ ] **Step 3: Implement** (add inside the object returned by `createR2Storage`; keep the existing methods)

```ts
    async createUploadTicket(key: string, request: UploadTicketRequest): Promise<UploadTicket> {
      const headers: Record<string, string> = {
        "content-type": request.contentType,
        "content-length": String(request.contentLength),
        // Refuse to overwrite an object that already exists at this key: a reused or
        // leaked ticket can never replace a ready revision (R2 answers 412).
        "if-none-match": "*",
        // R2 validates the body against this digest on write and stores it.
        "x-amz-checksum-sha256": request.checksumSha256,
      };
      const url = new URL(objectUrl(key));
      url.searchParams.set("X-Amz-Expires", String(request.expiresInSeconds));
      const signed = await client.sign(url.toString(), {
        method: "PUT",
        headers,
        aws: { signQuery: true, allHeaders: true },
      });
      return {
        url: signed.url,
        headers,
        expiresAt: new Date(Date.now() + request.expiresInSeconds * 1000),
      };
    },

    async headObject(key: string): Promise<ObjectMetadata | null> {
      const res = await client.fetch(objectUrl(key), {
        method: "HEAD",
        headers: { "x-amz-checksum-mode": "ENABLED" },
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`R2 head failed for "${key}": ${res.status} ${res.statusText}`);
      const length = Number(res.headers.get("content-length"));
      return {
        sizeBytes: Number.isFinite(length) ? length : 0,
        contentType: res.headers.get("content-type"),
        etag: res.headers.get("etag"),
        checksumSha256: res.headers.get("x-amz-checksum-sha256"),
      };
    },

    async listObjectKeys(prefix: string, cursor?: string) {
      const url = new URL(`${endpoint}/${config.bucket}`);
      url.searchParams.set("list-type", "2");
      url.searchParams.set("prefix", prefix);
      url.searchParams.set("max-keys", "1000");
      if (cursor) url.searchParams.set("continuation-token", cursor);
      const res = await client.fetch(url.toString(), { method: "GET" });
      if (!res.ok) throw new Error(`R2 list failed for "${prefix}": ${res.status} ${res.statusText}`);
      const xml = await res.text();
      const keys = [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) => decodeXml(m[1] ?? ""));
      const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
      const token = xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/);
      return { keys, nextCursor: truncated && token ? decodeXml(token[1] ?? "") : null };
    },
```

Add the helper at module level and the new imports from `@kaipu/domain/services`
(`ObjectMetadata`, `UploadTicket`, `UploadTicketRequest`):

```ts
function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
```

- [ ] **Step 4: Run tests** — `bun run test --filter=@kaipu/infra-storage && bun run check-types --filter=@kaipu/infra-storage`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/infra-storage/src
git commit -m "feat(infra-storage): restricted upload tickets, HEAD metadata and prefix listing on R2"
```

---

### Task 7: Infra DB — cloud schema

**Files:**

- Create: `packages/infra-db/src/schema/cloud.ts`
- Modify: `packages/infra-db/src/schema/index.ts`

**Interfaces:**

- Produces Drizzle tables `cloudAssetTable`, `cloudRevisionTable`, `cloudStorageAccountTable`,
  `cloudAccessTable`, `cloudControlTable`, `cloudPurgeTable` (physical names prefixed `kaipu_record_`).

- [ ] **Step 1: Write the schema**

```ts
// packages/infra-db/src/schema/cloud.ts
import { relations } from "drizzle-orm";
import { bigint, boolean, index, integer, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createTable } from "../utils/table-creator";
import { userTable } from "./auth";

/**
 * One row per logical library item the account has ever uploaded. The id is minted
 * by the client (the desktop sidecar) so a re-upload after "remove local download"
 * lands on the same asset. Primary key is (user, asset) so a stranger claiming a
 * known id only collides inside their own account.
 */
export const cloudAssetTable = createTable(
  "cloud_asset",
  {
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    assetId: text("asset_id").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    /** The ready revision clients download; null until the first confirm. */
    currentRevisionId: text("current_revision_id"),
    durationSeconds: integer("duration_seconds").default(0).notNull(),
    derivedFromAssetId: text("derived_from_asset_id"),
    /** Set when the user deletes the cloud copy; automatic upload must skip it until re-upload. */
    autoUploadExcluded: boolean("auto_upload_excluded").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.assetId] }),
    index("cloud_asset_user_created_idx").on(t.userId, t.createdAt),
  ],
);

/** Immutable bytes. Status transitions are the whole lifecycle — see domain `REVISION_STATUSES`. */
export const cloudRevisionTable = createTable(
  "cloud_revision",
  {
    revisionId: text("revision_id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    assetId: text("asset_id").notNull(),
    /** Client idempotency key; unique per account. */
    intentKey: text("intent_key").notNull(),
    status: text("status").default("reserved").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    thumbnailKey: text("thumbnail_key"),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    thumbnailBytes: integer("thumbnail_bytes").default(0).notNull(),
    contentSha256: text("content_sha256").notNull(),
    reservedBytes: bigint("reserved_bytes", { mode: "number" }).notNull(),
    ticketExpiresAt: timestamp("ticket_expires_at").notNull(),
    verifiedAt: timestamp("verified_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex("cloud_revision_user_intent_idx").on(t.userId, t.intentKey),
    index("cloud_revision_user_asset_idx").on(t.userId, t.assetId),
    index("cloud_revision_status_ticket_idx").on(t.status, t.ticketExpiresAt),
  ],
);

/**
 * Per-account accounting. Quota is enforced with ONE conditional UPDATE on this row
 * (`used + reserved + new <= capacity`), which Postgres serialises through the row
 * lock — no interactive transaction needed on the HTTP driver. Revision rows remain
 * the source of truth; `reconcile()` rebuilds these counters from them.
 */
export const cloudStorageAccountTable = createTable("cloud_storage_account", {
  userId: text("user_id")
    .primaryKey()
    .references(() => userTable.id, { onDelete: "cascade" }),
  usedBytes: bigint("used_bytes", { mode: "number" }).default(0).notNull(),
  reservedBytes: bigint("reserved_bytes", { mode: "number" }).default(0).notNull(),
  pendingUploads: integer("pending_uploads").default(0).notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

/** Beta allowlist. Written by hand (SQL). A row with `revoked_at` set grants nothing. */
export const cloudAccessTable = createTable("cloud_access", {
  userId: text("user_id")
    .primaryKey()
    .references(() => userTable.id, { onDelete: "cascade" }),
  grantedAt: timestamp("granted_at").defaultNow().notNull(),
  revokedAt: timestamp("revoked_at"),
  note: text("note"),
});

/** Single-row operator switches. `id` is always "global". */
export const cloudControlTable = createTable("cloud_control", {
  id: text("id").primaryKey(),
  uploadsEnabled: boolean("uploads_enabled").default(true).notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

/**
 * Account purge queue. No FK: the user row is already gone when the sweep runs.
 * Holds the user id only — the prefixes are derived by `accountPrefixes(userId)`.
 */
export const cloudPurgeTable = createTable("cloud_purge", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull(),
  attempts: integer("attempts").default(0).notNull(),
  lastError: text("last_error"),
  doneAt: timestamp("done_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const cloudAssetRelations = relations(cloudAssetTable, ({ one }) => ({
  user: one(userTable, { fields: [cloudAssetTable.userId], references: [userTable.id] }),
}));
```

Add `export * from "./cloud";` to `packages/infra-db/src/schema/index.ts`.

- [ ] **Step 2: Apply to the dev database and review the SQL**

Run: `bun run db:push` (from the root; uses `apps/server-hono/.env`). Expected: the six
`kaipu_record_cloud_*` tables exist (`bun run db:studio` to inspect).
Run: `bun run db:generate` and review `packages/infra-db/src/migrations/*.sql`; commit it as the
repeatable migration artifact production will apply (`bun run db:migrate`) — see
`backlog/production-cloud-security.md` item 4.

- [ ] **Step 3: Seed the control row** (dev DB, via `db:studio` or psql):

```sql
INSERT INTO kaipu_record_cloud_control (id, uploads_enabled) VALUES ('global', true)
ON CONFLICT (id) DO NOTHING;
```

- [ ] **Step 4: Commit**

```bash
git add packages/infra-db/src/schema packages/infra-db/src/migrations
git commit -m "feat(infra-db): cloud asset, revision, accounting, access, control and purge tables"
```

---

### Task 8: Infra DB — repositories with atomic reservation, plus a real-DB concurrency test

**Files:**

- Create: `packages/infra-db/src/repositories/cloud-asset.repository.ts`
- Create: `packages/infra-db/src/repositories/cloud-access.repository.ts`
- Create: `packages/infra-db/src/repositories/cloud-purge.repository.ts`
- Create: `packages/infra-db/src/mappers/cloud.mapper.ts`
- Modify: `packages/infra-db/src/repositories/index.ts`, `packages/infra-db/src/mappers/index.ts`
- Create: `packages/infra-db/vitest.integration.config.ts`
- Create: `packages/infra-db/src/integration/cloud-asset.repository.integration.test.ts`
- Modify: `packages/infra-db/package.json` (scripts + vitest devDependency), `apps/server-hono/.env.example` (`TEST_DATABASE_URL`)

**Interfaces:**

- Consumes: Task 5 ports, Task 7 tables.
- Produces: `CloudAssetRepository`, `CloudAccessRepository`, `CloudPurgeRepository` classes
  (constructor `(db: DatabaseClient)`), each implementing its port exactly.

- [ ] **Step 1: Write the mapper**

```ts
// packages/infra-db/src/mappers/cloud.mapper.ts
import type { CloudAsset, CloudRevision } from "@kaipu/domain/schemas";
import type { cloudAssetTable, cloudRevisionTable } from "../schema/cloud";

type AssetRow = typeof cloudAssetTable.$inferSelect;
type RevisionRow = typeof cloudRevisionTable.$inferSelect;

export function mapCloudAssetToDomain(row: AssetRow): CloudAsset {
  return {
    assetId: row.assetId,
    userId: row.userId,
    kind: row.kind as CloudAsset["kind"],
    title: row.title,
    currentRevisionId: row.currentRevisionId,
    durationSeconds: row.durationSeconds,
    derivedFromAssetId: row.derivedFromAssetId,
    autoUploadExcluded: row.autoUploadExcluded,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

export function mapCloudRevisionToDomain(row: RevisionRow): CloudRevision {
  return {
    revisionId: row.revisionId,
    assetId: row.assetId,
    userId: row.userId,
    intentKey: row.intentKey,
    status: row.status as CloudRevision["status"],
    storageKey: row.storageKey,
    thumbnailKey: row.thumbnailKey,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    thumbnailBytes: row.thumbnailBytes,
    contentSha256: row.contentSha256,
    reservedBytes: row.reservedBytes,
    ticketExpiresAt: row.ticketExpiresAt,
    verifiedAt: row.verifiedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
```

- [ ] **Step 2: Write the asset repository**

```ts
// packages/infra-db/src/repositories/cloud-asset.repository.ts
import type {
  AccountUsage,
  AssetPage,
  ICloudAssetRepository,
  ReserveOutcome,
  ReserveRevisionData,
} from "@kaipu/domain/repositories";
import type { CloudAsset, CloudRevision } from "@kaipu/domain/schemas";
import { and, desc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import type { DatabaseClient } from "../client";
import { mapCloudAssetToDomain, mapCloudRevisionToDomain } from "../mappers/cloud.mapper";
import { cloudAssetTable, cloudRevisionTable, cloudStorageAccountTable } from "../schema/cloud";

/** Keyset cursor: "<createdAtMillis>:<assetId>", opaque to clients. */
function encodeCursor(createdAt: Date, assetId: string): string {
  return Buffer.from(`${createdAt.getTime()}:${assetId}`).toString("base64url");
}
function decodeCursor(cursor: string): { createdAt: Date; assetId: string } | null {
  const raw = Buffer.from(cursor, "base64url").toString();
  const sep = raw.indexOf(":");
  if (sep <= 0) return null;
  const ms = Number(raw.slice(0, sep));
  if (!Number.isFinite(ms)) return null;
  return { createdAt: new Date(ms), assetId: raw.slice(sep + 1) };
}

export class CloudAssetRepository implements ICloudAssetRepository {
  constructor(private db: DatabaseClient) {}

  async reserve(data: ReserveRevisionData): Promise<ReserveOutcome> {
    // 1. Make sure the accounting row exists (idempotent).
    await this.db
      .insert(cloudStorageAccountTable)
      .values({ userId: data.userId })
      .onConflictDoNothing();

    // 2. THE quota check. One conditional UPDATE: Postgres takes the row lock, a
    //    concurrent reserve re-evaluates the WHERE after this commits, so two requests
    //    for the last bytes can never both pass. Also enforces the pending cap.
    const [account] = await this.db
      .update(cloudStorageAccountTable)
      .set({
        reservedBytes: sql`${cloudStorageAccountTable.reservedBytes} + ${data.reservedBytes}`,
        pendingUploads: sql`${cloudStorageAccountTable.pendingUploads} + 1`,
      })
      .where(
        and(
          eq(cloudStorageAccountTable.userId, data.userId),
          sql`${cloudStorageAccountTable.usedBytes} + ${cloudStorageAccountTable.reservedBytes} + ${data.reservedBytes} <= ${data.capacityBytes}`,
          sql`${cloudStorageAccountTable.pendingUploads} < ${data.maxPending}`,
        ),
      )
      .returning();

    if (!account) {
      const current = await this.usage(data.userId);
      if (current.pendingUploads >= data.maxPending) return { kind: "too-many-pending" };
      return { kind: "quota-exceeded", usedBytes: current.usedBytes, reservedBytes: current.reservedBytes };
    }

    // 3. Upsert the asset and insert the revision. If either fails, give the bytes back;
    //    if the process dies in between, `reconcile()` (sweep) rebuilds the counters.
    try {
      const [assetRow] = await this.db
        .insert(cloudAssetTable)
        .values({
          userId: data.userId,
          assetId: data.assetId,
          kind: data.kind,
          title: data.title,
          durationSeconds: data.durationSeconds,
          derivedFromAssetId: data.derivedFromAssetId,
        })
        .onConflictDoUpdate({
          target: [cloudAssetTable.userId, cloudAssetTable.assetId],
          set: { title: data.title, durationSeconds: data.durationSeconds, deletedAt: null },
        })
        .returning();
      const [revisionRow] = await this.db
        .insert(cloudRevisionTable)
        .values({
          revisionId: data.revisionId,
          userId: data.userId,
          assetId: data.assetId,
          intentKey: data.intentKey,
          status: "reserved",
          storageKey: data.storageKey,
          thumbnailKey: data.thumbnailKey,
          contentType: data.contentType,
          sizeBytes: data.sizeBytes,
          thumbnailBytes: data.thumbnailBytes,
          contentSha256: data.contentSha256,
          reservedBytes: data.reservedBytes,
          ticketExpiresAt: data.ticketExpiresAt,
        })
        .returning();
      if (!assetRow || !revisionRow) throw new Error("reserve: insert returned no row");
      return {
        kind: "reserved",
        asset: mapCloudAssetToDomain(assetRow),
        revision: mapCloudRevisionToDomain(revisionRow),
      };
    } catch (err) {
      await this.adjust(data.userId, { reservedBytes: -data.reservedBytes, pendingUploads: -1 });
      throw err;
    }
  }

  /** Bounded counter arithmetic — never lets a counter drop below zero. */
  private async adjust(
    userId: string,
    delta: { usedBytes?: number; reservedBytes?: number; pendingUploads?: number },
  ): Promise<void> {
    await this.db
      .update(cloudStorageAccountTable)
      .set({
        usedBytes: sql`greatest(0, ${cloudStorageAccountTable.usedBytes} + ${delta.usedBytes ?? 0})`,
        reservedBytes: sql`greatest(0, ${cloudStorageAccountTable.reservedBytes} + ${delta.reservedBytes ?? 0})`,
        pendingUploads: sql`greatest(0, ${cloudStorageAccountTable.pendingUploads} + ${delta.pendingUploads ?? 0})`,
      })
      .where(eq(cloudStorageAccountTable.userId, userId));
  }

  async findByIntentKey(userId: string, intentKey: string): Promise<CloudRevision | null> {
    const [row] = await this.db
      .select()
      .from(cloudRevisionTable)
      .where(and(eq(cloudRevisionTable.userId, userId), eq(cloudRevisionTable.intentKey, intentKey)))
      .limit(1);
    return row ? mapCloudRevisionToDomain(row) : null;
  }

  async findRevision(userId: string, assetId: string, revisionId: string): Promise<CloudRevision | null> {
    const [row] = await this.db
      .select()
      .from(cloudRevisionTable)
      .where(
        and(
          eq(cloudRevisionTable.userId, userId),
          eq(cloudRevisionTable.assetId, assetId),
          eq(cloudRevisionTable.revisionId, revisionId),
        ),
      )
      .limit(1);
    return row ? mapCloudRevisionToDomain(row) : null;
  }

  async findAsset(userId: string, assetId: string) {
    const [assetRow] = await this.db
      .select()
      .from(cloudAssetTable)
      .where(and(eq(cloudAssetTable.userId, userId), eq(cloudAssetTable.assetId, assetId)))
      .limit(1);
    if (!assetRow) return null;
    const asset = mapCloudAssetToDomain(assetRow);
    const current = asset.currentRevisionId
      ? await this.findRevision(userId, assetId, asset.currentRevisionId)
      : null;
    return { asset, current };
  }

  async extendTicket(userId: string, revisionId: string, ticketExpiresAt: Date): Promise<void> {
    await this.db
      .update(cloudRevisionTable)
      .set({ ticketExpiresAt })
      .where(
        and(
          eq(cloudRevisionTable.userId, userId),
          eq(cloudRevisionTable.revisionId, revisionId),
          eq(cloudRevisionTable.status, "reserved"),
        ),
      );
  }

  /** Transition helper: flips status only from `from`; returns null when the row was not in `from`. */
  private async transition(
    userId: string,
    revisionId: string,
    from: CloudRevision["status"],
    to: CloudRevision["status"],
    extra: Partial<typeof cloudRevisionTable.$inferInsert> = {},
  ): Promise<CloudRevision | null> {
    const [row] = await this.db
      .update(cloudRevisionTable)
      .set({ status: to, ...extra })
      .where(
        and(
          eq(cloudRevisionTable.userId, userId),
          eq(cloudRevisionTable.revisionId, revisionId),
          eq(cloudRevisionTable.status, from),
        ),
      )
      .returning();
    return row ? mapCloudRevisionToDomain(row) : null;
  }

  async markReady(userId: string, revisionId: string, verifiedAt: Date): Promise<CloudRevision | null> {
    const flipped = await this.transition(userId, revisionId, "reserved", "ready", { verifiedAt });
    if (!flipped) {
      // Already ready (idempotent confirm) or not confirmable — report the row as-is, count nothing.
      const [row] = await this.db
        .select()
        .from(cloudRevisionTable)
        .where(and(eq(cloudRevisionTable.userId, userId), eq(cloudRevisionTable.revisionId, revisionId)))
        .limit(1);
      return row && row.status === "ready" ? mapCloudRevisionToDomain(row) : null;
    }
    await this.adjust(userId, {
      usedBytes: flipped.reservedBytes,
      reservedBytes: -flipped.reservedBytes,
      pendingUploads: -1,
    });
    await this.db
      .update(cloudAssetTable)
      .set({ currentRevisionId: revisionId, deletedAt: null })
      .where(and(eq(cloudAssetTable.userId, userId), eq(cloudAssetTable.assetId, flipped.assetId)));
    return flipped;
  }

  async release(userId: string, revisionId: string): Promise<CloudRevision | null> {
    const flipped = await this.transition(userId, revisionId, "reserved", "expired");
    if (!flipped) return null;
    await this.adjust(userId, { reservedBytes: -flipped.reservedBytes, pendingUploads: -1 });
    return flipped;
  }

  async beginDelete(userId: string, revisionId: string): Promise<CloudRevision | null> {
    const flipped = await this.transition(userId, revisionId, "ready", "deleting");
    if (!flipped) return null;
    await this.db
      .update(cloudAssetTable)
      .set({ currentRevisionId: null, autoUploadExcluded: true })
      .where(
        and(
          eq(cloudAssetTable.userId, userId),
          eq(cloudAssetTable.assetId, flipped.assetId),
          eq(cloudAssetTable.currentRevisionId, revisionId),
        ),
      );
    return flipped;
  }

  async finishDelete(userId: string, revisionId: string): Promise<CloudRevision | null> {
    const flipped = await this.transition(userId, revisionId, "deleting", "deleted");
    if (!flipped) return null;
    await this.adjust(userId, { usedBytes: -flipped.reservedBytes });
    return flipped;
  }

  async setAutoUploadExcluded(userId: string, assetId: string, excluded: boolean): Promise<CloudAsset | null> {
    const [row] = await this.db
      .update(cloudAssetTable)
      .set({ autoUploadExcluded: excluded })
      .where(and(eq(cloudAssetTable.userId, userId), eq(cloudAssetTable.assetId, assetId)))
      .returning();
    return row ? mapCloudAssetToDomain(row) : null;
  }

  async listAssets(userId: string, params: { cursor: string | null; limit: number }): Promise<AssetPage> {
    const after = params.cursor ? decodeCursor(params.cursor) : null;
    const rows = await this.db
      .select({ asset: cloudAssetTable, revision: cloudRevisionTable })
      .from(cloudAssetTable)
      .innerJoin(cloudRevisionTable, eq(cloudRevisionTable.revisionId, cloudAssetTable.currentRevisionId))
      .where(
        and(
          eq(cloudAssetTable.userId, userId),
          after
            ? or(
                lt(cloudAssetTable.createdAt, after.createdAt),
                and(eq(cloudAssetTable.createdAt, after.createdAt), lt(cloudAssetTable.assetId, after.assetId)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(cloudAssetTable.createdAt), desc(cloudAssetTable.assetId))
      .limit(params.limit + 1);
    const page = rows.slice(0, params.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({ asset: mapCloudAssetToDomain(r.asset), current: mapCloudRevisionToDomain(r.revision) })),
      nextCursor: rows.length > params.limit && last ? encodeCursor(last.asset.createdAt, last.asset.assetId) : null,
    };
  }

  async usage(userId: string): Promise<AccountUsage> {
    const [row] = await this.db
      .select()
      .from(cloudStorageAccountTable)
      .where(eq(cloudStorageAccountTable.userId, userId))
      .limit(1);
    return row
      ? { usedBytes: row.usedBytes, reservedBytes: row.reservedBytes, pendingUploads: row.pendingUploads }
      : { usedBytes: 0, reservedBytes: 0, pendingUploads: 0 };
  }

  async reconcile(userId: string): Promise<AccountUsage> {
    const [sums] = await this.db
      .select({
        used: sql<number>`coalesce(sum(case when ${cloudRevisionTable.status} in ('ready','deleting') then ${cloudRevisionTable.reservedBytes} else 0 end), 0)::bigint`,
        reserved: sql<number>`coalesce(sum(case when ${cloudRevisionTable.status} = 'reserved' then ${cloudRevisionTable.reservedBytes} else 0 end), 0)::bigint`,
        pending: sql<number>`count(*) filter (where ${cloudRevisionTable.status} = 'reserved')::int`,
      })
      .from(cloudRevisionTable)
      .where(eq(cloudRevisionTable.userId, userId));
    const usage = {
      usedBytes: Number(sums?.used ?? 0),
      reservedBytes: Number(sums?.reserved ?? 0),
      pendingUploads: Number(sums?.pending ?? 0),
    };
    await this.db
      .insert(cloudStorageAccountTable)
      .values({ userId, ...usage })
      .onConflictDoUpdate({ target: cloudStorageAccountTable.userId, set: usage });
    return usage;
  }

  async listReservedExpiredBefore(before: Date, limit: number): Promise<CloudRevision[]> {
    const rows = await this.db
      .select()
      .from(cloudRevisionTable)
      .where(and(eq(cloudRevisionTable.status, "reserved"), lt(cloudRevisionTable.ticketExpiresAt, before)))
      .orderBy(cloudRevisionTable.ticketExpiresAt)
      .limit(limit);
    return rows.map(mapCloudRevisionToDomain);
  }

  async listDeleting(limit: number): Promise<CloudRevision[]> {
    const rows = await this.db
      .select()
      .from(cloudRevisionTable)
      .where(eq(cloudRevisionTable.status, "deleting"))
      .orderBy(cloudRevisionTable.updatedAt)
      .limit(limit);
    return rows.map(mapCloudRevisionToDomain);
  }

  async listAccountsTouchedSince(since: Date, limit: number): Promise<string[]> {
    const rows = await this.db
      .select({ userId: cloudStorageAccountTable.userId })
      .from(cloudStorageAccountTable)
      .where(gt(cloudStorageAccountTable.updatedAt, since))
      .limit(limit);
    return rows.map((r) => r.userId);
  }
}
```

(`inArray` is unused — remove it from the import if the linter complains.)

- [ ] **Step 3: Write the access and purge repositories**

```ts
// packages/infra-db/src/repositories/cloud-access.repository.ts
import type { CloudControl, ICloudAccessRepository } from "@kaipu/domain/repositories";
import { and, eq, isNull } from "drizzle-orm";
import type { DatabaseClient } from "../client";
import { cloudAccessTable, cloudControlTable } from "../schema/cloud";

export class CloudAccessRepository implements ICloudAccessRepository {
  constructor(private db: DatabaseClient) {}

  async hasAccess(userId: string): Promise<boolean> {
    const rows = await this.db
      .select({ userId: cloudAccessTable.userId })
      .from(cloudAccessTable)
      .where(and(eq(cloudAccessTable.userId, userId), isNull(cloudAccessTable.revokedAt)))
      .limit(1);
    return rows.length > 0;
  }

  /** Missing row = uploads enabled: the switch is for stopping, not for starting. */
  async getControl(): Promise<CloudControl> {
    const [row] = await this.db.select().from(cloudControlTable).where(eq(cloudControlTable.id, "global")).limit(1);
    return { uploadsEnabled: row?.uploadsEnabled ?? true };
  }
}
```

```ts
// packages/infra-db/src/repositories/cloud-purge.repository.ts
import type { ICloudPurgeRepository, PurgeJob } from "@kaipu/domain/repositories";
import { eq, isNull, sql } from "drizzle-orm";
import type { DatabaseClient } from "../client";
import { cloudPurgeTable } from "../schema/cloud";

export class CloudPurgeRepository implements ICloudPurgeRepository {
  constructor(private db: DatabaseClient) {}

  async enqueue(userId: string): Promise<void> {
    await this.db.insert(cloudPurgeTable).values({ userId });
  }

  async nextPending(limit: number): Promise<PurgeJob[]> {
    const rows = await this.db
      .select()
      .from(cloudPurgeTable)
      .where(isNull(cloudPurgeTable.doneAt))
      .orderBy(cloudPurgeTable.createdAt)
      .limit(limit);
    return rows.map((r) => ({ id: r.id, userId: r.userId, attempts: r.attempts, createdAt: r.createdAt }));
  }

  async markAttempt(id: string, error: string | null): Promise<void> {
    await this.db
      .update(cloudPurgeTable)
      .set({ attempts: sql`${cloudPurgeTable.attempts} + 1`, lastError: error })
      .where(eq(cloudPurgeTable.id, id));
  }

  async markDone(id: string): Promise<void> {
    await this.db.update(cloudPurgeTable).set({ doneAt: new Date() }).where(eq(cloudPurgeTable.id, id));
  }
}
```

Add to `packages/infra-db/src/repositories/index.ts`:

```ts
export { CloudAssetRepository } from "./cloud-asset.repository";
export { CloudAccessRepository } from "./cloud-access.repository";
export { CloudPurgeRepository } from "./cloud-purge.repository";
```

and to `packages/infra-db/src/mappers/index.ts`: `export * from "./cloud.mapper";`.

- [ ] **Step 4: Type-check** — `bun run check-types --filter=@kaipu/infra-db`. Expected: clean.

- [ ] **Step 5: Add the integration test harness** (real Neon branch, skipped without `TEST_DATABASE_URL`)

`packages/infra-db/vitest.integration.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/integration/**/*.integration.test.ts"],
    // Concurrency tests are the point — never serialise them across files by accident.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
```

`packages/infra-db/package.json` scripts: add
`"test:integration": "vitest run --config vitest.integration.config.ts"` and
`"vitest": "^4.1.9"` to devDependencies. Root `package.json`: add
`"test:integration": "dotenvx run -f apps/server-hono/.env -- turbo run test:integration -F @kaipu/infra-db"`
and a `test:integration` task in `turbo.json` with `"cache": false, "env": ["TEST_DATABASE_URL"]`.
Add `TEST_DATABASE_URL=` to `apps/server-hono/.env.example` with a comment: "a disposable Neon
branch; the integration suite truncates the kaipu*record_cloud*\* tables it uses".

- [ ] **Step 6: Write the integration test**

```ts
// packages/infra-db/src/integration/cloud-asset.repository.integration.test.ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabaseClient } from "../client";
import { CloudAssetRepository } from "../repositories/cloud-asset.repository";
import { cloudAssetTable, cloudRevisionTable, cloudStorageAccountTable } from "../schema/cloud";
import { userTable } from "../schema/auth";

const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;

describeDb("CloudAssetRepository (real database)", () => {
  const db = createDatabaseClient(url ?? "");
  const repo = new CloudAssetRepository(db);
  const USER = "it-cloud-user";

  function reserveData(overrides: Partial<Parameters<typeof repo.reserve>[0]> = {}) {
    const revisionId = crypto.randomUUID();
    return {
      userId: USER,
      assetId: crypto.randomUUID(),
      intentKey: crypto.randomUUID(),
      revisionId,
      kind: "recording" as const,
      title: "it",
      durationSeconds: 1,
      derivedFromAssetId: null,
      storageKey: `videos/${USER}/x/${revisionId}.mp4`,
      thumbnailKey: null,
      contentType: "video/mp4",
      sizeBytes: 600,
      thumbnailBytes: 0,
      contentSha256: "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
      reservedBytes: 600,
      ticketExpiresAt: new Date(Date.now() + 60_000),
      capacityBytes: 1000,
      maxPending: 5,
      ...overrides,
    };
  }

  beforeEach(async () => {
    await db.insert(userTable).values({ id: USER, name: "it", email: `${USER}@example.com` }).onConflictDoNothing();
    await db.delete(cloudRevisionTable).where(eq(cloudRevisionTable.userId, USER));
    await db.delete(cloudAssetTable).where(eq(cloudAssetTable.userId, USER));
    await db.delete(cloudStorageAccountTable).where(eq(cloudStorageAccountTable.userId, USER));
  });

  afterAll(async () => {
    await db.delete(cloudRevisionTable).where(eq(cloudRevisionTable.userId, USER));
    await db.delete(cloudAssetTable).where(eq(cloudAssetTable.userId, USER));
    await db.delete(cloudStorageAccountTable).where(eq(cloudStorageAccountTable.userId, USER));
    await db.delete(userTable).where(eq(userTable.id, USER));
  });

  it("two concurrent reservations competing for the last bytes: exactly one wins", async () => {
    const results = await Promise.all([repo.reserve(reserveData()), repo.reserve(reserveData())]);
    const kinds = results.map((r) => r.kind).sort();
    expect(kinds).toEqual(["quota-exceeded", "reserved"]);
    expect(await repo.usage(USER)).toEqual({ usedBytes: 0, reservedBytes: 600, pendingUploads: 1 });
  });

  it("ready → deleting → deleted settles used bytes once, and repeated finishDelete is a no-op", async () => {
    const r = await repo.reserve(reserveData());
    if (r.kind !== "reserved") throw new Error(r.kind);
    await repo.markReady(USER, r.revision.revisionId, new Date());
    await repo.markReady(USER, r.revision.revisionId, new Date()); // idempotent
    expect(await repo.usage(USER)).toEqual({ usedBytes: 600, reservedBytes: 0, pendingUploads: 0 });

    expect(await repo.beginDelete(USER, r.revision.revisionId)).not.toBeNull();
    expect(await repo.beginDelete(USER, r.revision.revisionId)).toBeNull();
    expect(await repo.finishDelete(USER, r.revision.revisionId)).not.toBeNull();
    expect(await repo.finishDelete(USER, r.revision.revisionId)).toBeNull();
    expect(await repo.usage(USER)).toEqual({ usedBytes: 0, reservedBytes: 0, pendingUploads: 0 });
    expect((await repo.findAsset(USER, r.asset.assetId))?.asset.autoUploadExcluded).toBe(true);
  });

  it("release is idempotent and never drives counters negative", async () => {
    const r = await repo.reserve(reserveData());
    if (r.kind !== "reserved") throw new Error(r.kind);
    await repo.release(USER, r.revision.revisionId);
    await repo.release(USER, r.revision.revisionId);
    expect(await repo.usage(USER)).toEqual({ usedBytes: 0, reservedBytes: 0, pendingUploads: 0 });
  });

  it("enforces the pending cap", async () => {
    await repo.reserve(reserveData({ sizeBytes: 100, reservedBytes: 100, maxPending: 1 }));
    const second = await repo.reserve(reserveData({ sizeBytes: 100, reservedBytes: 100, maxPending: 1 }));
    expect(second.kind).toBe("too-many-pending");
  });

  it("reconcile rebuilds the counters from revision rows", async () => {
    const r = await repo.reserve(reserveData());
    if (r.kind !== "reserved") throw new Error(r.kind);
    await db.update(cloudStorageAccountTable).set({ reservedBytes: 999_999, pendingUploads: 42 })
      .where(eq(cloudStorageAccountTable.userId, USER));
    expect(await repo.reconcile(USER)).toEqual({ usedBytes: 0, reservedBytes: 600, pendingUploads: 1 });
  });

  it("paginates newest-first with a stable keyset cursor", async () => {
    for (let i = 0; i < 3; i += 1) {
      const r = await repo.reserve(reserveData({ sizeBytes: 100, reservedBytes: 100 }));
      if (r.kind !== "reserved") throw new Error(r.kind);
      await repo.markReady(USER, r.revision.revisionId, new Date());
    }
    const page1 = await repo.listAssets(USER, { cursor: null, limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await repo.listAssets(USER, { cursor: page1.nextCursor, limit: 2 });
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
    const ids = [...page1.items, ...page2.items].map((i) => i.asset.assetId);
    expect(new Set(ids).size).toBe(3);
  });
});
```

- [ ] **Step 7: Run it against a disposable Neon branch**

Run: `bun run test:integration` (with `TEST_DATABASE_URL` set in `apps/server-hono/.env`, after
`DATABASE_URL=$TEST_DATABASE_URL bun run db:push` once to create the tables there).
Expected: 6 tests PASS. Without the variable: the suite reports as skipped (CI stays green until
the secret is added — see Task 13).

- [ ] **Step 8: Commit**

```bash
git add packages/infra-db package.json turbo.json apps/server-hono/.env.example
git commit -m "feat(infra-db): cloud asset repositories with atomic quota reservation and real-db concurrency tests"
```

---

### Task 9: Application — cloud use cases over in-memory fakes

**Files:**

- Create: `packages/application/src/cloud/fakes.ts` (test doubles, imported only by tests)
- Create: `packages/application/src/cloud/create-upload-intent.ts`, `confirm-upload.ts`, `cancel-upload.ts`,
  `list-cloud-assets.ts`, `get-asset-download-url.ts`, `delete-cloud-copy.ts`, `get-storage-usage.ts`,
  `set-auto-upload-exclusion.ts`, `sweep-expired-reservations.ts`, `retry-pending-deletes.ts`,
  `purge-account-objects.ts`, `index.ts`
- Test: `packages/application/src/cloud/cloud.test.ts`
- Modify: `packages/application/src/index.ts` (add `export * from "./cloud";`)
- Modify: `packages/application/src/recordings/recordings.test.ts` — add the four new storage
  methods to `makeFakeStorage` so it still satisfies `IStorageService` (deleted in Task 12).

**Interfaces:**

- Consumes: Tasks 2–5.
- Produces (exported from `@kaipu/application`):
  - `createUploadIntent({ assets, access, storage, userId, entitlements, input, now? }) → UploadIntentResult`
  - `confirmUpload({ assets, storage, userId, assetId, revisionId, now? }) → CloudAssetSummary | null`
  - `cancelUpload({ assets, storage, userId, assetId, revisionId }) → { released: boolean } | null`
  - `listCloudAssets({ assets, userId, cursor, limit }) → { items: CloudAssetSummary[]; nextCursor }`
  - `getAssetDownloadUrl({ assets, storage, userId, assetId }) → { asset, downloadUrl, expiresAt } | null`
  - `deleteCloudCopy({ assets, storage, userId, assetId }) → { deleted: boolean } | null`
  - `getStorageUsage({ assets, access, userId, entitlements }) → StorageUsage`
  - `setAutoUploadExclusion({ assets, userId, assetId, excluded }) → CloudAssetSummary | null`
  - `sweepExpiredReservations({ assets, storage, now, limit }) → { released: number; deletedObjects: number }`
  - `retryPendingDeletes({ assets, storage, limit }) → { finished: number; failed: number }`
  - `purgeAccountObjects({ purge, storage, limit, maxAttempts }) → { done: number; failed: number }`
  - `UploadIntentResult` type (see wire contract).

- [ ] **Step 1: Write the fakes**

```ts
// packages/application/src/cloud/fakes.ts
import type {
  AccountUsage,
  AssetPage,
  ICloudAccessRepository,
  ICloudAssetRepository,
  ICloudPurgeRepository,
  PurgeJob,
  ReserveOutcome,
  ReserveRevisionData,
} from "@kaipu/domain/repositories";
import type { CloudAsset, CloudRevision } from "@kaipu/domain/schemas";
import type { IStorageService, ObjectMetadata, UploadTicket, UploadTicketRequest } from "@kaipu/domain/services";

/** In-memory twin of CloudAssetRepository: same transitions, same counters, no SQL. */
export function makeFakeAssets(): ICloudAssetRepository & {
  assets: Map<string, CloudAsset>;
  revisions: Map<string, CloudRevision>;
  accounts: Map<string, AccountUsage>;
} {
  const assets = new Map<string, CloudAsset>();
  const revisions = new Map<string, CloudRevision>();
  const accounts = new Map<string, AccountUsage>();
  const key = (userId: string, assetId: string): string => `${userId}/${assetId}`;
  const account = (userId: string): AccountUsage => {
    let a = accounts.get(userId);
    if (!a) {
      a = { usedBytes: 0, reservedBytes: 0, pendingUploads: 0 };
      accounts.set(userId, a);
    }
    return a;
  };
  const flip = (userId: string, revisionId: string, from: CloudRevision["status"], to: CloudRevision["status"]) => {
    const rev = revisions.get(revisionId);
    if (!rev || rev.userId !== userId || rev.status !== from) return null;
    const next = { ...rev, status: to, updatedAt: new Date() };
    revisions.set(revisionId, next);
    return next;
  };

  return {
    assets,
    revisions,
    accounts,
    async reserve(data: ReserveRevisionData): Promise<ReserveOutcome> {
      const a = account(data.userId);
      if (a.pendingUploads >= data.maxPending) return { kind: "too-many-pending" };
      if (a.usedBytes + a.reservedBytes + data.reservedBytes > data.capacityBytes) {
        return { kind: "quota-exceeded", usedBytes: a.usedBytes, reservedBytes: a.reservedBytes };
      }
      a.reservedBytes += data.reservedBytes;
      a.pendingUploads += 1;
      const now = new Date();
      const existing = assets.get(key(data.userId, data.assetId));
      const asset: CloudAsset = existing
        ? { ...existing, title: data.title, durationSeconds: data.durationSeconds, deletedAt: null, updatedAt: now }
        : {
            assetId: data.assetId, userId: data.userId, kind: data.kind, title: data.title,
            currentRevisionId: null, durationSeconds: data.durationSeconds,
            derivedFromAssetId: data.derivedFromAssetId, autoUploadExcluded: false,
            createdAt: now, updatedAt: now, deletedAt: null,
          };
      assets.set(key(data.userId, data.assetId), asset);
      const revision: CloudRevision = {
        revisionId: data.revisionId, assetId: data.assetId, userId: data.userId, intentKey: data.intentKey,
        status: "reserved", storageKey: data.storageKey, thumbnailKey: data.thumbnailKey,
        contentType: data.contentType, sizeBytes: data.sizeBytes, thumbnailBytes: data.thumbnailBytes,
        contentSha256: data.contentSha256, reservedBytes: data.reservedBytes,
        ticketExpiresAt: data.ticketExpiresAt, verifiedAt: null, createdAt: now, updatedAt: now,
      };
      revisions.set(data.revisionId, revision);
      return { kind: "reserved", asset, revision };
    },
    async findByIntentKey(userId, intentKey) {
      return [...revisions.values()].find((r) => r.userId === userId && r.intentKey === intentKey) ?? null;
    },
    async findRevision(userId, assetId, revisionId) {
      const r = revisions.get(revisionId);
      return r && r.userId === userId && r.assetId === assetId ? r : null;
    },
    async findAsset(userId, assetId) {
      const asset = assets.get(key(userId, assetId));
      if (!asset) return null;
      const current = asset.currentRevisionId ? (revisions.get(asset.currentRevisionId) ?? null) : null;
      return { asset, current };
    },
    async extendTicket(userId, revisionId, ticketExpiresAt) {
      const r = revisions.get(revisionId);
      if (r && r.userId === userId && r.status === "reserved") revisions.set(revisionId, { ...r, ticketExpiresAt });
    },
    async markReady(userId, revisionId, verifiedAt) {
      const flipped = flip(userId, revisionId, "reserved", "ready");
      if (!flipped) {
        const r = revisions.get(revisionId);
        return r && r.userId === userId && r.status === "ready" ? r : null;
      }
      const ready = { ...flipped, verifiedAt };
      revisions.set(revisionId, ready);
      const a = account(userId);
      a.usedBytes += ready.reservedBytes;
      a.reservedBytes = Math.max(0, a.reservedBytes - ready.reservedBytes);
      a.pendingUploads = Math.max(0, a.pendingUploads - 1);
      const asset = assets.get(key(userId, ready.assetId));
      if (asset) assets.set(key(userId, ready.assetId), { ...asset, currentRevisionId: revisionId, deletedAt: null });
      return ready;
    },
    async release(userId, revisionId) {
      const flipped = flip(userId, revisionId, "reserved", "expired");
      if (!flipped) return null;
      const a = account(userId);
      a.reservedBytes = Math.max(0, a.reservedBytes - flipped.reservedBytes);
      a.pendingUploads = Math.max(0, a.pendingUploads - 1);
      return flipped;
    },
    async beginDelete(userId, revisionId) {
      const flipped = flip(userId, revisionId, "ready", "deleting");
      if (!flipped) return null;
      const asset = assets.get(key(userId, flipped.assetId));
      if (asset && asset.currentRevisionId === revisionId) {
        assets.set(key(userId, flipped.assetId), { ...asset, currentRevisionId: null, autoUploadExcluded: true });
      }
      return flipped;
    },
    async finishDelete(userId, revisionId) {
      const flipped = flip(userId, revisionId, "deleting", "deleted");
      if (!flipped) return null;
      const a = account(userId);
      a.usedBytes = Math.max(0, a.usedBytes - flipped.reservedBytes);
      return flipped;
    },
    async setAutoUploadExcluded(userId, assetId, excluded) {
      const asset = assets.get(key(userId, assetId));
      if (!asset) return null;
      const next = { ...asset, autoUploadExcluded: excluded };
      assets.set(key(userId, assetId), next);
      return next;
    },
    async listAssets(userId, params): Promise<AssetPage> {
      const all = [...assets.values()]
        .filter((a) => a.userId === userId && a.currentRevisionId)
        .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime() || (y.assetId < x.assetId ? -1 : 1));
      const start = params.cursor ? Number(params.cursor) : 0;
      const page = all.slice(start, start + params.limit);
      return {
        items: page.map((a) => ({ asset: a, current: revisions.get(a.currentRevisionId ?? "") ?? null })),
        nextCursor: start + params.limit < all.length ? String(start + params.limit) : null,
      };
    },
    async usage(userId) {
      return { ...account(userId) };
    },
    async reconcile(userId) {
      const mine = [...revisions.values()].filter((r) => r.userId === userId);
      const usage = {
        usedBytes: mine.filter((r) => r.status === "ready" || r.status === "deleting").reduce((s, r) => s + r.reservedBytes, 0),
        reservedBytes: mine.filter((r) => r.status === "reserved").reduce((s, r) => s + r.reservedBytes, 0),
        pendingUploads: mine.filter((r) => r.status === "reserved").length,
      };
      accounts.set(userId, usage);
      return { ...usage };
    },
    async listReservedExpiredBefore(before, limit) {
      return [...revisions.values()].filter((r) => r.status === "reserved" && r.ticketExpiresAt < before).slice(0, limit);
    },
    async listDeleting(limit) {
      return [...revisions.values()].filter((r) => r.status === "deleting").slice(0, limit);
    },
    async listAccountsTouchedSince() {
      return [...accounts.keys()];
    },
  };
}

export function makeFakeAccess(opts: { access?: Set<string>; uploadsEnabled?: boolean } = {}): ICloudAccessRepository & {
  uploadsEnabled: boolean;
} {
  const state = { uploadsEnabled: opts.uploadsEnabled ?? true };
  return Object.assign(state, {
    async hasAccess(userId: string) {
      return opts.access?.has(userId) ?? true;
    },
    async getControl() {
      return { uploadsEnabled: state.uploadsEnabled };
    },
  });
}

export function makeFakePurge(): ICloudPurgeRepository & { jobs: PurgeJob[]; done: string[]; errors: string[] } {
  const state = { jobs: [] as PurgeJob[], done: [] as string[], errors: [] as string[] };
  return Object.assign(state, {
    async enqueue(userId: string) {
      state.jobs.push({ id: crypto.randomUUID(), userId, attempts: 0, createdAt: new Date() });
    },
    async nextPending(limit: number) {
      return state.jobs.filter((j) => !state.done.includes(j.id)).slice(0, limit);
    },
    async markAttempt(id: string, error: string | null) {
      const job = state.jobs.find((j) => j.id === id);
      if (job) job.attempts += 1;
      if (error) state.errors.push(error);
    },
    async markDone(id: string) {
      state.done.push(id);
    },
  });
}

/**
 * Fake object store. `objects` models what actually landed: tests "upload" by
 * calling `land(key, metadata)`, never by presigning.
 */
export function makeFakeStorage(): IStorageService & {
  objects: Map<string, ObjectMetadata>;
  tickets: string[];
  downloads: string[];
  deletes: string[];
  failDeletes: boolean;
  land(key: string, meta: Partial<ObjectMetadata> & { sizeBytes: number }): void;
} {
  const state = {
    objects: new Map<string, ObjectMetadata>(),
    tickets: [] as string[],
    downloads: [] as string[],
    deletes: [] as string[],
    failDeletes: false,
  };
  return Object.assign(state, {
    land(key: string, meta: Partial<ObjectMetadata> & { sizeBytes: number }) {
      state.objects.set(key, { contentType: null, etag: null, checksumSha256: null, ...meta });
    },
    async createUploadUrl(key: string) {
      state.tickets.push(key);
      return `https://r2.example/${key}?sig=legacy`;
    },
    async createUploadTicket(key: string, request: UploadTicketRequest): Promise<UploadTicket> {
      state.tickets.push(key);
      return {
        url: `https://r2.example/${key}?sig=up`,
        headers: {
          "content-type": request.contentType,
          "content-length": String(request.contentLength),
          "if-none-match": "*",
          "x-amz-checksum-sha256": request.checksumSha256,
        },
        expiresAt: new Date(Date.now() + request.expiresInSeconds * 1000),
      };
    },
    async createDownloadUrl(key: string) {
      state.downloads.push(key);
      return `https://r2.example/${key}?sig=down`;
    },
    async objectExists(key: string) {
      return state.objects.has(key);
    },
    async headObject(key: string) {
      return state.objects.get(key) ?? null;
    },
    async deleteObject(key: string) {
      if (state.failDeletes) throw new Error("R2 delete failed");
      state.deletes.push(key);
      state.objects.delete(key);
    },
    async listObjectKeys(prefix: string) {
      return { keys: [...state.objects.keys()].filter((k) => k.startsWith(prefix)), nextCursor: null };
    },
  });
}
```

- [ ] **Step 2: Write the failing tests**

```ts
// packages/application/src/cloud/cloud.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { FREE_ENTITLEMENTS, type Entitlements } from "@kaipu/domain/schemas";
import { MAX_PENDING_UPLOADS_PER_ACCOUNT } from "@kaipu/domain/constants";
import { cancelUpload } from "./cancel-upload";
import { confirmUpload } from "./confirm-upload";
import { createUploadIntent } from "./create-upload-intent";
import { deleteCloudCopy } from "./delete-cloud-copy";
import { makeFakeAccess, makeFakeAssets, makeFakePurge, makeFakeStorage } from "./fakes";
import { getAssetDownloadUrl } from "./get-asset-download-url";
import { getStorageUsage } from "./get-storage-usage";
import { listCloudAssets } from "./list-cloud-assets";
import { purgeAccountObjects } from "./purge-account-objects";
import { retryPendingDeletes } from "./retry-pending-deletes";
import { sweepExpiredReservations } from "./sweep-expired-reservations";

const SHA = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";
const NOW = new Date("2026-09-10T12:00:00Z");
const grant: Entitlements = { ...FREE_ENTITLEMENTS, features: { ...FREE_ENTITLEMENTS.features, cloudUploads: true, cloudStorageBytes: 1000 } };

function intent(overrides: Record<string, unknown> = {}) {
  return {
    assetId: crypto.randomUUID(),
    intentKey: crypto.randomUUID(),
    kind: "recording" as const,
    title: "Demo",
    contentType: "video/mp4",
    sizeBytes: 600,
    contentSha256: SHA,
    durationSeconds: 10,
    derivedFromAssetId: null,
    thumbnail: null,
    ...overrides,
  };
}

describe("createUploadIntent", () => {
  let assets: ReturnType<typeof makeFakeAssets>;
  let storage: ReturnType<typeof makeFakeStorage>;
  let access: ReturnType<typeof makeFakeAccess>;
  beforeEach(() => {
    assets = makeFakeAssets();
    storage = makeFakeStorage();
    access = makeFakeAccess();
  });

  it("reserves quota and returns a restricted ticket", async () => {
    const result = await createUploadIntent({ assets, access, storage, userId: "u1", entitlements: grant, input: intent(), now: NOW });
    expect(result.status).toBe("reserved");
    expect(result.ticket?.headers["content-length"]).toBe("600");
    expect(result.ticket?.headers["if-none-match"]).toBe("*");
    expect(result.ticket?.thumbnail).toBeNull();
    expect(await assets.usage("u1")).toEqual({ usedBytes: 0, reservedBytes: 600, pendingUploads: 1 });
    // The response never carries a storage key.
    expect(JSON.stringify(result)).not.toContain("videos/u1");
  });

  it("counts the thumbnail in the reservation and issues a ticket for it", async () => {
    const result = await createUploadIntent({
      assets, access, storage, userId: "u1", entitlements: grant,
      input: intent({ thumbnail: { sizeBytes: 100, contentSha256: SHA } }), now: NOW,
    });
    expect(result.ticket?.thumbnail?.headers["content-length"]).toBe("100");
    expect((await assets.usage("u1")).reservedBytes).toBe(700);
  });

  it("is idempotent on intentKey: same revision, no second reservation", async () => {
    const input = intent();
    const a = await createUploadIntent({ assets, access, storage, userId: "u1", entitlements: grant, input, now: NOW });
    const b = await createUploadIntent({ assets, access, storage, userId: "u1", entitlements: grant, input, now: NOW });
    expect(b.revisionId).toBe(a.revisionId);
    expect((await assets.usage("u1")).reservedBytes).toBe(600);
    expect(b.ticket).not.toBeNull(); // re-issued for the same key
  });

  it("after confirm, repeating the intent reports ready with no ticket", async () => {
    const input = intent();
    const a = await createUploadIntent({ assets, access, storage, userId: "u1", entitlements: grant, input, now: NOW });
    storage.land(assets.revisions.get(a.revisionId)!.storageKey, { sizeBytes: 600, contentType: "video/mp4", checksumSha256: SHA });
    await confirmUpload({ assets, storage, userId: "u1", assetId: input.assetId, revisionId: a.revisionId, now: NOW });
    const b = await createUploadIntent({ assets, access, storage, userId: "u1", entitlements: grant, input, now: NOW });
    expect(b.status).toBe("ready");
    expect(b.ticket).toBeNull();
  });

  it("rejects when committed occupation would exceed capacity, reporting the missing bytes", async () => {
    await createUploadIntent({ assets, access, storage, userId: "u1", entitlements: grant, input: intent(), now: NOW });
    await expect(
      createUploadIntent({ assets, access, storage, userId: "u1", entitlements: grant, input: intent({ sizeBytes: 550 }), now: NOW }),
    ).rejects.toMatchObject({ name: "QuotaExceededError", missingBytes: 150 });
    expect(storage.tickets).toHaveLength(1);
  });

  it("rejects per-file limit, unsupported type, missing access, disabled uploads and the pending cap", async () => {
    const base = { assets, access, storage, userId: "u1", entitlements: grant, now: NOW };
    await expect(createUploadIntent({ ...base, input: intent({ sizeBytes: 1_000_000_001 }) })).rejects.toMatchObject({ name: "FileTooLargeError" });
    await expect(createUploadIntent({ ...base, input: intent({ contentType: "application/zip" }) })).rejects.toMatchObject({ name: "UnsupportedContentTypeError" });
    await expect(createUploadIntent({ ...base, entitlements: FREE_ENTITLEMENTS, input: intent() })).rejects.toMatchObject({ name: "CloudAccessDeniedError" });
    access.uploadsEnabled = false;
    await expect(createUploadIntent({ ...base, input: intent() })).rejects.toMatchObject({ name: "UploadsDisabledError" });
    access.uploadsEnabled = true;
    for (let i = 0; i < MAX_PENDING_UPLOADS_PER_ACCOUNT; i += 1) {
      await createUploadIntent({ ...base, input: intent({ sizeBytes: 10 }) });
    }
    await expect(createUploadIntent({ ...base, input: intent({ sizeBytes: 10 }) })).rejects.toMatchObject({ name: "TooManyPendingUploadsError" });
    expect(assets.revisions.size).toBe(MAX_PENDING_UPLOADS_PER_ACCOUNT);
  });

  it("does not let user B reuse user A's intent key or asset id", async () => {
    const input = intent();
    await createUploadIntent({ assets, access, storage, userId: "u1", entitlements: grant, input, now: NOW });
    const other = await createUploadIntent({ assets, access, storage, userId: "u2", entitlements: grant, input, now: NOW });
    expect(other.status).toBe("reserved");
    expect(assets.revisions.size).toBe(2);
    expect((await assets.usage("u2")).reservedBytes).toBe(600);
  });
});

describe("confirmUpload", () => {
  it("promotes only a matching object; mismatches leave the revision reserved", async () => {
    const assets = makeFakeAssets();
    const storage = makeFakeStorage();
    const input = intent();
    const r = await createUploadIntent({ assets, access: makeFakeAccess(), storage, userId: "u1", entitlements: grant, input, now: NOW });
    const key = assets.revisions.get(r.revisionId)!.storageKey;
    const args = { assets, storage, userId: "u1", assetId: input.assetId, revisionId: r.revisionId, now: NOW };

    await expect(confirmUpload(args)).rejects.toMatchObject({ name: "UploadVerificationError", reason: "missing" });
    storage.land(key, { sizeBytes: 601, contentType: "video/mp4", checksumSha256: SHA });
    await expect(confirmUpload(args)).rejects.toMatchObject({ reason: "size" });
    storage.land(key, { sizeBytes: 600, contentType: "video/webm", checksumSha256: SHA });
    await expect(confirmUpload(args)).rejects.toMatchObject({ reason: "content-type" });
    storage.land(key, { sizeBytes: 600, contentType: "video/mp4", checksumSha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" });
    await expect(confirmUpload(args)).rejects.toMatchObject({ reason: "checksum" });
    expect(assets.revisions.get(r.revisionId)?.status).toBe("reserved");

    storage.land(key, { sizeBytes: 600, contentType: "video/mp4", checksumSha256: SHA });
    const summary = await confirmUpload(args);
    expect(summary?.currentRevisionId).toBe(r.revisionId);
    expect(await assets.usage("u1")).toEqual({ usedBytes: 600, reservedBytes: 0, pendingUploads: 0 });
    // Idempotent: a second confirm does not double count.
    await confirmUpload(args);
    expect(await assets.usage("u1")).toEqual({ usedBytes: 600, reservedBytes: 0, pendingUploads: 0 });
  });

  it("returns null for a stranger", async () => {
    const assets = makeFakeAssets();
    const storage = makeFakeStorage();
    const input = intent();
    const r = await createUploadIntent({ assets, access: makeFakeAccess(), storage, userId: "u1", entitlements: grant, input, now: NOW });
    expect(await confirmUpload({ assets, storage, userId: "u2", assetId: input.assetId, revisionId: r.revisionId, now: NOW })).toBeNull();
  });
});

describe("cancelUpload", () => {
  it("releases the reservation, deletes a landed-but-unconfirmed object, and is idempotent", async () => {
    const assets = makeFakeAssets();
    const storage = makeFakeStorage();
    const input = intent();
    const r = await createUploadIntent({ assets, access: makeFakeAccess(), storage, userId: "u1", entitlements: grant, input, now: NOW });
    storage.land(assets.revisions.get(r.revisionId)!.storageKey, { sizeBytes: 600 });
    expect(await cancelUpload({ assets, storage, userId: "u1", assetId: input.assetId, revisionId: r.revisionId })).toEqual({ released: true });
    expect(storage.objects.size).toBe(0);
    expect(await cancelUpload({ assets, storage, userId: "u1", assetId: input.assetId, revisionId: r.revisionId })).toEqual({ released: false });
    expect(await assets.usage("u1")).toEqual({ usedBytes: 0, reservedBytes: 0, pendingUploads: 0 });
  });
});

describe("list / download / delete / usage", () => {
  async function readyAsset(assets: ReturnType<typeof makeFakeAssets>, storage: ReturnType<typeof makeFakeStorage>, userId: string, size = 100) {
    const input = intent({ sizeBytes: size });
    const r = await createUploadIntent({ assets, access: makeFakeAccess(), storage, userId, entitlements: grant, input, now: NOW });
    storage.land(assets.revisions.get(r.revisionId)!.storageKey, { sizeBytes: size, contentType: "video/mp4", checksumSha256: SHA });
    await confirmUpload({ assets, storage, userId, assetId: input.assetId, revisionId: r.revisionId, now: NOW });
    return input.assetId;
  }

  it("lists only ready assets of the caller, paginated", async () => {
    const assets = makeFakeAssets();
    const storage = makeFakeStorage();
    await readyAsset(assets, storage, "u1");
    await readyAsset(assets, storage, "u1");
    await createUploadIntent({ assets, access: makeFakeAccess(), storage, userId: "u1", entitlements: grant, input: intent({ sizeBytes: 10 }), now: NOW });
    await readyAsset(assets, storage, "u2");
    const page = await listCloudAssets({ assets, userId: "u1", cursor: null, limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    const rest = await listCloudAssets({ assets, userId: "u1", cursor: page.nextCursor, limit: 10 });
    expect(rest.items).toHaveLength(1);
    expect(rest.nextCursor).toBeNull();
  });

  it("signs a download for the owner's ready revision only", async () => {
    const assets = makeFakeAssets();
    const storage = makeFakeStorage();
    const assetId = await readyAsset(assets, storage, "u1");
    expect(await getAssetDownloadUrl({ assets, storage, userId: "u2", assetId })).toBeNull();
    const dl = await getAssetDownloadUrl({ assets, storage, userId: "u1", assetId });
    expect(dl?.downloadUrl).toContain("sig=down");
    expect(dl?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("deleteCloudCopy: object first, then accounting; failure leaves it deleting for the sweep", async () => {
    const assets = makeFakeAssets();
    const storage = makeFakeStorage();
    const assetId = await readyAsset(assets, storage, "u1");
    storage.failDeletes = true;
    await expect(deleteCloudCopy({ assets, storage, userId: "u1", assetId })).rejects.toThrow(/R2 delete failed/);
    const rev = [...assets.revisions.values()][0]!;
    expect(rev.status).toBe("deleting");
    expect((await assets.usage("u1")).usedBytes).toBe(100); // still counted until physically gone
    storage.failDeletes = false;
    expect(await retryPendingDeletes({ assets, storage, limit: 10 })).toEqual({ finished: 1, failed: 0 });
    expect((await assets.usage("u1")).usedBytes).toBe(0);
    expect((await assets.findAsset("u1", assetId))?.asset.autoUploadExcluded).toBe(true);
    // Repeating the delete is a no-op that reports deleted: false.
    expect(await deleteCloudCopy({ assets, storage, userId: "u1", assetId })).toEqual({ deleted: false });
  });

  it("usage reports capacity, committed space and switches", async () => {
    const assets = makeFakeAssets();
    const storage = makeFakeStorage();
    const access = makeFakeAccess({ uploadsEnabled: false });
    await readyAsset(assets, storage, "u1", 300);
    await createUploadIntent({ assets, access: makeFakeAccess(), storage, userId: "u1", entitlements: grant, input: intent({ sizeBytes: 200 }), now: NOW });
    expect(await getStorageUsage({ assets, access, userId: "u1", entitlements: grant })).toEqual({
      capacityBytes: 1000, usedBytes: 300, reservedBytes: 200, availableBytes: 500,
      pendingUploads: 1, uploadsEnabled: false, cloudUploads: true,
    });
  });
});

describe("sweeps", () => {
  it("releases reservations whose ticket expired past the grace period and removes stray objects", async () => {
    const assets = makeFakeAssets();
    const storage = makeFakeStorage();
    const r = await createUploadIntent({ assets, access: makeFakeAccess(), storage, userId: "u1", entitlements: grant, input: intent(), now: NOW });
    storage.land(assets.revisions.get(r.revisionId)!.storageKey, { sizeBytes: 600 });
    const tooEarly = await sweepExpiredReservations({ assets, storage, now: new Date(NOW.getTime() + 20 * 60_000), limit: 10 });
    expect(tooEarly.released).toBe(0);
    const late = await sweepExpiredReservations({ assets, storage, now: new Date(NOW.getTime() + 3 * 60 * 60_000), limit: 10 });
    expect(late).toEqual({ released: 1, deletedObjects: 1 });
    expect(await assets.usage("u1")).toEqual({ usedBytes: 0, reservedBytes: 0, pendingUploads: 0 });
    expect(assets.revisions.get(r.revisionId)?.status).toBe("expired");
  });

  it("purges every object under a deleted account's prefixes and retries bounded times", async () => {
    const storage = makeFakeStorage();
    const purge = makeFakePurge();
    storage.land("videos/gone/a/r.mp4", { sizeBytes: 1 });
    storage.land("img/gone/b/r.png", { sizeBytes: 1 });
    storage.land("videos/other/a/r.mp4", { sizeBytes: 1 });
    await purge.enqueue("gone");
    storage.failDeletes = true;
    expect(await purgeAccountObjects({ purge, storage, limit: 5, maxAttempts: 3 })).toEqual({ done: 0, failed: 1 });
    storage.failDeletes = false;
    expect(await purgeAccountObjects({ purge, storage, limit: 5, maxAttempts: 3 })).toEqual({ done: 1, failed: 0 });
    expect([...storage.objects.keys()]).toEqual(["videos/other/a/r.mp4"]);
  });
});
```

- [ ] **Step 3: Run to verify failure** — `bun run test --filter=@kaipu/application`. Expected: FAIL (modules not found).

- [ ] **Step 4: Implement the use cases**

```ts
// packages/application/src/cloud/create-upload-intent.ts
import {
  MAX_PENDING_UPLOADS_PER_ACCOUNT,
  MAX_THUMBNAIL_BYTES,
  UPLOAD_TICKET_TTL_SECONDS,
  maxBytesForKind,
} from "@kaipu/domain/constants";
import type { ICloudAccessRepository, ICloudAssetRepository } from "@kaipu/domain/repositories";
import {
  CloudAccessDeniedError,
  FileTooLargeError,
  QuotaExceededError,
  TooManyPendingUploadsError,
  UnsupportedContentTypeError,
  UploadsDisabledError,
  buildRevisionStorageKey,
  buildThumbnailStorageKey,
  computeMissingBytes,
  isSupportedContentType,
  isValidUploadSize,
  toAssetSummary,
  type CloudAssetSummary,
  type CloudRevision,
  type CreateUploadIntent,
  type Entitlements,
} from "@kaipu/domain/schemas";
import type { IStorageService, UploadTicket } from "@kaipu/domain/services";

export interface UploadIntentResult {
  asset: CloudAssetSummary;
  revisionId: string;
  status: "reserved" | "ready";
  ticket: null | (UploadTicket & { thumbnail: null | Pick<UploadTicket, "url" | "headers"> });
}

/**
 * Reserve quota for one revision and hand back restricted tickets. Order matters:
 * every rule that needs no I/O runs first, then the allowlist/switch, then the
 * idempotency lookup, then the atomic reservation, and only then are tickets signed.
 */
export async function createUploadIntent(params: {
  assets: ICloudAssetRepository;
  access: ICloudAccessRepository;
  storage: IStorageService;
  userId: string;
  entitlements: Entitlements;
  input: CreateUploadIntent;
  now?: Date;
}): Promise<UploadIntentResult> {
  const { assets, access, storage, userId, entitlements, input } = params;
  const now = params.now ?? new Date();

  if (!isSupportedContentType(input.kind, input.contentType)) throw new UnsupportedContentTypeError(input.contentType);
  if (!isValidUploadSize(input.kind, input.sizeBytes)) throw new FileTooLargeError(maxBytesForKind(input.kind));
  if (input.thumbnail && input.thumbnail.sizeBytes > MAX_THUMBNAIL_BYTES) throw new FileTooLargeError(MAX_THUMBNAIL_BYTES);
  if (!entitlements.features.cloudUploads) throw new CloudAccessDeniedError();
  if (!(await access.getControl()).uploadsEnabled) throw new UploadsDisabledError();

  const existing = await assets.findByIntentKey(userId, input.intentKey);
  if (existing) return resume(existing);

  const revisionId = crypto.randomUUID();
  const storageKey = buildRevisionStorageKey({ userId, assetId: input.assetId, revisionId, kind: input.kind, contentType: input.contentType });
  const thumbnailKey = input.thumbnail ? buildThumbnailStorageKey({ userId, assetId: input.assetId, revisionId, kind: input.kind }) : null;
  const thumbnailBytes = input.thumbnail?.sizeBytes ?? 0;
  const reservedBytes = input.sizeBytes + thumbnailBytes;

  const outcome = await assets.reserve({
    userId,
    assetId: input.assetId,
    intentKey: input.intentKey,
    revisionId,
    kind: input.kind,
    title: input.title,
    durationSeconds: input.durationSeconds,
    derivedFromAssetId: input.derivedFromAssetId,
    storageKey,
    thumbnailKey,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
    thumbnailBytes,
    contentSha256: input.contentSha256,
    reservedBytes,
    ticketExpiresAt: new Date(now.getTime() + UPLOAD_TICKET_TTL_SECONDS * 1000),
    capacityBytes: entitlements.features.cloudStorageBytes,
    maxPending: MAX_PENDING_UPLOADS_PER_ACCOUNT,
  });

  if (outcome.kind === "too-many-pending") throw new TooManyPendingUploadsError(MAX_PENDING_UPLOADS_PER_ACCOUNT);
  if (outcome.kind === "quota-exceeded") {
    throw new QuotaExceededError(
      computeMissingBytes({ capacityBytes: entitlements.features.cloudStorageBytes, ...outcome }, reservedBytes),
    );
  }

  try {
    const ticket = await sign(outcome.revision, input.thumbnail?.contentSha256 ?? null);
    return { asset: toAssetSummary(outcome.asset, null), revisionId, status: "reserved", ticket };
  } catch (err) {
    // Signing failed after the bytes were reserved — give them back so a permanently
    // reserved revision never blocks the account. The intent key is free to retry.
    await assets.release(userId, revisionId).catch(() => undefined);
    throw err;
  }

  async function resume(revision: CloudRevision): Promise<UploadIntentResult> {
    const found = await assets.findAsset(userId, revision.assetId);
    if (!found) throw new Error("intent refers to a missing asset");
    if (revision.status === "ready") {
      return { asset: toAssetSummary(found.asset, revision), revisionId: revision.revisionId, status: "ready", ticket: null };
    }
    if (revision.status !== "reserved") {
      // Expired/deleted intent: the client must start a new intent (new key). Surface as quota
      // logic would: the reservation is gone.
      throw new QuotaExceededError(
        computeMissingBytes({ capacityBytes: entitlements.features.cloudStorageBytes, ...(await assets.usage(userId)) }, revision.reservedBytes),
      );
    }
    const ticketExpiresAt = new Date(now.getTime() + UPLOAD_TICKET_TTL_SECONDS * 1000);
    await assets.extendTicket(userId, revision.revisionId, ticketExpiresAt);
    const ticket = await sign({ ...revision, ticketExpiresAt }, input.thumbnail?.contentSha256 ?? null);
    return { asset: toAssetSummary(found.asset, null), revisionId: revision.revisionId, status: "reserved", ticket };
  }

  async function sign(revision: CloudRevision, thumbnailSha256: string | null) {
    const main = await storage.createUploadTicket(revision.storageKey, {
      contentType: revision.contentType,
      contentLength: revision.sizeBytes,
      checksumSha256: revision.contentSha256,
      expiresInSeconds: UPLOAD_TICKET_TTL_SECONDS,
    });
    const thumbnail =
      revision.thumbnailKey && thumbnailSha256
        ? await storage.createUploadTicket(revision.thumbnailKey, {
            contentType: "image/jpeg",
            contentLength: revision.thumbnailBytes,
            checksumSha256: thumbnailSha256,
            expiresInSeconds: UPLOAD_TICKET_TTL_SECONDS,
          })
        : null;
    return { ...main, thumbnail: thumbnail ? { url: thumbnail.url, headers: thumbnail.headers } : null };
  }
}
```

```ts
// packages/application/src/cloud/confirm-upload.ts
import type { ICloudAssetRepository } from "@kaipu/domain/repositories";
import { UploadVerificationError, toAssetSummary, type CloudAssetSummary } from "@kaipu/domain/schemas";
import type { IStorageService, ObjectMetadata } from "@kaipu/domain/services";

function baseType(contentType: string | null): string {
  return (contentType ?? "").toLowerCase().split(";")[0]?.trim() ?? "";
}

/**
 * Promote a reserved revision once storage holds exactly the declared bytes.
 * Owner-scoped; returns null for a stranger. Idempotent: confirming a ready
 * revision returns it without touching accounting.
 */
export async function confirmUpload(params: {
  assets: ICloudAssetRepository;
  storage: IStorageService;
  userId: string;
  assetId: string;
  revisionId: string;
  now?: Date;
}): Promise<CloudAssetSummary | null> {
  const { assets, storage, userId, assetId, revisionId } = params;
  const revision = await assets.findRevision(userId, assetId, revisionId);
  if (!revision) return null;

  if (revision.status === "reserved") {
    const head = await storage.headObject(revision.storageKey);
    verify(head, revision.sizeBytes, revision.contentType, revision.contentSha256);
    if (revision.thumbnailKey) {
      const thumb = await storage.headObject(revision.thumbnailKey);
      if (!thumb || thumb.sizeBytes !== revision.thumbnailBytes) throw new UploadVerificationError("thumbnail");
    }
    const ready = await assets.markReady(userId, revisionId, params.now ?? new Date());
    if (!ready) throw new UploadVerificationError("missing");
  } else if (revision.status !== "ready") {
    return null; // expired / deleting / deleted — nothing to confirm
  }

  const found = await assets.findAsset(userId, assetId);
  return found ? toAssetSummary(found.asset, found.current) : null;
}

function verify(head: ObjectMetadata | null, sizeBytes: number, contentType: string, sha256: string): void {
  if (!head) throw new UploadVerificationError("missing");
  if (head.sizeBytes !== sizeBytes) throw new UploadVerificationError("size");
  if (baseType(head.contentType) !== baseType(contentType)) throw new UploadVerificationError("content-type");
  if (head.checksumSha256 !== null && head.checksumSha256 !== sha256) throw new UploadVerificationError("checksum");
}
```

```ts
// packages/application/src/cloud/cancel-upload.ts
import type { ICloudAssetRepository } from "@kaipu/domain/repositories";
import type { IStorageService } from "@kaipu/domain/services";

/**
 * Release a reservation the client gave up on. Deletes whatever landed under the
 * key (a partial PUT never lands; a full one that was never confirmed does), then
 * frees the bytes. Idempotent: a second call reports `released: false`.
 */
export async function cancelUpload(params: {
  assets: ICloudAssetRepository;
  storage: IStorageService;
  userId: string;
  assetId: string;
  revisionId: string;
}): Promise<{ released: boolean } | null> {
  const revision = await params.assets.findRevision(params.userId, params.assetId, params.revisionId);
  if (!revision) return null;
  if (revision.status !== "reserved") return { released: false };
  await params.storage.deleteObject(revision.storageKey);
  if (revision.thumbnailKey) await params.storage.deleteObject(revision.thumbnailKey);
  const released = await params.assets.release(params.userId, params.revisionId);
  return { released: released !== null };
}
```

```ts
// packages/application/src/cloud/list-cloud-assets.ts
import type { ICloudAssetRepository } from "@kaipu/domain/repositories";
import { toAssetSummary, type CloudAssetSummary } from "@kaipu/domain/schemas";

export async function listCloudAssets(params: {
  assets: ICloudAssetRepository;
  userId: string;
  cursor: string | null;
  limit: number;
}): Promise<{ items: CloudAssetSummary[]; nextCursor: string | null }> {
  const page = await params.assets.listAssets(params.userId, { cursor: params.cursor, limit: params.limit });
  return { items: page.items.map((i) => toAssetSummary(i.asset, i.current)), nextCursor: page.nextCursor };
}
```

```ts
// packages/application/src/cloud/get-asset-download-url.ts
import { DOWNLOAD_URL_TTL_SECONDS } from "@kaipu/domain/constants";
import type { ICloudAssetRepository } from "@kaipu/domain/repositories";
import { toAssetSummary, type CloudAssetSummary } from "@kaipu/domain/schemas";
import type { IStorageService } from "@kaipu/domain/services";

/** Presigned GET for the owner's current ready revision; null otherwise (never reveals existence). */
export async function getAssetDownloadUrl(params: {
  assets: ICloudAssetRepository;
  storage: IStorageService;
  userId: string;
  assetId: string;
  now?: Date;
}): Promise<{ asset: CloudAssetSummary; downloadUrl: string; expiresAt: Date } | null> {
  const found = await params.assets.findAsset(params.userId, params.assetId);
  if (!found?.current || found.current.status !== "ready") return null;
  const downloadUrl = await params.storage.createDownloadUrl(found.current.storageKey, {
    expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
  });
  const now = params.now ?? new Date();
  return {
    asset: toAssetSummary(found.asset, found.current),
    downloadUrl,
    expiresAt: new Date(now.getTime() + DOWNLOAD_URL_TTL_SECONDS * 1000),
  };
}
```

```ts
// packages/application/src/cloud/delete-cloud-copy.ts
import type { ICloudAssetRepository } from "@kaipu/domain/repositories";
import type { IStorageService } from "@kaipu/domain/services";

/**
 * Delete the current cloud revision of an asset. `beginDelete` flips it to
 * `deleting` (and marks the asset excluded from automatic upload) BEFORE the
 * object is removed, so a crash between the two leaves a row the sweep retries;
 * `finishDelete` settles the accounting only after storage confirmed removal.
 * Returns null for a stranger; `{ deleted: false }` when there is nothing to delete.
 */
export async function deleteCloudCopy(params: {
  assets: ICloudAssetRepository;
  storage: IStorageService;
  userId: string;
  assetId: string;
}): Promise<{ deleted: boolean } | null> {
  const found = await params.assets.findAsset(params.userId, params.assetId);
  if (!found) return null;
  if (!found.current) return { deleted: false };
  const deleting = await params.assets.beginDelete(params.userId, found.current.revisionId);
  if (!deleting) return { deleted: false };
  await params.storage.deleteObject(deleting.storageKey);
  if (deleting.thumbnailKey) await params.storage.deleteObject(deleting.thumbnailKey);
  await params.assets.finishDelete(params.userId, deleting.revisionId);
  return { deleted: true };
}
```

```ts
// packages/application/src/cloud/get-storage-usage.ts
import type { ICloudAccessRepository, ICloudAssetRepository } from "@kaipu/domain/repositories";
import type { Entitlements, StorageUsage } from "@kaipu/domain/schemas";

export async function getStorageUsage(params: {
  assets: ICloudAssetRepository;
  access: ICloudAccessRepository;
  userId: string;
  entitlements: Entitlements;
}): Promise<StorageUsage> {
  const [usage, control] = await Promise.all([params.assets.usage(params.userId), params.access.getControl()]);
  const capacityBytes = params.entitlements.features.cloudStorageBytes;
  return {
    capacityBytes,
    usedBytes: usage.usedBytes,
    reservedBytes: usage.reservedBytes,
    availableBytes: Math.max(0, capacityBytes - usage.usedBytes - usage.reservedBytes),
    pendingUploads: usage.pendingUploads,
    uploadsEnabled: control.uploadsEnabled,
    cloudUploads: params.entitlements.features.cloudUploads,
  };
}
```

```ts
// packages/application/src/cloud/set-auto-upload-exclusion.ts
import type { ICloudAssetRepository } from "@kaipu/domain/repositories";
import { toAssetSummary, type CloudAssetSummary } from "@kaipu/domain/schemas";

/** Only "re-upload" (excluded = false, from the desktop's explicit action) clears the flag. */
export async function setAutoUploadExclusion(params: {
  assets: ICloudAssetRepository;
  userId: string;
  assetId: string;
  excluded: boolean;
}): Promise<CloudAssetSummary | null> {
  const asset = await params.assets.setAutoUploadExcluded(params.userId, params.assetId, params.excluded);
  if (!asset) return null;
  const found = await params.assets.findAsset(params.userId, params.assetId);
  return toAssetSummary(asset, found?.current ?? null);
}
```

```ts
// packages/application/src/cloud/sweep-expired-reservations.ts
import { RESERVATION_GRACE_SECONDS } from "@kaipu/domain/constants";
import type { ICloudAssetRepository } from "@kaipu/domain/repositories";
import type { IStorageService } from "@kaipu/domain/services";

/**
 * Reservations whose ticket expired more than the grace period ago can no longer
 * be written (presigned URLs check expiry at request start) — release them and
 * delete anything that landed without a confirm. Idempotent; bounded by `limit`.
 */
export async function sweepExpiredReservations(params: {
  assets: ICloudAssetRepository;
  storage: IStorageService;
  now: Date;
  limit: number;
}): Promise<{ released: number; deletedObjects: number }> {
  const before = new Date(params.now.getTime() - RESERVATION_GRACE_SECONDS * 1000);
  const expired = await params.assets.listReservedExpiredBefore(before, params.limit);
  let released = 0;
  let deletedObjects = 0;
  for (const revision of expired) {
    for (const key of [revision.storageKey, revision.thumbnailKey]) {
      if (!key) continue;
      if (await params.storage.headObject(key)) {
        await params.storage.deleteObject(key);
        deletedObjects += 1;
      }
    }
    if (await params.assets.release(revision.userId, revision.revisionId)) released += 1;
  }
  return { released, deletedObjects };
}
```

```ts
// packages/application/src/cloud/retry-pending-deletes.ts
import type { ICloudAssetRepository } from "@kaipu/domain/repositories";
import type { IStorageService } from "@kaipu/domain/services";

/** Finish deletes whose storage call failed mid-way. Accounting settles only on success. */
export async function retryPendingDeletes(params: {
  assets: ICloudAssetRepository;
  storage: IStorageService;
  limit: number;
}): Promise<{ finished: number; failed: number }> {
  const pending = await params.assets.listDeleting(params.limit);
  let finished = 0;
  let failed = 0;
  for (const revision of pending) {
    try {
      await params.storage.deleteObject(revision.storageKey);
      if (revision.thumbnailKey) await params.storage.deleteObject(revision.thumbnailKey);
      if (await params.assets.finishDelete(revision.userId, revision.revisionId)) finished += 1;
    } catch {
      failed += 1;
    }
  }
  return { finished, failed };
}
```

```ts
// packages/application/src/cloud/purge-account-objects.ts
import type { ICloudPurgeRepository } from "@kaipu/domain/repositories";
import { accountPrefixes } from "@kaipu/domain/schemas";
import type { IStorageService } from "@kaipu/domain/services";

/**
 * Remove every object under a deleted account's prefixes. The database rows are
 * already gone (cascade); the queue row is the only memory of the obligation.
 * Jobs past `maxAttempts` are left for an operator (they stay listed as pending).
 */
export async function purgeAccountObjects(params: {
  purge: ICloudPurgeRepository;
  storage: IStorageService;
  limit: number;
  maxAttempts: number;
}): Promise<{ done: number; failed: number }> {
  const jobs = (await params.purge.nextPending(params.limit)).filter((j) => j.attempts < params.maxAttempts);
  let done = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      for (const prefix of accountPrefixes(job.userId)) {
        let cursor: string | undefined;
        do {
          const page = await params.storage.listObjectKeys(prefix, cursor);
          for (const key of page.keys) await params.storage.deleteObject(key);
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
      }
      await params.purge.markDone(job.id);
      done += 1;
    } catch (err) {
      await params.purge.markAttempt(job.id, err instanceof Error ? err.message : String(err));
      failed += 1;
    }
  }
  return { done, failed };
}
```

```ts
// packages/application/src/cloud/index.ts
export { createUploadIntent, type UploadIntentResult } from "./create-upload-intent";
export { confirmUpload } from "./confirm-upload";
export { cancelUpload } from "./cancel-upload";
export { listCloudAssets } from "./list-cloud-assets";
export { getAssetDownloadUrl } from "./get-asset-download-url";
export { deleteCloudCopy } from "./delete-cloud-copy";
export { getStorageUsage } from "./get-storage-usage";
export { setAutoUploadExclusion } from "./set-auto-upload-exclusion";
export { sweepExpiredReservations } from "./sweep-expired-reservations";
export { retryPendingDeletes } from "./retry-pending-deletes";
export { purgeAccountObjects } from "./purge-account-objects";
```

Add `export * from "./cloud";` to `packages/application/src/index.ts`. In
`recordings/recordings.test.ts`, add to `makeFakeStorage`'s returned object:

```ts
    async createUploadTicket(key: string) {
      return { url: `https://r2.example/${key}`, headers: {}, expiresAt: new Date() };
    },
    async headObject(key: string) {
      return state.existingKeys.has(key) ? { sizeBytes: 0, contentType: null, etag: null, checksumSha256: null } : null;
    },
    async listObjectKeys() {
      return { keys: [], nextCursor: null };
    },
```

Note on `packages/application/package.json`: `@kaipu/domain/constants` is already reachable via
the domain package `exports` map; no dependency change is needed.

- [ ] **Step 5: Run tests** — `bun run test --filter=@kaipu/application && bun run check-types --filter=@kaipu/application`. Expected: PASS (all `cloud.test.ts` cases and the legacy `recordings.test.ts`).

- [ ] **Step 6: Commit**

```bash
git add packages/application/src
git commit -m "feat(application): cloud upload intents, verified confirm, deletes, usage and sweeps"
```

---

### Task 10: Server — contract, router, error mapping and structured events

**Files:**

- Create: `apps/server-hono/src/contract/cloud.contract.ts`
- Modify: `apps/server-hono/src/contract/me.contract.ts`, `apps/server-hono/src/contract/index.ts`
- Create: `apps/server-hono/src/lib/storage.ts` (lazy R2 singleton, moved out of the recording router)
- Create: `apps/server-hono/src/lib/events.ts`
- Create: `apps/server-hono/src/modules/cloud/errors.ts`, `apps/server-hono/src/modules/cloud/cloud.router.ts`
- Modify: `apps/server-hono/src/modules/me/me.router.ts`, `apps/server-hono/src/router.ts`
- Create: `apps/server-hono/src/modules/cloud/errors.test.ts`, `apps/server-hono/vitest.config.ts`; add `"test": "vitest run"` and `"vitest": "^4.1.9"` to `apps/server-hono/package.json`.

**Interfaces:**

- Consumes: Task 9 use cases, Task 8 repositories, Task 6 storage.
- Produces: the wire contract listed above, exported as `contract.cloud.*` and `contract.me.storage`.

- [ ] **Step 1: Write the failing test for the error mapping**

```ts
// apps/server-hono/src/modules/cloud/errors.test.ts
import { describe, expect, it } from "vitest";
import {
  CloudAccessDeniedError,
  FileTooLargeError,
  QuotaExceededError,
  TooManyPendingUploadsError,
  UnsupportedContentTypeError,
  UploadVerificationError,
  UploadsDisabledError,
} from "@kaipu/domain/schemas";
import { ORPCError } from "@orpc/server";
import { toOrpcError } from "./errors";

describe("toOrpcError", () => {
  it("maps domain errors to codes and structured data, never leaking internals", () => {
    const quota = toOrpcError(new QuotaExceededError(350));
    expect(quota).toBeInstanceOf(ORPCError);
    expect(quota.code).toBe("PAYLOAD_TOO_LARGE");
    expect(quota.data).toEqual({ kind: "quota-exceeded", missingBytes: 350 });
    expect(toOrpcError(new FileTooLargeError(1000)).data).toEqual({ kind: "file-too-large", limitBytes: 1000 });
    expect(toOrpcError(new UnsupportedContentTypeError("x/y")).code).toBe("BAD_REQUEST");
    expect(toOrpcError(new TooManyPendingUploadsError(3)).code).toBe("TOO_MANY_REQUESTS");
    expect(toOrpcError(new UploadsDisabledError()).code).toBe("SERVICE_UNAVAILABLE");
    expect(toOrpcError(new CloudAccessDeniedError()).code).toBe("FORBIDDEN");
    expect(toOrpcError(new UploadVerificationError("size")).data).toEqual({ kind: "verification-failed", reason: "size" });
  });

  it("returns unknown errors untouched so the framework reports a 500 without details", () => {
    const err = new Error("boom https://secret");
    expect(toOrpcError(err)).toBe(err);
  });
});
```

`apps/server-hono/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { globals: true, environment: "node", include: ["src/**/*.test.ts"] },
});
```

- [ ] **Step 2: Run to verify failure** — `bun run test --filter=server-hono`. Expected: FAIL (`./errors` missing).

- [ ] **Step 3: Write the contract**

```ts
// apps/server-hono/src/contract/cloud.contract.ts
import { cloudAssetSummarySchema, createUploadIntentSchema } from "@kaipu/domain/schemas";
import { oc } from "@orpc/contract";
import { z } from "zod";
import { apiResponseSchema } from "./shared.contract";

const ticketSchema = z.object({
  url: z.string(),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.date(),
  thumbnail: z.object({ url: z.string(), headers: z.record(z.string(), z.string()) }).nullable(),
});

const uploadIntentResultSchema = z.object({
  asset: cloudAssetSummarySchema,
  revisionId: z.string(),
  status: z.enum(["reserved", "ready"]),
  ticket: ticketSchema.nullable(),
});

const revisionParams = z.object({ assetId: z.string().uuid(), revisionId: z.string() });
const assetParams = z.object({ assetId: z.string().uuid() });

export const cloudContract = {
  createUploadIntent: oc
    .route({ method: "POST", path: "/assets/upload-intents", successStatus: 201 })
    .input(createUploadIntentSchema)
    .output(apiResponseSchema(uploadIntentResultSchema)),

  confirmUpload: oc
    .route({ method: "POST", path: "/assets/{assetId}/revisions/{revisionId}/confirm" })
    .input(revisionParams)
    .output(apiResponseSchema(cloudAssetSummarySchema)),

  cancelUpload: oc
    .route({ method: "POST", path: "/assets/{assetId}/revisions/{revisionId}/cancel" })
    .input(revisionParams)
    .output(apiResponseSchema(z.object({ released: z.boolean() }))),

  list: oc
    .route({ method: "GET", path: "/assets" })
    .input(z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }))
    .output(apiResponseSchema(z.object({ items: z.array(cloudAssetSummarySchema), nextCursor: z.string().nullable() }))),

  get: oc
    .route({ method: "GET", path: "/assets/{assetId}" })
    .input(assetParams)
    .output(apiResponseSchema(cloudAssetSummarySchema)),

  downloadUrl: oc
    .route({ method: "GET", path: "/assets/{assetId}/download-url" })
    .input(assetParams)
    .output(apiResponseSchema(z.object({ asset: cloudAssetSummarySchema, downloadUrl: z.string(), expiresAt: z.date() }))),

  deleteCloudCopy: oc
    .route({ method: "DELETE", path: "/assets/{assetId}/cloud" })
    .input(assetParams)
    .output(apiResponseSchema(z.object({ deleted: z.boolean() }))),

  setAutoUploadExclusion: oc
    .route({ method: "POST", path: "/assets/{assetId}/auto-upload-exclusion" })
    .input(assetParams.extend({ excluded: z.boolean() }))
    .output(apiResponseSchema(cloudAssetSummarySchema)),
};
```

In `me.contract.ts` add:

```ts
import { entitlementsSchema, storageUsageSchema } from "@kaipu/domain/schemas";
// …
  storage: oc.route({ method: "GET", path: "/me/storage" }).output(apiResponseSchema(storageUsageSchema)),
```

In `contract/index.ts` register it: `oc.router({ me: meContract, recording: recordingContract, cloud: cloudContract })`
(the `recording` entry disappears in Task 12).

- [ ] **Step 4: Write the shared lib files**

```ts
// apps/server-hono/src/lib/storage.ts
import type { IStorageService } from "@kaipu/domain/services";
import { createR2Storage } from "@kaipu/infra-storage";
import { ORPCError } from "@orpc/server";
import { env } from "../env";

// Built lazily so the API still boots when R2 isn't configured — only the
// endpoints that touch storage fail, with a clear message.
let singleton: IStorageService | null = null;

export function getStorage(): IStorageService {
  if (singleton) return singleton;
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Cloud storage is not configured" });
  }
  singleton = createR2Storage({
    accountId: R2_ACCOUNT_ID,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    bucket: R2_BUCKET,
  });
  return singleton;
}

/** Same as `getStorage` but for the scheduled handler, which has no oRPC context. */
export function tryGetStorage(): IStorageService | null {
  try {
    return getStorage();
  } catch {
    return null;
  }
}
```

```ts
// apps/server-hono/src/lib/events.ts
/**
 * Structured operational events. One JSON line per event on stdout, captured by
 * Workers observability (`observability.enabled` in wrangler.jsonc).
 *
 * Rule: ids, counts, byte totals and error names only. NEVER a presigned URL, a
 * session token, a storage key or a user-chosen title.
 */
export type CloudEvent =
  | { name: "cloud.intent.created"; userId: string; assetId: string; revisionId: string; reservedBytes: number }
  | { name: "cloud.intent.rejected"; userId: string; reason: string; missingBytes?: number }
  | { name: "cloud.confirm.ok"; userId: string; revisionId: string; sizeBytes: number }
  | { name: "cloud.confirm.failed"; userId: string; revisionId: string; reason: string }
  | { name: "cloud.delete.ok"; userId: string; assetId: string }
  | { name: "cloud.delete.failed"; userId: string; assetId: string; error: string }
  | { name: "cloud.sweep"; released: number; deletedObjects: number; finishedDeletes: number; failedDeletes: number; purged: number; purgeFailed: number; reconciled: number }
  | { name: "cloud.sweep.failed"; error: string };

export function logEvent(event: CloudEvent): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...event }));
}
```

```ts
// apps/server-hono/src/modules/cloud/errors.ts
import {
  CloudAccessDeniedError,
  FileTooLargeError,
  QuotaExceededError,
  TooManyPendingUploadsError,
  UnsupportedContentTypeError,
  UploadVerificationError,
  UploadsDisabledError,
} from "@kaipu/domain/schemas";
import { ORPCError } from "@orpc/server";

/** Domain error → oRPC error with a small, structured `data` payload the desktop switches on. */
export function toOrpcError(err: unknown): unknown {
  if (err instanceof QuotaExceededError) {
    return new ORPCError("PAYLOAD_TOO_LARGE", { message: "Not enough cloud space", data: { kind: "quota-exceeded", missingBytes: err.missingBytes } });
  }
  if (err instanceof FileTooLargeError) {
    return new ORPCError("PAYLOAD_TOO_LARGE", { message: "File exceeds the per-file limit", data: { kind: "file-too-large", limitBytes: err.limitBytes } });
  }
  if (err instanceof UnsupportedContentTypeError) return new ORPCError("BAD_REQUEST", { message: "Unsupported content type" });
  if (err instanceof TooManyPendingUploadsError) return new ORPCError("TOO_MANY_REQUESTS", { message: "Too many uploads in progress" });
  if (err instanceof UploadsDisabledError) return new ORPCError("SERVICE_UNAVAILABLE", { message: "Cloud uploads are temporarily disabled" });
  if (err instanceof CloudAccessDeniedError) return new ORPCError("FORBIDDEN", { message: "Cloud upload access is not enabled for this account" });
  if (err instanceof UploadVerificationError) {
    return new ORPCError("CONFLICT", { message: "Uploaded object does not match the declared revision", data: { kind: "verification-failed", reason: err.reason } });
  }
  return err;
}
```

- [ ] **Step 5: Write the router**

```ts
// apps/server-hono/src/modules/cloud/cloud.router.ts
import {
  cancelUpload,
  confirmUpload,
  createUploadIntent,
  deleteCloudCopy,
  getAssetDownloadUrl,
  getEntitlements,
  listCloudAssets,
  setAutoUploadExclusion,
} from "@kaipu/application";
import { QuotaExceededError } from "@kaipu/domain/schemas";
import { createDatabaseClient } from "@kaipu/infra-db/client";
import { CloudAccessRepository, CloudAssetRepository, SubscriptionRepository } from "@kaipu/infra-db/repositories";
import { implement, ORPCError } from "@orpc/server";
import { cloudContract } from "../../contract/cloud.contract";
import { env } from "../../env";
import { logEvent } from "../../lib/events";
import { getStorage } from "../../lib/storage";
import { authMiddleware } from "../../middleware/auth";
import { toOrpcError } from "./errors";

const db = createDatabaseClient(env.DATABASE_URL);
const assets = new CloudAssetRepository(db);
const access = new CloudAccessRepository(db);
const subscriptions = new SubscriptionRepository(db);

const impl = implement(cloudContract).$context<{ headers: Headers }>();

const notFound = (): never => {
  throw new ORPCError("NOT_FOUND", { message: "Asset not found" });
};

export const cloudRouter = impl.router({
  createUploadIntent: impl.createUploadIntent.use(authMiddleware).handler(async ({ input, context }) => {
    const userId = context.user.id;
    try {
      const entitlements = await getEntitlements({ repo: subscriptions, cloudAccessRepo: access, userId });
      const data = await createUploadIntent({ assets, access, storage: getStorage(), userId, entitlements, input });
      logEvent({ name: "cloud.intent.created", userId, assetId: input.assetId, revisionId: data.revisionId, reservedBytes: input.sizeBytes + (input.thumbnail?.sizeBytes ?? 0) });
      return { data, error: null };
    } catch (err) {
      logEvent({
        name: "cloud.intent.rejected",
        userId,
        reason: err instanceof Error ? err.name : "unknown",
        missingBytes: err instanceof QuotaExceededError ? err.missingBytes : undefined,
      });
      throw toOrpcError(err);
    }
  }),

  confirmUpload: impl.confirmUpload.use(authMiddleware).handler(async ({ input, context }) => {
    const userId = context.user.id;
    try {
      const data = await confirmUpload({ assets, storage: getStorage(), userId, assetId: input.assetId, revisionId: input.revisionId });
      if (!data) notFound();
      logEvent({ name: "cloud.confirm.ok", userId, revisionId: input.revisionId, sizeBytes: data.sizeBytes ?? 0 });
      return { data, error: null };
    } catch (err) {
      logEvent({ name: "cloud.confirm.failed", userId, revisionId: input.revisionId, reason: err instanceof Error ? err.name : "unknown" });
      throw toOrpcError(err);
    }
  }),

  cancelUpload: impl.cancelUpload.use(authMiddleware).handler(async ({ input, context }) => {
    const data = await cancelUpload({ assets, storage: getStorage(), userId: context.user.id, assetId: input.assetId, revisionId: input.revisionId });
    if (!data) notFound();
    return { data, error: null };
  }),

  list: impl.list.use(authMiddleware).handler(async ({ input, context }) => {
    const data = await listCloudAssets({ assets, userId: context.user.id, cursor: input.cursor ?? null, limit: input.limit });
    return { data, error: null };
  }),

  get: impl.get.use(authMiddleware).handler(async ({ input, context }) => {
    const found = await assets.findAsset(context.user.id, input.assetId);
    if (!found) notFound();
    const { toAssetSummary } = await import("@kaipu/domain/schemas");
    return { data: toAssetSummary(found.asset, found.current), error: null };
  }),

  downloadUrl: impl.downloadUrl.use(authMiddleware).handler(async ({ input, context }) => {
    const data = await getAssetDownloadUrl({ assets, storage: getStorage(), userId: context.user.id, assetId: input.assetId });
    if (!data) notFound();
    return { data, error: null };
  }),

  deleteCloudCopy: impl.deleteCloudCopy.use(authMiddleware).handler(async ({ input, context }) => {
    const userId = context.user.id;
    try {
      const data = await deleteCloudCopy({ assets, storage: getStorage(), userId, assetId: input.assetId });
      if (!data) notFound();
      logEvent({ name: "cloud.delete.ok", userId, assetId: input.assetId });
      return { data, error: null };
    } catch (err) {
      logEvent({ name: "cloud.delete.failed", userId, assetId: input.assetId, error: err instanceof Error ? err.name : "unknown" });
      throw err;
    }
  }),

  setAutoUploadExclusion: impl.setAutoUploadExclusion.use(authMiddleware).handler(async ({ input, context }) => {
    const data = await setAutoUploadExclusion({ assets, userId: context.user.id, assetId: input.assetId, excluded: input.excluded });
    if (!data) notFound();
    return { data, error: null };
  }),
});
```

(Replace the dynamic `import` in `get` with a static import of `toAssetSummary` at the top of the
file — shown inline only to keep the handler self-contained here.)

Update `me.router.ts`:

```ts
import { getEntitlements, getStorageUsage } from "@kaipu/application";
import { createDatabaseClient } from "@kaipu/infra-db/client";
import { CloudAccessRepository, CloudAssetRepository, SubscriptionRepository } from "@kaipu/infra-db/repositories";
import { implement } from "@orpc/server";
import { meContract } from "../../contract/me.contract";
import { env } from "../../env";
import { authMiddleware } from "../../middleware/auth";

const db = createDatabaseClient(env.DATABASE_URL);
const repo = new SubscriptionRepository(db);
const cloudAccessRepo = new CloudAccessRepository(db);
const assets = new CloudAssetRepository(db);

const impl = implement(meContract).$context<{ headers: Headers }>();

export const meRouter = impl.router({
  entitlements: impl.entitlements.use(authMiddleware).handler(async ({ context }) => {
    const data = await getEntitlements({ repo, cloudAccessRepo, userId: context.user.id });
    return { data, error: null };
  }),
  storage: impl.storage.use(authMiddleware).handler(async ({ context }) => {
    const entitlements = await getEntitlements({ repo, cloudAccessRepo, userId: context.user.id });
    const data = await getStorageUsage({ assets, access: cloudAccessRepo, userId: context.user.id, entitlements });
    return { data, error: null };
  }),
});
```

Register in `router.ts`: `impl.router({ me: meRouter, recording: recordingRouter, cloud: cloudRouter })`.
Replace the inline `getStorage` in `modules/recording/recording.router.ts` with an import from
`../../lib/storage` (the module is deleted in Task 12 anyway).

- [ ] **Step 6: Verify** — `bun run test --filter=server-hono && bun run check-types --filter=server-hono`. Expected: PASS.
      Then `bun run dev:server-hono` and, with a signed-in session cookie or bearer token, call
      `GET /api/v1/me/storage`. Expected: `{ data: { capacityBytes: 1000000000, usedBytes: 0, … cloudUploads: false } }`
      for an account without a `cloud_access` row.

- [ ] **Step 7: Commit**

```bash
git add apps/server-hono
git commit -m "feat(server): cloud assets contract and router with structured events"
```

---

### Task 11: Server — scheduled sweep, cron trigger and account-deletion purge

**Files:**

- Create: `apps/server-hono/src/scheduled.ts`
- Modify: `apps/server-hono/src/index.ts`, `apps/server-hono/wrangler.jsonc`
- Modify: `packages/infra-auth/src/config/base-config.ts`
- Create: `packages/infra-auth/src/hooks/enqueue-purge.ts`

**Interfaces:**

- Consumes: Task 9 sweeps, Task 8 repositories, Task 10 `tryGetStorage`/`logEvent`.
- Produces: the Worker `scheduled` export; Better Auth `user.deleteUser` enabled with a purge hook.

- [ ] **Step 1: Write the scheduled handler**

```ts
// apps/server-hono/src/scheduled.ts
import { purgeAccountObjects, retryPendingDeletes, sweepExpiredReservations } from "@kaipu/application";
import { createDatabaseClient } from "@kaipu/infra-db/client";
import { CloudAssetRepository, CloudPurgeRepository } from "@kaipu/infra-db/repositories";
import { env } from "./env";
import { logEvent } from "./lib/events";
import { tryGetStorage } from "./lib/storage";

const SWEEP_LIMIT = 50; // Task 0
const PURGE_LIMIT = 1; // Task 0
const PURGE_MAX_ATTEMPTS = 10;
const RECONCILE_WINDOW_MS = 60 * 60 * 1000;

/**
 * One cron invocation. Every step is idempotent and bounded so a partial run
 * (Worker CPU limit, transient R2 error) leaves nothing in a worse state than
 * before — the next tick simply continues.
 */
export async function runCloudSweep(now = new Date()): Promise<void> {
  const storage = tryGetStorage();
  if (!storage) {
    logEvent({ name: "cloud.sweep.failed", error: "storage-not-configured" });
    return;
  }
  const db = createDatabaseClient(env.DATABASE_URL);
  const assets = new CloudAssetRepository(db);
  const purge = new CloudPurgeRepository(db);
  try {
    const swept = await sweepExpiredReservations({ assets, storage, now, limit: SWEEP_LIMIT });
    const deletes = await retryPendingDeletes({ assets, storage, limit: SWEEP_LIMIT });
    const purged = await purgeAccountObjects({ purge, storage, limit: PURGE_LIMIT, maxAttempts: PURGE_MAX_ATTEMPTS });
    const touched = await assets.listAccountsTouchedSince(new Date(now.getTime() - RECONCILE_WINDOW_MS), SWEEP_LIMIT);
    for (const userId of touched) await assets.reconcile(userId);
    logEvent({
      name: "cloud.sweep",
      released: swept.released,
      deletedObjects: swept.deletedObjects,
      finishedDeletes: deletes.finished,
      failedDeletes: deletes.failed,
      purged: purged.done,
      purgeFailed: purged.failed,
      reconciled: touched.length,
    });
  } catch (err) {
    logEvent({ name: "cloud.sweep.failed", error: err instanceof Error ? err.name : "unknown" });
    throw err;
  }
}
```

Change the default export of `apps/server-hono/src/index.ts` (keep everything above it):

```ts
import { runCloudSweep } from "./scheduled";

export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledEvent, _env: unknown, ctx: ExecutionContext): void {
    ctx.waitUntil(runCloudSweep());
  },
};
```

Add to `wrangler.jsonc` (value from Task 0):

```jsonc
  "triggers": { "crons": ["*/15 * * * *"] },
```

Run `bun run cf:gen-types` in `apps/server-hono` so `ScheduledEvent`/`ExecutionContext` are typed.

- [ ] **Step 2: Enable account deletion with a purge hook**

```ts
// packages/infra-auth/src/hooks/enqueue-purge.ts
import { db } from "@kaipu/infra-db/client";
import { CloudPurgeRepository } from "@kaipu/infra-db/repositories";

/**
 * Runs before Better Auth deletes the user row. The database cascade removes every
 * cloud row, so this queue entry is the only surviving reference to the account's
 * R2 prefixes — the scheduled sweep drains it (`purgeAccountObjects`).
 */
export async function enqueueCloudPurge(user: { id: string }): Promise<void> {
  await new CloudPurgeRepository(db).enqueue(user.id);
}
```

In `base-config.ts` add (next to `emailAndPassword`):

```ts
  user: {
    deleteUser: {
      enabled: true,
      beforeDelete: async (user) => {
        await enqueueCloudPurge(user);
      },
    },
  },
```

with `import { enqueueCloudPurge } from "../hooks/enqueue-purge";`. Export the hook from the package
index if `packages/infra-auth/src/index.ts` re-exports config helpers.

- [ ] **Step 3: Verify locally**

Run: `bun run check-types --filter=server-hono --filter=@kaipu/infra-auth`. Expected: clean.
Run: `bun run dev:server-hono`, then trigger the cron once:
`curl "http://localhost:3000/__scheduled?cron=*/15+*+*+*+*"` (wrangler dev exposes this when
`--test-scheduled` is passed; add `--test-scheduled` to the `dev` script). Expected: a
`cloud.sweep` JSON line in the wrangler output with zero counts.
Manual purge check: create a throwaway user, upload one asset through the API (Task 10 routes with
`curl` + the ticket headers), call Better Auth `POST /api/auth/delete-user`, trigger the cron, then
`listObjectKeys("videos/<userId>/")` via a one-off script prints no keys.

- [ ] **Step 4: Commit**

```bash
git add apps/server-hono packages/infra-auth
git commit -m "feat(server): scheduled cloud sweep, cron trigger and account purge on delete"
```

---

### Task 12: Remove the legacy recording vertical and migrate the web consumer

**Files:**

- Delete: `packages/domain/src/schemas/recording.ts`, `packages/domain/src/schemas/recording.test.ts`,
  `packages/domain/src/repositories/recording.repository.ts`, `packages/application/src/recordings/`,
  `packages/infra-db/src/schema/recording.ts`, `packages/infra-db/src/repositories/recording.repository.ts`,
  `packages/infra-db/src/mappers/recording.mapper.ts`, `apps/server-hono/src/contract/recording.contract.ts`,
  `apps/server-hono/src/modules/recording/`.
- Modify: barrels in domain/application/infra-db, `packages/infra-db/src/schema/auth.ts` (drop
  `recordings` relation), `apps/server-hono/src/contract/index.ts`, `apps/server-hono/src/router.ts`,
  `packages/domain/src/services/storage.service.ts` (drop `createUploadUrl`/`objectExists`),
  `packages/infra-storage/src/r2-storage.ts` + test (same), `packages/application/src/cloud/fakes.ts` (same).
- Modify: `apps/web-hono/src/hooks/use-recordings.ts`, `apps/web-hono/src/routes/_authenticated/recordings/index.tsx`.

- [ ] **Step 1: Delete the legacy files and fix barrels**

Remove the "Recording schemas + pure rules" block from `packages/domain/src/schemas/index.ts`, the
`IRecordingRepository`/`CreateRecordingData` export from `repositories/index.ts`, `export * from "./recordings"`
from the application index, `export * from "./recording"` from the infra-db schema index, the
`RecordingRepository` export, and the `recordings: many(recordingTable)` relation in `auth.ts`.
Now export the cloud `extensionForContentType` from the domain schemas barrel.

Drop `createUploadUrl` and `objectExists` from the port, the R2 adapter, its tests and the fakes.

- [ ] **Step 2: Migrate the web hook**

```ts
// apps/web-hono/src/hooks/use-recordings.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client, orpc } from "@/lib/orpc-client";

export const recordingKeys = {
  all: ["cloud-assets"] as const,
  list: () => [...recordingKeys.all, "list"] as const,
};

export const recordingsQueryOptions = () => ({
  ...orpc.cloud.list.queryOptions({ input: { limit: 100 } }),
  queryKey: recordingKeys.list(),
});

export const useRecordings = () => useQuery(recordingsQueryOptions());

export const useDeleteRecording = () => {
  const queryClient = useQueryClient();
  return useMutation({
    ...orpc.cloud.deleteCloudCopy.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: recordingKeys.all });
    },
  });
};

/** Mint a short-lived presigned GET and hand it to the browser (the bucket is private). */
export const useOpenRecording = () =>
  useMutation({
    mutationFn: async (assetId: string) => {
      const response = await client.cloud.downloadUrl({ assetId });
      const url = response.data?.downloadUrl;
      if (!url) throw new Error(response.error?.message ?? "No download URL was returned");
      return url;
    },
  });
```

In `routes/_authenticated/recordings/index.tsx`: `const recordings = response?.data?.items ?? [];`,
`key={recording.assetId}`, `handleOpen(recording.assetId)`, `handleDelete` calls
`deleteRecording.mutate({ assetId })`, the `status === "pending"` class and the
`disabled={recording.status !== "ready" …}` guard become `recording.currentRevisionId === null`,
and `formatBytes(recording.sizeBytes ?? 0)`. Replace the binary `formatBytes` body with
`formatDecimalBytes` from `@kaipu/domain/constants` (web-hono already depends on `@kaipu/domain`;
if not, add `"@kaipu/domain": "workspace:*"`).

- [ ] **Step 3: Verify everything**

Run: `bun run check-types && bun run test && bun run check`. Expected: all green, no reference to
`recordingTable`, `MAX_UPLOAD_BYTES` or `objectExists` remains (`grep -rn "recordingTable\|MAX_UPLOAD_BYTES\|objectExists" apps packages --include=*.ts --include=*.tsx` prints nothing).
Run `bun run db:push` (dev DB) — drizzle drops `kaipu_record_recording`; accept the prompt (it holds
no real data — the backend was only validated locally). Run `bun run db:generate` and commit the SQL.

- [ ] **Step 4: Commit**

```bash
git add -A packages apps/server-hono apps/web-hono
git commit -m "refactor: replace the legacy recording vertical with cloud assets"
```

---

### Task 13: Docs, backlog status, WAF runbook and CI secret

**Files:**

- Create: `apps/documentation/src/content/docs/backend/cloud-storage.md`
- Modify: `apps/documentation/src/content/docs/backlog/r2-upload-integrity.md`, `cloud-data-lifecycle.md`,
  `api-abuse-controls.md`, `cloud-recordings-upload.md`, `desktop-cloud-sync-gap.md`, `index.mdx`
- Modify: `.github/workflows/*` (the workflow that runs package tests — add `TEST_DATABASE_URL` secret and a `bun run test:integration` step)

- [ ] **Step 1: Write the operational reference** `backend/cloud-storage.md` with these sections, each
      filled from the code above (no "see plan"): _Model_ (asset / revision / accounting row, status
      table), _Quota enforcement_ (the conditional UPDATE, why no transaction, reconcile), _Tickets_
      (the four signed headers and what each blocks, TTL + grace), _Confirm verification_, _Lifecycle
      and sweep_ (cron, batch sizes, purge queue, `maxAttempts`), _Operator actions_ with SQL:

```sql
-- grant beta access
INSERT INTO kaipu_record_cloud_access (user_id, note) VALUES ('<user id>', 'beta wave 1');
-- revoke
UPDATE kaipu_record_cloud_access SET revoked_at = now() WHERE user_id = '<user id>';
-- stop new uploads globally (reads/deletes keep working)
UPDATE kaipu_record_cloud_control SET uploads_enabled = false WHERE id = 'global';
-- accounts with stuck purges
SELECT * FROM kaipu_record_cloud_purge WHERE done_at IS NULL AND attempts >= 10;
```

_Rate limiting (WAF)_: the rules to create in the Cloudflare dashboard for `kaipu-api`, one per
route family (`/api/v1/assets/upload-intents`, `…/confirm`, `…/download-url`, `DELETE …/cloud`,
`/api/auth/sign-in/email`), counting by `http.request.headers["authorization"]` hash or the
session cookie, thresholds from Task 0, action _block_ for 10 minutes; note that the app-level
pending cap is what fails closed if the WAF is misconfigured. _Events_: the `cloud.*` names and
fields. _Production checklist_: link to `backlog/production-cloud-security.md` and list: apply
migration SQL, seed `cloud_control`, set R2 secrets, create WAF rules, verify one cron run in the
dashboard.

- [ ] **Step 2: Update backlog statuses honestly**

- `r2-upload-integrity.md` → `🟢 Ready to validate` once Task 12 is merged; keep the Evidence section.
- `cloud-data-lifecycle.md` → `🟢 Ready to validate`, noting purge `maxAttempts` and the alert gap
  (bounded-failure alerting is a dashboard alert on `cloud.sweep.failed`, not code).
- `api-abuse-controls.md` → `🟡 In progress`: quota, pending cap, MIME allowlist and pagination
  shipped; WAF rules are an operator step (runbook above).
- `cloud-recordings-upload.md` → mark the vertical as replaced by cloud assets; link `backend/cloud-storage.md`.
- `desktop-cloud-sync-gap.md` → record the two model decisions as taken: link = client-minted
  `assetId` with a server unique per account; thumbnail = auxiliary object per revision.
- `index.mdx` → update those rows; add a row for the cloud epic pointing at the specs and plans 01/02.

- [ ] **Step 3: CI** — add the `TEST_DATABASE_URL` GitHub secret (a dedicated Neon branch) and a
      step running `bun run test:integration` after the unit tests in the package workflow.

- [ ] **Step 4: Verify docs build** — `bun run build --filter=documentation` (from the root). Expected:
      builds; the new page appears under Backend in the sidebar (autogenerated).

- [ ] **Step 5: Commit**

```bash
git add apps/documentation .github
git commit -m "docs(cloud): server storage reference, WAF runbook and backlog status after plan 01"
```

---

## Self-review against the spec

| Spec requirement                                                               | Task                                                               |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Decimal units, 1 GB free / 25 GB future / 1 GB video / 25 MB screenshot        | 2, 4                                                               |
| Quota = used + reserved + new, atomic under concurrency, client cannot lie     | 8 (conditional UPDATE + real-DB test), 9 (confirm verifies length) |
| Idempotency key per intent, no duplicate reservations                          | 9 (`findByIntentKey`), 7 (unique index)                            |
| Tickets immutable; reuse cannot overwrite a ready object                       | 1 (evidence), 6 (`If-None-Match: *`)                               |
| Confirm verifies size/type/hash; repeated confirm no double count              | 9, 8 (`markReady` idempotent)                                      |
| Pending cap and duration per account                                           | 8/9 (`maxPending`), 9 (sweep)                                      |
| Entitlements carry capacity + cloud permission, enforced server-side           | 4, 9                                                               |
| Beta access + global switch                                                    | 7/8 (`cloud_access`, `cloud_control`), 9                           |
| Cleanup of expired reservations, retried deletes, tombstones, account deletion | 7, 9, 11                                                           |
| Reconcilable accounting                                                        | 8 (`reconcile`), 11                                                |
| Telemetry without URLs/secrets                                                 | 10                                                                 |
| Paginated catalog                                                              | 8, 10                                                              |
| Auto-upload exclusion persisted server-side after cloud delete                 | 8 (`beginDelete`), 9/10                                            |
| Migration artifact for production                                              | 7, 12                                                              |
| Rate limits (operator)                                                         | 0, 13                                                              |

Out of scope by design (later plans): share links and public reads (04), link update with
compare-and-swap (06), automatic upload (05), desktop client (02/03).
