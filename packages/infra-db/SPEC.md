# @kaipu/infra-db — Package Spec

```
src/
├── client/
├── config/
├── enums/
├── mappers/
├── repositories/
├── schema/
└── utils/
```

---

## `client/`

| Item                        | Kind     | Description                                                |
| --------------------------- | -------- | ---------------------------------------------------------- |
| `db`                        | const    | Pre-configured Drizzle client using `DATABASE_URL` env var |
| `createDatabaseClient(url)` | function | Factory that creates a new Drizzle client from a given URL |

---

## `config/`

| Item           | Kind  | Description                                      |
| -------------- | ----- | ------------------------------------------------ |
| `TABLE_PREFIX` | const | `"kaipu_record"` — prefix for all DB table names |

---

## `enums/`

Empty — no PostgreSQL enums are declared yet. `kind` and `status` on the recording
table are plain `text` columns validated by the domain Zod schemas.

---

## `utils/`

| Item          | Kind     | Description                                                                                                                       |
| ------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `createTable` | function | `pgTableCreator` wrapper that auto-prefixes table names with `kaipu_record_`                                                      |
| `timestamps`  | const    | Reusable column object with `createdAt`, `updatedAt`, `deletedAt`. Currently unused — the tables declare their timestamps inline. |

---

## `schema/`

### `auth.ts`

Better Auth's tables. Owned by the auth adapter's expectations — change with care.

| Item                | Kind      | Description                                                      |
| ------------------- | --------- | ---------------------------------------------------------------- |
| `userTable`         | table     | Users (id, name, email, emailVerified, image, timestamps)        |
| `sessionTable`      | table     | Sessions (id, expiresAt, token, ipAddress, userAgent, userId FK) |
| `accountTable`      | table     | OAuth accounts (accountId, providerId, tokens, userId FK)        |
| `verificationTable` | table     | Verification codes (identifier, value, expiresAt)                |
| `userRelations`     | relations | User → many sessions, accounts, recordings                       |
| `sessionRelations`  | relations | Session → one user                                               |
| `accountRelations`  | relations | Account → one user                                               |

### `recording.ts`

| Item                 | Kind      | Description                                                                                                                                                              |
| -------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `recordingTable`     | table     | Cloud vault metadata (id, userId FK, kind, title, storageKey unique, contentType, sizeBytes, durationSeconds, status, timestamps). The bytes live in R2 at `storageKey`. |
| `recordingRelations` | relations | Many-to-one with user                                                                                                                                                    |

`status` is `pending` until the presigned upload is confirmed, then `ready`.

---

## `mappers/`

| Item                        | Kind     | Description              |
| --------------------------- | -------- | ------------------------ |
| `mapRecordingToDomain(row)` | function | DB row → `RecordingBase` |

---

## `repositories/`

| Item                       | Kind   | Description                                                           |
| -------------------------- | ------ | --------------------------------------------------------------------- |
| `RecordingRepository`      | class  | Implements `IRecordingRepository`                                     |
| `.create(data)`            | method | Insert a recording with status `pending`                              |
| `.markReady(id, userId)`   | method | Flip a pending recording to `ready`; null when not found for the user |
| `.findById(id, userId)`    | method | Find by id scoped to the owner                                        |
| `.findAllByUserId(userId)` | method | List the user's recordings, newest first                              |
| `.delete(id, userId)`      | method | Hard delete; returns the removed row so its object can be cleaned up  |

---

## Totals

| Category           | Count |
| ------------------ | ----- |
| Files              | 11    |
| Exported classes   | 1     |
| Exported functions | 3     |
| Exported constants | 2     |
| pgEnums            | 0     |
| Drizzle tables     | 5     |
