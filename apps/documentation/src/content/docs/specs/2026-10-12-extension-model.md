---
title: "Extension model: feature tables linked to any entity, and server-side hooks"
description: "Proposed design for how a new feature gets its own tables related to an existing row by a real foreign key, how that relation is approved, and how our own code reacts to domain events through a registered, audited, kill-switchable hook — with no uploaded scripts. Accepted by the owner on 2026-10-12."
---

# Extension model: feature tables linked to any entity, and server-side hooks

**Status: ✅ Accepted — owner decisions 2026-10-12 (see Approved decisions).** Linear
[NIW2-329](https://linear.app/niway/issue/NIW2-329). Nothing in this document is
implemented; every code block is illustrative. The approval gate depends on
committed migrations, which belong to
[NIW2-328](https://linear.app/niway/issue/NIW2-328) and are not on `main` either.

## Summary (one minute)

The owner's goal, translated: _new features get their own place and don't get in
the way — new tables that relate to whatever id we choose (user, account, any
table); we just relate them and approve. And a custom script triggered from our
side should just be passing it a method._ Other parties will use the product with
us, so none of this may open a security hole.

Two mechanisms answer that, both already half-present in the repo's habits:

1. **A feature owns its tables.** Each feature adds one Drizzle schema module
   under `packages/infra-db/src/schema/`, with a real Postgres foreign key to the
   row it extends (`user.id`, `recording.id`, `cloud_asset`, any table) and an
   `onDelete` rule stated in the feature's doc. Existing tables are never
   altered. "Relate and approve" is a pull request that carries the schema file,
   its generated SQL migration and the feature doc, reviewed by the owner
   (CODEOWNERS) and checked by CI. This is how `subscription` and the `cloud_*`
   tables already live next to Better Auth's tables (ADR 0002), made into a rule.
2. **A hook is a function registered in our repository.** Use cases emit typed
   domain events through a domain port after their own write succeeds. A static,
   code-reviewed registry maps event names to handlers; the dispatcher records one
   `hook_run` row per `(event, handler)` (idempotency and audit), runs the handler
   with a hard timeout inside `waitUntil`, never throws into the request, and can
   be switched off per handler by an operator without a deploy. Nobody uploads
   code. If a true third-party plugin is ever wanted, the safe forms are a signed
   webhook to the partner's own server or Workers for Platforms — both are a
   separate decision, not this one.

| #   | Decision                                                                                                                                                                                                                                                                    | Why                                                                                                                                                                                                                                                                              | ADR                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | A feature extends an entity with **its own table and a real foreign key** to that entity, in its own schema module. Owner tables (`user`, `session`, `account`, `verification`) and other features' tables are never altered.                                               | Postgres enforces the relation and the delete rule; the feature can be added or dropped as one migration; it is the pattern ADR 0002 set for `subscription` and the cloud tables already follow.                                                                                 | none now — candidate ADR once the owner confirms the anchor entity (question 2); reuses ADR 0002's rule |
| 2   | A **polymorphic link table** (`entity_type`, `entity_id`) is allowed only for cross-cutting, non-critical annotations, and is not built in this spec.                                                                                                                       | Postgres cannot enforce a foreign key whose target table varies, so deletes orphan silently — the opposite of the cascade-and-purge promise the cloud tables rely on.                                                                                                            | none                                                                                                    |
| 3   | **"Approve" is a reviewed pull request** carrying schema + generated migration + feature doc, with CODEOWNERS review and CI checks. An in-product approval flow is out of scope.                                                                                            | The reviewable, repeatable, reversible artifact is the migration file; today's `db:push` has none. The gate reuses the Actions-on-every-PR rule of ADR 0010.                                                                                                                     | reuses NIW2-328's migrations ADR (drafted there as 0011, not on `main`); none created here              |
| 4   | **Hooks are our code**: a static registry in the repo, reviewed like any code; events are typed; handlers receive declared ports, never the raw database handle, never the request or session.                                                                              | User-uploaded code in the API Worker would run with the Worker's secrets and database. Every safe way to run someone else's code (webhooks, Workers for Platforms, a JS sandbox) is its own infrastructure decision.                                                             | none now — candidate ADR "hooks are registered code, not uploaded scripts" once question 1 is answered  |
| 5   | **Dispatch point is the use case**, through a domain port `IHookDispatcher`, after the state change has been written. Not a database trigger, not the router, not Better Auth alone.                                                                                        | A use case is called from routers, operator scripts and the scheduled handler; emitting there means every caller fires the same hooks, and a fake port makes it testable. Better Auth's `databaseHooks` are one event _source_ (identity lifecycle) feeding the same dispatcher. | none                                                                                                    |
| 6   | **`hook_run` is the outbox and the audit log**: one row per `(event_id, handler_id)`, unique, with status, attempts, error name and timestamps; ids only in the payload. The scheduled handler drains failed and stale rows.                                                | Gives idempotency (a retry is a no-op), an audit trail (who ran, when, outcome) and retries without a queue. One feature table, following decision 1.                                                                                                                            | none                                                                                                    |
| 7   | **In-process first, queue later behind the same port.** Phase 1 runs handlers inside `ctx.waitUntil` with a per-handler timeout. Phase 2 swaps in a Cloudflare Queues producer and a consumer Worker when a handler needs delivery guarantees the request path cannot give. | Phase 1 needs no new Cloudflare resources and reuses the `scheduled()` export NIW2-328 adds. The port hides the transport, so the swap touches `apps/server-hono` only.                                                                                                          | none                                                                                                    |
| 8   | **Kill switch per handler id** in a small control table flipped by an operator script, like `cloud_control`; a disabled handler is skipped and the skip is recorded.                                                                                                        | A misbehaving hook must be stoppable without a deploy, and the record proves it was stopped.                                                                                                                                                                                     | none                                                                                                    |

**Open questions** (each one's effect on the design is in
[How each answer changes the design](#how-each-owner-answer-changes-the-design)):

1. Who writes the custom script: our team only (registered functions in the repo)
   or third parties? Third-party code needs a sandbox decision before any design.
2. Who are the other parties: end users, partner developers, or organizations
   sharing data? Organizations need the workspace concept ADR 0002 deferred —
   and decide what "account" means in "user, account, any table" (Better Auth's
   `account` is a login method, not a workspace).
3. Does "approve" mean a pull-request review or an in-product approval flow?
4. Is there a staging database or Neon branching today?
5. What is the data retention and deletion promise, R2 included?
6. _(found while designing)_ May a hook handler write to tables outside its own
   feature, or only to its own?
7. _(found while designing)_ Which events must be delivered at least once (for
   example "purge this account's objects") and which may be best-effort (for
   example "send a welcome email")? That line decides when phase 2 starts.
8. _(found while designing)_ Who may approve a destructive migration (drop
   table/column, changed `onDelete`), and does it need a second reviewer?

**Out of scope:** a workspace or organization entity; payment-provider webhooks;
Postgres row-level security; a sandbox for third-party code; a UI for approvals;
the integrity fixes, cron wiring and migration baseline themselves (NIW2-328);
migrating existing tables to the pattern; Neon branch automation (depends on
question 4).

## Context

What exists on `main` at the time of writing, from the private audit
`audit-5-db.md` (2026-10-12) and a read of the code:

- Postgres on Neon over the HTTP driver (`packages/infra-db/src/client/index.ts`,
  `drizzle-orm/neon-http`). One HTTP request per statement; no interactive
  transactions, only `batch`.
- Ten tables, all prefixed `kaipu_record_` through `pgTableCreator`
  (`packages/infra-db/src/utils/table-creator.ts`). Four are Better Auth's
  (`schema/auth.ts`); `recording`, `subscription` and the five `cloud_*` tables
  are the app's, each in its own schema file and each referencing `user.id` with
  `onDelete: "cascade"`. `schema/index.ts` re-exports the files;
  `drizzle.config.ts` reads the `./src/schema` directory.
- No migration files. `drizzle.config.ts` points `out` at a directory that does
  not exist; schema changes ship by a human running `bun run db:push`, including
  against production (`commands.md`: "the project stays on `db:push` until an ADR
  adopts migrations"). The release workflow does not touch the schema.
- Ownership is enforced only in application code: every repository method
  filters by `user_id`, and the id comes from the Better Auth session in
  `authMiddleware`, never from input. There is no row-level security.
- No event bus, queue, cron trigger or Better Auth database hook. `logEvent`
  (`apps/server-hono/src/lib/events.ts`) writes one JSON line per event to
  stdout, ids and counts only. Routers call it after a use case returns.
- Use cases already have the shape a hook needs: a function taking ports and
  returning a result (`packages/application/src/cloud/confirm-upload.ts`), called
  from a router, an operator script (`apps/server-hono/scripts/plan.ts`) or — in
  NIW2-328 — a `scheduled()` handler.
- `CODEOWNERS` is `* @csdev19`: the owner is already requested on every pull
  request. `lefthook.yml` runs lint, format and types on push; everything else
  runs in Actions (ADR 0010).

Reusable guidance this design applies, not repeats: the hub's
[application layer](https://github.com/csdev19/general-knowledge/blob/main/architecture/application-layer.md)
(ports, use cases, who wires what),
[domain layer contracts](https://github.com/csdev19/general-knowledge/blob/main/architecture/domain-layer-contracts.md),
[security hardening](https://github.com/csdev19/general-knowledge/blob/main/architecture/security-hardening.md)
(authorization at the query level: the owner id is a parameter of the repository
interface), the domain-events pattern in
[bounded contexts](https://github.com/csdev19/general-knowledge/blob/main/architecture/bounded-contexts-complete-guide.md),
[observability](https://github.com/csdev19/general-knowledge/blob/main/architecture/observability.md)
(what a log line may carry), and the
[ADR pattern](https://github.com/csdev19/general-knowledge/blob/main/conventions/adr-pattern.md).

## State of the art, briefly

What other systems do, as the basis for the options below. Sources are in
[References](#references).

- **Per-module schemas with real foreign keys** is the default in ORM-centred
  codebases: Drizzle reads a directory of schema files and generates one SQL
  migration per change; the "schema per feature" split is a file layout, not a
  database feature (Drizzle documents "schema in multiple files", collected from
  a directory). Drizzle's own docs call `push` "the best approach for rapid
  prototyping" and give `generate` + `migrate` + `check` for a shared history —
  `check` exists precisely for several developers changing the schema on
  different branches.
- **Polymorphic associations** (`owner_type` + `owner_id`, as in Rails) are
  convenient and unenforceable: Postgres has no foreign key whose target depends
  on another column. The known mitigations — one nullable FK column per target
  with a CHECK that exactly one is set ("exclusive arc"), or one link table per
  target — are both ways of getting back to real foreign keys.
- **JSONB** is the right tool for data whose shape is unknown or per-row, and the
  wrong tool for relations: no foreign key, no cascade, and indexing only through
  GIN or expression indexes planned in advance.
- **Events.** Three deliveries are common. In-process after-commit callbacks are
  the simplest and lose the event if the process dies. The transactional outbox
  writes the event in the same transaction as the state change and a relay
  delivers it, which is the standard answer to "never lose an event" — and
  needs a transaction, which the Neon HTTP driver only offers as `batch`.
  Managed queues (Cloudflare Queues) give at-least-once delivery — duplicates
  are possible, so the docs say to key each message by a unique id — with
  retries, a dead-letter queue and batched consumer Workers (128 KB per
  message, up to 100 retries, up to 14 days of retention); Cloudflare
  Workflows add durable multi-step execution with per-step retries. Workers'
  `ctx.waitUntil` keeps work running after the response for up to 30 seconds
  on HTTP-triggered Workers; pending promises past that are cancelled, and the
  docs point to a Queue for anything longer. It is best-effort and not
  retried.
- **Exposing hooks to others.** Products that let outsiders react to events do
  it with **webhooks** (signed payloads, idempotency keys, retries with backoff;
  Stripe's rules and the Standard Webhooks spec are the common reference), or
  by running the outsider's code in a **separate isolate** (Cloudflare Workers
  for Platforms, where each tenant script is a Worker in a dispatch namespace
  the platform calls by name). Supabase's database webhooks and Postgres
  triggers fire from inside the database, which couples the hook to the table
  and runs it with the database's privileges. Better Auth offers
  `databaseHooks` (before/after create, update and delete on `user`, `session`
  and `account`) and `user.deleteUser` callbacks for the identity lifecycle;
  its docs note that on a database without transactions an after-hook may run
  even if a later step of the same operation fails — which is our case on the
  HTTP driver. None of these run user-supplied code inside the host's own
  process.
- **Isolation of untrusted code** without a platform service means a JS sandbox
  (`isolated-vm`, QuickJS compiled to WebAssembly — the route Figma reportedly
  took for plugins after its first sandbox was escaped). It is a product of its
  own, with its own security review, and is not available inside a Cloudflare
  Worker. Cloudflare's own security model page calls isolate isolation "not a
  complete defense" against Spectre-class attacks and lists its mitigations;
  any sandbox we picked would inherit that honesty.

## Options

### Where a feature's data lives

1. **Per-feature schema module with typed foreign keys** (recommended).
   Implications: one file per feature in `packages/infra-db/src/schema/`, a
   `references()` to the extended row with an explicit `onDelete`, an index on
   that column, its own repository, its own migration. Joins are plain indexed
   joins. The feature can be dropped as one migration. Strongest argument
   against: every new relation is a deploy and a migration — not self-service,
   and `schema/index.ts` becomes a merge hotspot (mitigated by relations defined
   on the feature's side only, never in `userRelations`). Recommendation: the
   default for everything with a lifecycle (ownership, deletion, quota).
2. **Polymorphic link table** (`entity_type`, `entity_id`, `feature_row_id`).
   Implications: one table for every relation, no migration per feature, a
   composite index on `(entity_type, entity_id)`, a type discriminator in every
   query, no Drizzle relation. Strongest argument against: Postgres cannot
   enforce it — deleting a user leaves links behind unless code cleans them up,
   which is exactly the orphan problem NIW2-328 exists to close for R2 objects.
   Recommendation: allowed only for annotations whose loss is harmless (tags,
   notes, bookmarks); not built here.
3. **JSONB column on the extended table** (`user.metadata`, `recording.extra`).
   Implications: zero migrations after the first, no type, no foreign key, poor
   filtering, and the feature's data rides inside a row another module owns —
   including Better Auth's `user`, which it reads on every session. Strongest
   argument against: ADR 0002 rejected this coupling for the plan, one level
   up; it is the same mistake with a different column. Recommendation: no.
4. **A Postgres schema (namespace) per extension, with its own role.**
   Implications: cross-schema foreign keys still work; drizzle-kit needs
   `pgSchema` instead of the prefix-based `pgTableCreator` and `tablesFilter`
   the repo uses; roles and grants to manage; the Neon HTTP driver does not
   make per-request roles easier. Strongest argument against: it only pays
   off when different parties get different database privileges, which is
   not the case while all code is ours. Recommendation: the reopen path if
   untrusted code ever gets database access (question 1).

### How a hook is triggered and run

1. **In-process after the use case's write, inside `ctx.waitUntil`**
   (recommended as phase 1). Implications: no new Cloudflare resources; the
   handler runs after the response is sent; a per-handler `AbortSignal.timeout`
   bounds it; `hook_run` records it. Strongest argument against: best-effort —
   if the isolate is evicted or the time budget runs out, the run is lost unless
   something retries it (the scheduled drain, below). Recommendation: start
   here, with the drain, and measure.
2. **Outbox row written with the state change, drained by the scheduled
   handler.** Implications: at-least-once if the row is written in the same
   `batch` as the state change, which means the repository methods that emit
   must accept the outbox insert as part of their batch — a signature change per
   emitting write. Latency is the cron interval. Strongest argument against:
   it rewrites the repositories to get a guarantee only some events need
   (question 7). Recommendation: adopt for the specific events the owner
   names as must-deliver (account purge is the obvious one); `hook_run` is
   already the outbox table, so this is a change in _when_ its row is inserted,
   not a new table.
3. **Cloudflare Queues producer + consumer Worker** (recommended as phase 2).
   Implications: at-least-once delivery, retries with backoff, a dead-letter
   queue, batch consumption, a second Worker (or a `queue()` export on the API
   Worker) and a queue binding in `wrangler.jsonc`. Strongest argument against:
   new infrastructure to operate and observe before a single handler needs it;
   the same at-least-once still needs the idempotent `hook_run` to be safe.
   Recommendation: behind the same port, when question 7 names a must-deliver
   event with a long-running handler.
4. **Cloudflare Workflows.** Implications: durable, multi-step handlers with
   per-step retries and sleeps — ideal for "verify, then purge, then confirm"
   sequences. Strongest argument against: it is a programming model, not a
   trigger; it answers what a long handler looks like, not how it is fired.
   Recommendation: a handler implementation detail for phase 2, not the
   dispatcher.
5. **Postgres triggers / database webhooks.** Implications: fire on any write,
   including writes the application did not make. Strongest argument against:
   the trigger runs with the database's privileges and outside the hexagonal
   layering; Supabase's version is a wrapper over `pg_net`, an extension Neon
   would have to provide for the trigger to reach the Worker at all.
   Recommendation: no.
6. **Better Auth `databaseHooks` as the only trigger.** Implications: covers
   `user`/`session`/`account` create, update and delete, plus the `deleteUser`
   callbacks; covers nothing else, and on the non-transactional HTTP driver an
   after-hook can fire for an operation whose later step then fails. Strongest
   argument against: it is one source among several, not a dispatcher.
   Recommendation: use it as an event source that calls `emit`, for the
   identity lifecycle only, with handlers that tolerate the false-positive
   case (an idempotent "enqueue purge" for a user row that still exists is a
   harmless no-op once the purge checks the row).
7. **Signed webhooks to a partner's server.** Implications: the partner runs
   their own code on their own infrastructure; we sign the payload, retry, and
   expose nothing but ids. Strongest argument against: it requires a partner who
   operates a server, and an outbound allow-list. Recommendation: the right
   answer if question 1 says "third parties"; one more handler kind behind the
   same registry, designed in its own spec.
8. **Workers for Platforms** (a Worker per tenant in a dispatch namespace).
   Implications: real isolation, Cloudflare-managed, per-tenant limits and
   outbound control. Strongest argument against: a paid platform product and a
   deployment pipeline for other people's code, for a need nobody has stated.
   Recommendation: the reopen path for "third parties upload code", together
   with option 4 of the previous list.

## The table-extension pattern

### Rules a feature table follows

1. The feature references the extended entity; the entity never references the
   feature. No column is ever added to `user`, `session`, `account`,
   `verification` or another feature's table for a new feature.
2. Every column that points at another row is a real foreign key with an
   explicit `onDelete`, written in the feature doc with one sentence on why
   (`cascade` for "this is part of the user's data", `restrict` for "this must
   be removed on purpose first", `set null` for "the reference is optional").
3. Every foreign-key column has an index, and any table scoped to a user has a
   `user_id` column with a foreign key to `user.id` even when it also references
   a narrower row — so the owner filter is one column away on every query.
4. Repository methods that read or write user-owned rows take `userId` as a
   required parameter and put it in the `WHERE`; the port declares it (hub:
   security hardening). A small `ownedBy(table, userId)` helper in `infra-db`
   is the one place the filter is spelled.
5. Enum-like text columns carry a CHECK constraint generated from the domain
   enum; timestamps use one shared helper. (NIW2-328 decides whether the helper
   moves to `timestamptz`; a new table should not repeat the inline columns the
   existing files copy.)
6. Relations are declared in the feature's own file with `relations()`, never
   by editing `userRelations` in `auth.ts`.
7. A linked row that lives in another _store_ (an R2 key, a desktop asset id)
   is a snapshot, not a foreign key — the hub's
   [data by access pattern](https://github.com/csdev19/general-knowledge/blob/main/architecture/data-by-access-pattern.md),
   pattern 2. Only Postgres rows get foreign keys.
8. A test walks every table exported from `schema/index.ts` and fails when a
   `*_id` column has no foreign key, no index, or a foreign key without an
   explicit `onDelete`. This is the machine half of "approve"; the human half is
   the review.

### Where files live per layer

```
packages/domain/src/
  repositories/<feature>.repository.ts     port: interface with userId parameters
  schemas/<feature>.ts                     zod schema, enums, pure rules
packages/application/src/<feature>/
  <verb>-<noun>.ts                         use cases: take ports, return results, emit events
  <feature>.test.ts                        tests with fakes (see cloud/fakes.ts)
packages/infra-db/src/
  schema/<feature>.ts                      the table(s), FKs, indexes, relations — exported from schema/index.ts
  repositories/<feature>.repository.ts     Drizzle implementation; every query goes through ownedBy()
  mappers/<feature>.mapper.ts              row -> domain type
  migrations/NNNN_<feature>.sql            generated by db:generate, committed (NIW2-328 creates the directory)
apps/server-hono/src/
  contract/<feature>.contract.ts           oRPC contract
  modules/<feature>/<feature>.router.ts    wiring: repositories + storage + hooks into the use cases
apps/documentation/src/content/docs/
  backlog/<feature>.md                     status banner + the onDelete sentence + the events it emits/handles
```

Nothing is added to `schema/auth.ts`. The only shared file a feature touches is
`schema/index.ts` (one export line) and the router index.

### Worked example (illustrative — nothing here exists)

A "recording notes" feature: a user attaches short notes to one of their
recordings. It extends `recording`, not just `user`, to show the pattern for a
non-user anchor.

```ts
// ILLUSTRATIVE — packages/infra-db/src/schema/recording-note.ts
import { relations } from "drizzle-orm";
import { index, text, timestamp } from "drizzle-orm/pg-core";
import { createTable } from "../utils/table-creator";
import { userTable } from "./auth";
import { recordingTable } from "./recording";

/**
 * Notes a user attaches to their own recording. Part of the user's data:
 * deleting the recording or the user deletes the notes (cascade), nothing
 * else is affected.
 */
export const recordingNoteTable = createTable(
  "recording_note",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    recordingId: text("recording_id")
      .notNull()
      .references(() => recordingTable.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("recording_note_user_idx").on(t.userId),
    index("recording_note_recording_idx").on(t.recordingId, t.createdAt),
  ],
);

export const recordingNoteRelations = relations(recordingNoteTable, ({ one }) => ({
  recording: one(recordingTable, {
    fields: [recordingNoteTable.recordingId],
    references: [recordingTable.id],
  }),
}));
```

```ts
// ILLUSTRATIVE — packages/domain/src/repositories/recording-note.repository.ts
export interface IRecordingNoteRepository {
  /** Owner-scoped: returns [] for a recording the user does not own. */
  listByRecording(userId: string, recordingId: string): Promise<RecordingNote[]>;
  /** Owner-scoped: returns null when the recording is not the user's. */
  add(userId: string, recordingId: string, body: string): Promise<RecordingNote | null>;
}
```

```ts
// ILLUSTRATIVE — packages/application/src/recording-notes/add-recording-note.ts
export async function addRecordingNote(params: {
  notes: IRecordingNoteRepository;
  hooks: IHookDispatcher;
  userId: string;
  recordingId: string;
  body: string;
}): Promise<RecordingNote | null> {
  const note = await params.notes.add(params.userId, params.recordingId, params.body);
  if (!note) return null;
  // After the write. Never throws into this function (see the hook section).
  await params.hooks.emit({
    name: "recording.note.added",
    userId: params.userId,
    recordingId: params.recordingId,
    noteId: note.id,
  });
  return note;
}
```

The migration `db:generate` would produce creates one table, two indexes and
two foreign keys, and touches nothing else. Reviewing it is reviewing exactly the
relation the owner wants to approve.

To extend `cloud_asset` instead, the foreign key is composite:
`foreignKey({ columns: [t.userId, t.assetId], foreignColumns: [cloudAssetTable.userId, cloudAssetTable.assetId] })`
— the feature inherits the "a stranger's id only collides inside their own
account" property the composite primary key gives.

## The approval gate

Depends on NIW2-328 landing committed migrations (its ADR draft, 0011 "committed
migrations instead of push", is on that ticket's branch and not on `main`; this
spec reuses it and creates no second ADR). Until then, the gate below cannot be
enforced and `db:push` stays the documented path.

Illustrative flow, fitting the existing CI:

1. The author adds `schema/<feature>.ts`, exports it, and runs
   `bun run db:generate`. The SQL file lands in `packages/infra-db/src/migrations/`.
2. The pull request carries three things: the schema module, the SQL, and the
   feature doc with the `onDelete` sentence and the events it emits or handles.
   A pull request that changes the schema without a migration, or a migration
   without a doc, is incomplete.
3. Review is the approval. `CODEOWNERS` already routes every path to the owner;
   add explicit lines for `packages/infra-db/src/schema/**` and
   `packages/infra-db/src/migrations/**` so the rule survives if the wildcard
   is ever narrowed.
4. CI (`pr-checks.yml`, ADR 0010): `drizzle-kit check` on the migration folder;
   a no-diff check (`db:generate` on the branch produces no new file); the
   schema-rules test from rule 8; and, if question 4 says Neon branching exists,
   apply the migrations to a throwaway branch created from production's schema
   and drop it after the job.
5. The release workflow applies pending migrations before deploying the API
   Worker (NIW2-328's "owner steps"), replacing the manual "push the schema
   first" rule.
6. A migration containing `DROP`, a type change on an existing column, or a
   changed `ON DELETE` is labelled `migration:destructive` and needs an explicit
   approval comment in addition to the review (question 8 decides whether that
   is the same person).

What "approve" does _not_ include here: a runtime switch that makes a table
visible, a form where a party requests a table, or any schema change outside a
pull request. If question 3 says "in-product", see the answers section.

## The hook mechanism

### Domain port (illustrative)

```ts
// ILLUSTRATIVE — packages/domain/src/events/hooks.ts (pure, mobile-safe)

/** Ids only. Never a token, URL, storage key, email or user-chosen title. */
export type DomainEvent =
  | { name: "user.created"; userId: string }
  | { name: "user.deleted"; userId: string }
  | { name: "cloud.upload.confirmed"; userId: string; assetId: string; revisionId: string }
  | { name: "cloud.copy.deleted"; userId: string; assetId: string }
  | { name: "recording.note.added"; userId: string; recordingId: string; noteId: string };
// Adding a name is a reviewed change to this union.

export type DomainEventName = DomainEvent["name"];
export type EventOf<N extends DomainEventName> = Extract<DomainEvent, { name: N }>;

export interface HookContext {
  /** Stable per emit; with handlerId it is the idempotency key. */
  eventId: string;
  attempt: number;
  /** Aborted by the runner at the handler's timeout. */
  signal: AbortSignal;
  /** When the event happened, ISO 8601; not "now". */
  occurredAt: string;
}

export type HookHandler<N extends DomainEventName> = (
  event: EventOf<N>,
  ctx: HookContext,
) => Promise<void>;

export interface HookRegistration<N extends DomainEventName = DomainEventName> {
  /** Unique, stable, kebab-case; the audit row and the kill switch key on it. */
  handlerId: string;
  event: N;
  handler: HookHandler<N>;
  /** Hard wall-clock limit; default 5 000 ms, maximum what waitUntil can hold. */
  timeoutMs?: number;
  /** Default 3; after that the run is `dead` and an operational event is logged. */
  maxAttempts?: number;
}

/** What a use case sees. `emit` resolves once the runs are recorded; it never rejects. */
export interface IHookDispatcher {
  emit(event: DomainEvent): Promise<void>;
}

/** Test double and the default for scripts that must not fire hooks. */
export const noopHooks: IHookDispatcher = { emit: async () => {} };
```

The registry is a plain array of `HookRegistration` built in
`apps/server-hono/src/hooks/registry.ts` — the composition root, where ports
are wired today. A handler is a closure over the ports it needs:

```ts
// ILLUSTRATIVE — apps/server-hono/src/hooks/registry.ts
export const hookRegistry: HookRegistration[] = [
  {
    handlerId: "enqueue-account-purge",
    event: "user.deleted",
    timeoutMs: 2_000,
    maxAttempts: 5,
    handler: async (e, ctx) => enqueueAccountPurge({ purge, userId: e.userId, signal: ctx.signal }),
  },
  {
    handlerId: "welcome-email",
    event: "user.created",
    handler: async (e, ctx) => sendWelcomeEmail({ email: getEmail(), users, userId: e.userId, signal: ctx.signal }),
  },
];
```

"Passing it a method" is exactly this: a reviewer sees one object with an id, an
event name and a function.

### Dispatch point

- **Use cases** call `hooks.emit(...)` after their repository write returned
  successfully, as `addRecordingNote` shows. The port is a required dependency;
  tests and scripts pass `noopHooks` or a recording fake.
- **Better Auth** feeds the identity lifecycle: `databaseHooks.user.create.after`
  emits `user.created`; `user.deleteUser.afterDelete` emits `user.deleted`.
  These callbacks live in `apps/server-hono/src/lib/auth.ts` next to the
  existing email callbacks and call the same dispatcher. (`user.deleted` is
  what NIW2-328 needs to enqueue the R2 purge; the event is the generic form of
  that fix.)
- **The scheduled handler** (`scheduled()` export plus `triggers.crons`, from
  NIW2-328) does two things for hooks: drains `hook_run` rows that are `failed`
  or stuck in `running` past their timeout and under `maxAttempts`, and emits
  time-based events if any are ever defined.
- **Routers** do not emit. They keep calling `logEvent` for operational logs;
  the two are different things (a log line is not retried; a hook run is).

### The `hook_run` table (a feature table under this spec's own rules)

| Column                                                       | Meaning                                                                                  |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `event_id`                                                   | Stable id minted by `emit`; with `handler_id` the unique key                             |
| `handler_id`                                                 | From the registration                                                                    |
| `event_name`                                                 | For queries and the kill switch                                                          |
| `subject_user_id`                                            | The user the event is about — **no foreign key**: a `user.deleted` run outlives the user |
| `payload`                                                    | The event's ids as JSON, nothing else; small by construction                             |
| `status`                                                     | `pending` → `running` → `done` / `failed` / `dead` / `skipped` (kill switch)             |
| `attempts`                                                   | Incremented when a run starts                                                            |
| `last_error_name`                                            | `err.name` only, never the message                                                       |
| `created_at`, `started_at`, `finished_at`, `next_attempt_at` | Timing and backoff                                                                       |

Unique `(event_id, handler_id)`; index `(status, next_attempt_at)` for the
drain; index `(subject_user_id, created_at)` for the audit question "what ran
for this account". Rows are retention-limited (question 5): an operator script
or the drain deletes `done` rows older than N days.

### The runner (illustrative — `apps/server-hono/src/hooks/dispatcher.ts`)

```ts
// ILLUSTRATIVE
export function createInProcessDispatcher(deps: {
  runs: IHookRunRepository;         // the hook_run table, through a port
  switches: IHookSwitchRepository;  // the kill switch table, through a port
  registry: HookRegistration[];
  waitUntil: (p: Promise<unknown>) => void;  // from the Worker's ExecutionContext
}): IHookDispatcher {
  return {
    async emit(event) {
      try {
        const eventId = crypto.randomUUID();
        const handlers = deps.registry.filter((r) => r.event === event.name);
        if (handlers.length === 0) return;
        await deps.runs.createPending(eventId, event, handlers.map((h) => h.handlerId)); // one batch
        deps.waitUntil(runAll(deps, eventId, event, handlers));
      } catch (err) {
        logEvent({ name: "hook.emit.failed", event: event.name, error: err instanceof Error ? err.name : "unknown" });
        // Swallowed on purpose: a hook must never fail a sign-up or an upload.
      }
    },
  };
}

async function runOne(deps, eventId, event, reg: HookRegistration): Promise<void> {
  if (!(await deps.switches.isEnabled(reg.handlerId))) {
    await deps.runs.markSkipped(eventId, reg.handlerId);
    return;
  }
  const claimed = await deps.runs.claim(eventId, reg.handlerId); // UPDATE ... WHERE status IN ('pending','failed') RETURNING attempts
  if (!claimed) return; // another isolate or the drain already has it — idempotent
  const signal = AbortSignal.timeout(reg.timeoutMs ?? 5_000);
  try {
    await reg.handler(event, { eventId, attempt: claimed.attempts, signal, occurredAt: claimed.createdAt });
    await deps.runs.markDone(eventId, reg.handlerId);
  } catch (err) {
    const dead = claimed.attempts >= (reg.maxAttempts ?? 3);
    await deps.runs.markFailed(eventId, reg.handlerId, err instanceof Error ? err.name : "unknown", dead);
    logEvent({ name: dead ? "hook.run.dead" : "hook.run.failed", handlerId: reg.handlerId, eventId });
  }
}
```

Phase 2 replaces `deps.waitUntil(runAll(...))` with `queue.send({ eventId })`
and moves `runAll` into the queue consumer. `emit`, the registry, the port and
`hook_run` do not change.

### Failure isolation, timeouts, idempotency, kill switch

- **Isolation.** `emit` catches everything; the request path cannot fail because
  of a hook. A handler's failure is recorded on its own row; other handlers for
  the same event still run.
- **Timeouts.** Each handler gets an `AbortSignal` the runner aborts at its
  `timeoutMs`; handlers pass it to `fetch` and to repository calls that accept
  it. The runner's own ceiling is the 30 seconds `waitUntil` allows after the
  response, shared by every handler of the event, so the default per-handler
  budget is small (5 s) and the sum of a registration's timeouts for one event
  is checked by a test; a handler that needs more moves to phase 2 (a Queue
  consumer or a Workflow).
- **Idempotency.** `(event_id, handler_id)` is unique and `claim` is one
  conditional `UPDATE`, which the HTTP driver serialises through the row lock —
  the same trick `cloud_storage_account` uses for quota. A retry of a `done` row
  is a no-op; a handler must still tolerate being called twice with the same
  event, because a crash between the handler finishing and `markDone` is
  possible.
- **Kill switch.** A `hook_switch` table (`handler_id`, `enabled`, `updated_at`,
  `reason`), flipped by an operator script in `apps/server-hono/scripts/`
  (like `plan.ts` and the `cloud:uploads` switch), never through the API.
  A disabled handler is `skipped` and the skip is a row, so "it did not run" is
  provable. An empty table means everything is enabled.
- **Backoff.** `next_attempt_at = now + base * 2^attempts`; the drain honours
  it. After `maxAttempts` the row is `dead` and `hook.run.dead` is the signal
  an alert should key on.

### Security constraints

- **Our code only, server-side.** Handlers are TypeScript in this repository,
  reviewed and deployed with the Worker. No endpoint accepts code, a script
  path, a URL to fetch code from, or a handler definition. A third party
  supplies a pull request or a spec, not a runtime artifact.
- **Least privilege by construction.** A handler closes over the ports it
  declares — a repository, the email service, the storage service. It never
  receives the Drizzle client, the request, the session or `env`. The
  `user_id` filter stays in the repositories (hub: security hardening).
- **Ids only cross the boundary.** `DomainEvent` carries ids; a handler that
  needs the email loads it through a port, in its own run, under its own
  timeout. `hook_run.payload` and log lines follow `events.ts`'s rule: ids,
  counts and error names; never a token, URL, key or title.
- **No cross-user fan-out.** An event is about one subject; a handler acts on
  that subject's data through owner-scoped repository calls. A handler that
  must touch another user's rows is a design smell to raise in review
  (question 6 sets the written rule).
- **Bounded work.** Timeouts, `maxAttempts`, and a registry that is a fixed
  array: the number of handlers per event is known at deploy time, so one
  event cannot fan out into unbounded work.
- **Operational visibility.** Every run is a row and an event line; the kill
  switch is a row; dead runs are an alertable event. A hook cannot run silently.
- **Not in scope and deliberately absent:** dynamic registration at runtime,
  handlers configured from the database, `eval`, `new Function`, remote
  modules, or Better Auth's generic `hooks.before/after` request hooks (which
  see raw requests and are a different, broader surface).

## Approved decisions

Owner (Cristian), 2026-10-12. All eight recommended answers were approved; they
override any alternative discussed elsewhere in this document.

1. **Who writes the custom script:** our team only. Handlers are registered
   functions in this repo; no third-party or uploaded code.
2. **Who uses it with us:** end users. Extension tables anchor on `user.id`.
   Organizations would reopen ADR 0002 and are out of scope.
3. **What "approve" means:** pull-request review with CODEOWNERS and CI. There
   is no in-product approval flow.
4. **Staging database:** migrations are tested on a throwaway Neon branch if
   branching exists, otherwise on an ephemeral Postgres in CI.
5. **Retention and deletion:** do not promise full deletion until account purge
   is at-least-once and backed by R2 lifecycle rules.
6. **Handler write scope:** a handler writes only its own feature tables, through
   ports.
7. **At-least-once delivery:** no event needs it at first; account purge gets it
   once decision 5 is in place.
8. **Destructive migrations:** need the owner's approval through a
   `migration:destructive` label.

Repo rules for whoever implements this: no `db:push` or migrations against any
non-local database; the approval gate depends on committed migrations
(NIW2-328), so land the gate after that ticket's migration tooling is on `main`.
Implementation tasks are split into their own tickets and PRs.

## How each owner answer changes the design

| Question                                        | Answer                                    | Effect on this design                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Who writes the script                        | Our team (recommended default)            | The design above as written. A candidate ADR "hooks are registered code" can be accepted.                                                                                                                                                                                                                                                         |
|                                                 | Partners contribute pull requests         | Same mechanism; add a `hooks/CODEOWNERS` line, a per-handler author in the registration, and the rule from question 6 (own-feature tables only) as a lint.                                                                                                                                                                                        |
|                                                 | Third parties upload code                 | **Stop.** A sandbox decision comes first: signed webhooks to their server (handler kind `webhook` behind the same registry) or Workers for Platforms (their Worker in a dispatch namespace, called with ids only). Either way their code never runs in the API Worker, and the table options 4 / hook option 8 reopen.                            |
| 2. Who the parties are                          | End users (recommended default)           | Anchor entity is `user`; nothing changes.                                                                                                                                                                                                                                                                                                         |
|                                                 | Partner developers                        | Same anchor; isolation stays per user; partners are authors, not tenants.                                                                                                                                                                                                                                                                         |
|                                                 | Organizations sharing data                | A `workspace` entity and a membership table come first, in their own spec and ADR. ADR 0002's reopen condition ("multi-seat/org plans are needed") is met. Feature tables then anchor on `workspace_id`, and `ownedBy` scopes by membership, not by `user_id`. "Account" in the owner's phrase means that workspace, not Better Auth's `account`. |
| 3. What "approve" means                         | Pull-request review (recommended default) | The gate section as written.                                                                                                                                                                                                                                                                                                                      |
|                                                 | In-product approval                       | Means the schema is not fixed at deploy time, which the Drizzle-and-migrations model cannot express; the honest version is a request that produces a pull request (an issue template or a console action that opens one), reviewed as above. A runtime schema builder is a different product and out of scope.                                    |
| 4. Staging DB / Neon branching                  | Branching exists                          | CI step 4 applies migrations to a throwaway branch per pull request; the drain and hooks can be exercised against it.                                                                                                                                                                                                                             |
|                                                 | One database only                         | CI validates migrations against a fresh ephemeral Postgres (service container) instead; the first production apply is a manual, logged step in NIW2-328's owner steps. No developer machine runs `db:push` against production.                                                                                                                    |
| 5. Retention and deletion promise               | "Deleting the account removes everything" | `user.deleted` → `enqueue-account-purge` must be at-least-once: that handler's `hook_run` row is written in the same `batch` as the delete (hook option 2) and the drain retries until `done`. `hook_run` rows for the subject are kept until the purge is proven, then pruned. R2 lifecycle rules are the backstop.                              |
|                                                 | Best effort / unspecified                 | Phase 1 as written; NIW2-328's cron purge remains best effort and the promise must not be published.                                                                                                                                                                                                                                              |
| 6. Handler write scope                          | Own feature only (recommended)            | A handler's closure may only receive its own feature's repositories; enforced by review and a lint on the registry file.                                                                                                                                                                                                                          |
|                                                 | Any table                                 | Allowed through ports only; the raw client stays off-limits.                                                                                                                                                                                                                                                                                      |
| 7. Which events must be delivered at least once | None yet (recommended default)            | Phase 1 only.                                                                                                                                                                                                                                                                                                                                     |
|                                                 | A named list                              | Those events use the same-batch outbox insert; if any handler is long-running, phase 2 (Queues) starts for it.                                                                                                                                                                                                                                    |
| 8. Destructive-migration approval               | Owner alone                               | The label and the comment are the owner's.                                                                                                                                                                                                                                                                                                        |
|                                                 | Two people                                | Ruleset requires two approvals on `migration:destructive`.                                                                                                                                                                                                                                                                                        |

## Relation to existing ADRs

- **ADR 0002** (plan entitlements separate from auth). This design generalises
  its rule: a feature is its own module with its own table, composed with
  identity only at the route. Using Better Auth `databaseHooks` as an event
  _source_ does not put feature data in auth tables and does not contradict it.
  The design contradicts nothing in ADR 0002 unless question 2 answers
  "organizations", in which case ADR 0002's own reopen condition is met and a
  workspace spec must precede this one.
- **ADR 0010** (checks in Actions on every pull request). The approval gate adds
  jobs to `pr-checks.yml`; consistent.
- **NIW2-328's draft ADR 0011** (committed migrations instead of push). This
  spec depends on it and creates no competing ADR. If that draft changes shape,
  the gate section follows it.

No ADR is drafted by this spec. Two candidates are named in the decisions table
(feature tables by foreign key; hooks are registered code) and should be written
only after questions 1 and 2 are answered, because both answers can change the
decision.

## Risks

1. **The gate without migrations is a wish.** Until NIW2-328 lands, nothing
   stops a `db:push` from a laptop. Order of work: migrations first.
2. **Cross-user leakage by omission.** No RLS; the only guard is the repository
   filter. More authors raise the odds one forgets it. Mitigations: `ownedBy`,
   the port signature rule, the schema-rules test. RLS (Neon supports Postgres
   policies; Drizzle has `pgPolicy`) is the next step if the HTTP driver's
   per-request role setting is solved, and is out of scope here.
3. **Best-effort delivery mistaken for a guarantee.** `waitUntil` work can be
   cut short. The drain narrows the window; only the same-batch outbox closes it,
   and only for single-statement writes. Question 7 keeps this honest.
4. **Cascade by habit.** A new table inherits "delete the user, delete
   everything" because the neighbours do. Rule 2 forces the sentence in the doc.
5. **A hook that re-emits.** A handler that calls a use case that emits creates a
   loop. Rule: handlers call repositories and services, not emitting use cases;
   a registry lint flags imports from `@kaipu/application` inside handlers, and
   `hook_run` depth is bounded by `maxAttempts` in the worst case.
6. **Audit table growth.** One row per handler per event. Retention (question 5)
   and the drain's prune keep it bounded; the payload is ids only.
7. **Registry as a merge hotspot.** One file lists every handler. Acceptable at
   this size; split per feature (`hooks/<feature>.ts` re-exported) if it hurts.
8. **Secrets in closures.** A handler closing over `env` would carry secrets.
   The rule is ports only; review and a lint on `env` imports in `hooks/`.

## References

Repository:

- [ADR 0002: Plan entitlements kept as a module separate from auth](/architecture/decisions/0002-plan-entitlements-separate-from-auth/)
- [ADR 0010: Checks run in Actions on every pull request](/architecture/decisions/0010-checks-run-in-actions-on-every-pr/)
- [Cloud data model](/specs/2026-09-09-cloud-data-model/) · [Cloud recording lifecycle and account deletion](/backlog/cloud-data-lifecycle/)
- [Commands — database](/commands/#database) (the `db:push` stance this spec wants replaced by NIW2-328)
- Private audit `audit-5-db.md` (2026-10-12), sections 2–4 — not published; its findings are summarised in [Context](#context)
- Linear: [NIW2-329](https://linear.app/niway/issue/NIW2-329) (this spec) · [NIW2-328](https://linear.app/niway/issue/NIW2-328) (jobs, purge, migrations)

Hub (reusable guidance, linked rather than copied):

- [Application layer & package architecture](https://github.com/csdev19/general-knowledge/blob/main/architecture/application-layer.md)
- [Domain layer contracts](https://github.com/csdev19/general-knowledge/blob/main/architecture/domain-layer-contracts.md)
- [Security hardening — authorization at the query level](https://github.com/csdev19/general-knowledge/blob/main/architecture/security-hardening.md)
- [Bounded contexts — domain events](https://github.com/csdev19/general-knowledge/blob/main/architecture/bounded-contexts-complete-guide.md)
- [Split data by access pattern — cross-store reference is a snapshot](https://github.com/csdev19/general-knowledge/blob/main/architecture/data-by-access-pattern.md)
- [Observability — what a log line may carry](https://github.com/csdev19/general-knowledge/blob/main/architecture/observability.md)
- [Deploy environments](https://github.com/csdev19/general-knowledge/blob/main/infra/deploy-environments.md) · [ADR pattern](https://github.com/csdev19/general-knowledge/blob/main/conventions/adr-pattern.md) · [Design workflow](https://github.com/csdev19/general-knowledge/blob/main/conventions/design-workflow.md)

External (state of the art):

Data model and migrations:

- [Drizzle — SQL schema declaration, "schema in multiple files"](https://orm.drizzle.team/docs/sql-schema-declaration)
- [Drizzle — `drizzle-kit push`](https://orm.drizzle.team/docs/drizzle-kit-push) ("the best approach for rapid prototyping") · [`drizzle-kit check`](https://orm.drizzle.team/docs/drizzle-kit-check) (consistency of the migration history across branches)
- [Drizzle — row-level security (`pgPolicy`, `crudPolicy` for Neon)](https://orm.drizzle.team/docs/rls)
- [Neon — branching with GitHub Actions (a branch per pull request)](https://neon.com/docs/guides/branching-github-actions)
- [PostgreSQL — JSON types and GIN indexing](https://www.postgresql.org/docs/current/datatype-json.html)
- [Modeling polymorphic associations in a relational database (exclusive arc)](https://hashrocket.com/blog/posts/modeling-polymorphic-associations-in-a-relational-database) · [On polymorphic associations in Postgres](https://danolivo.substack.com/p/on-polymorphic-associations-in-postgres)

Events and delivery:

- [Transactional outbox pattern — microservices.io](https://microservices.io/patterns/data/transactional-outbox.html) · [Debezium — reliable data exchange with the outbox pattern](https://debezium.io/blog/2019/02/19/reliable-microservices-data-exchange-with-the-outbox-pattern/)
- [Cloudflare Workers — `ExecutionContext.waitUntil`](https://developers.cloudflare.com/workers/runtime-apis/context/) (up to 30 s after the response on HTTP-triggered Workers)
- [Cloudflare Queues — delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/) · [limits](https://developers.cloudflare.com/queues/platform/limits/)
- [Cloudflare Workflows](https://developers.cloudflare.com/workflows/) · [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)

Exposing hooks safely:

- [Stripe — webhooks (signatures, idempotency, retries)](https://docs.stripe.com/webhooks) · [Standard Webhooks specification](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md)
- [Better Auth — database hooks](https://www.better-auth.com/docs/concepts/database) · [endpoint hooks](https://www.better-auth.com/docs/concepts/hooks) · [users and accounts — `deleteUser` callbacks](https://www.better-auth.com/docs/concepts/users-accounts)
- [Supabase — database webhooks (triggers over `pg_net`)](https://supabase.com/docs/guides/database/webhooks)
- [Cloudflare Workers for Platforms](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/) · [Workers security model](https://developers.cloudflare.com/workers/reference/security-model/)
- [How we built the Figma plugin system](https://www.figma.com/blog/how-we-built-the-figma-plugin-system/) · [An update on plugin security](https://madebyevan.com/figma/an-update-on-plugin-security/) (the sandbox-escape history; read as reported, not re-verified for this spec)
