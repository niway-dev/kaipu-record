# Architecture Context Document

## 1. Project Overview

A production-ready monorepo template demonstrating DDD + Hexagonal Architecture with a Todo CRUD example spanning all layers. Designed to be forked and extended with your own domain logic.

**Tech Stack:** TypeScript, React 19, React Native (Expo), Elysia (Cloudflare Workers), Drizzle ORM, Neon PostgreSQL, Better Auth, Zod, TanStack (Router/Query/Form/Start).

---

## 2. Current Package Structure

```
monorepo-template/
├── apps/
│   ├── server/          # Elysia API on Cloudflare Workers
│   ├── web/             # TanStack Start (React 19) web app
│   ├── mobile/          # Expo (React Native) mobile app
│   └── documentation/   # Documentation site (Astro Starlight)
│
├── packages/
│   ├── domain/          # Pure business logic: schemas, types, repository interfaces
│   ├── application/     # Use cases (orchestration, no I/O of its own)
│   ├── infra-db/        # Infrastructure: Drizzle schemas, repositories, mappers, client
│   ├── infra-auth/      # Better Auth config (base config, password hashing, session)
│   ├── web-ui/          # Reusable React UI components (shadcn/ui, Tailwind)
│   └── config/          # Shared TypeScript configuration
```

---

## 3. Dependency Graph

```
                ┌─────────────────┐
                │     domain      │  LEAF NODE (no deps)
                │  schemas, types │
                │  repo interfaces│
                └────────┬────────┘
                         │
             ┌───────────┼───────────┐
             v                       v
      ┌──────────────┐       ┌──────────────┐
      │  application │       │   infra-db   │
      │  (use cases) │       │   infra-auth │
      │              │       │              │
      │  imports     │       │  implements  │
      │  from domain │       │  domain      │
      └──────┬───────┘       └──────┬───────┘
             │                      │
             └──────────┬───────────┘
                        v
                 ┌─────────────┐
                 │    apps     │  Wire everything together.
                 │ server, web │  Dependency injection here.
                 │   mobile    │
                 └─────────────┘

Mobile can ONLY import from: domain (schemas, types, constants)
Mobile must NEVER import from: infra-db, application, infra-auth, server
```

**Rule:** The dependency arrow is always `infrastructure -> application -> domain`. Domain stays leaf-level so importing it can never transitively pull in server code.

---

## 4. What Lives Where Today

### 4.1 `packages/domain/` -- Pure, zero infrastructure deps

| Folder          | Contents                                     | Example                              |
| --------------- | -------------------------------------------- | ------------------------------------ |
| `schemas/`      | Zod validation schemas: Base, Create, Update | `todoBaseSchema`, `createTodoSchema` |
| `types/`        | Generic utility types                        | `Result<T,E>`, `ApiResponse<T>`      |
| `constants/`    | Enums, status values, labels                 | (extensible for your domain)         |
| `repositories/` | Interfaces only (contracts)                  | `ITodoRepository`                    |
| `dtos/`         | Data transfer object types                   | (extensible)                         |

**Exports via subpath:**

```
@monorepo-template/domain/schemas
@monorepo-template/domain/types
@monorepo-template/domain/constants
@monorepo-template/domain/repositories
```

### 4.2 `packages/application/` -- Use cases

| File                   | Purpose                                          |
| ---------------------- | ------------------------------------------------ |
| `todos/create-todo.ts` | Creates a todo: validates, calls `repo.create()` |
| `todos/list-todos.ts`  | Lists all todos for a user                       |
| `todos/get-todo.ts`    | Gets a single todo by ID                         |
| `todos/update-todo.ts` | Updates a todo                                   |
| `todos/delete-todo.ts` | Deletes a todo                                   |

**Pattern -- Dependency injection:**

```typescript
export async function createTodo(
  repository: ITodoRepository,  // injected by caller
  data: CreateTodo,
  userId: string,
): Promise<TodoBase>
```

Application imports ONLY from domain. The caller (server) wires the concrete repository.

### 4.3 `packages/infra-db/` -- Infrastructure

| Folder          | Contents                                                                         |
| --------------- | -------------------------------------------------------------------------------- |
| `client/`       | Neon HTTP client + Drizzle setup                                                 |
| `schema/`       | Drizzle table definitions: `todo`, `auth` (user, session, account, verification) |
| `enums/`        | `pgEnum` mappings from domain constants                                          |
| `repositories/` | Concrete implementations of domain interfaces                                    |
| `mappers/`      | `toDomain()` transformations (DB row to domain model)                            |
| `utils/`        | Table creator (prefix), reusable timestamp columns                               |
| `config/`       | Table prefix configuration                                                       |

### 4.4 `packages/infra-auth/` -- Authentication

| File                    | Purpose                                                                    |
| ----------------------- | -------------------------------------------------------------------------- |
| `config/base-config.ts` | BetterAuthOptions: Drizzle adapter, scrypt password hashing, cookie config |
| `config/functions.ts`   | Custom session plugin                                                      |

### 4.5 `apps/server/` -- API (Elysia + Cloudflare Workers)

| Folder     | Contents                                        |
| ---------- | ----------------------------------------------- |
| `routes/`  | REST endpoints: `todos`                         |
| `plugins/` | `authPlugin` -- Elysia plugin for route auth    |
| `utils/`   | Error classes, error handlers, response helpers |
| `lib/`     | Better Auth instance with expo plugin           |

**Wiring pattern:**

```typescript
const db = createDatabaseClient(env.DATABASE_URL);
const repository = new TodoRepository(db);
const todos = await repository.findAllByUserId(user.id);
```

### 4.6 `apps/web/` -- Web App (TanStack Start)

| Folder        | Contents                                        |
| ------------- | ----------------------------------------------- |
| `routes/`     | File-based routing with auth guards             |
| `components/` | UI components                                   |
| `lib/`        | Auth client, Eden Treaty client (type-safe RPC) |

### 4.7 `apps/mobile/` -- Mobile App (Expo)

| Folder        | Contents                                            |
| ------------- | --------------------------------------------------- |
| `app/(auth)/` | Sign-in, sign-up screens                            |
| `app/(tabs)/` | Bottom tab navigation                               |
| `lib/`        | `api-client.ts` (fetch + cookies), `auth-client.ts` |

---

## 5. Database Schema

```
user (Better Auth) ──1:N── session
                   ──1:N── account
                   ──1:N── todo

verification (Better Auth, standalone)
```

**Tables:**

- `user`: id, name, email, emailVerified, image, timestamps
- `session`: id, token, expiresAt, ipAddress, userAgent, userId (FK), timestamps
- `account`: id, accountId, providerId, userId (FK), tokens, scope, password, timestamps
- `verification`: id, identifier, value, expiresAt, timestamps
- `todo`: id, title, completed, userId (FK), timestamps

---

## 6. Data Flow Example: Creating a Todo

```
Web / Mobile
  -> POST /api/v1/todos { title: "Buy groceries" }

Server (Elysia route handler)
  -> Validates body with createTodoSchema (from domain)
  -> Authenticates user via Better Auth session
  -> Creates TodoRepository with database client
  -> Calls repository.create({ title, userId })

Infrastructure (TodoRepository)
  -> db.insert(todoTable).values({ title, userId }).returning()
  -> mapTodoToDomain(row) converts DB row to TodoBase
  -> Returns TodoBase

Response
  -> HTTP 201 { data: TodoBase }
```

---

## 7. Architectural Patterns in Use

| Pattern                      | Where                                 | How                                                                          |
| ---------------------------- | ------------------------------------- | ---------------------------------------------------------------------------- |
| **Repository pattern**       | domain (interface) -> infra-db (impl) | `ITodoRepository` / `TodoRepository`                                         |
| **Data Mapper**              | infra-db/mappers/                     | `mapTodoToDomain()` -- decouples DB schema from domain model                 |
| **Result type**              | domain/types                          | `Result<T,E>` -- Rust-style, no exceptions for business errors               |
| **Dependency injection**     | application use cases                 | Caller passes `repository` instance, use case does not know about DB         |
| **Schema-driven validation** | domain/schemas                        | Zod schemas shared between server validation and client forms                |
| **Subpath exports**          | all packages                          | `@monorepo-template/domain/schemas`, `@monorepo-template/domain/types`, etc. |

---

## 8. Technology Stack

| Layer         | Technology                             |
| ------------- | -------------------------------------- |
| Runtime       | Bun                                    |
| Language      | TypeScript                             |
| Monorepo      | Turborepo + Bun Workspaces             |
| Frontend      | TanStack Start, React, TanStack Router |
| Backend       | Elysia                                 |
| Mobile        | Expo (React Native)                    |
| Database      | Neon PostgreSQL, Drizzle ORM           |
| Auth          | Better Auth                            |
| UI Components | shadcn/ui, Tailwind CSS                |
| Linting       | oxlint                                 |
| Formatting    | oxfmt                                  |
| Deployment    | Cloudflare Workers                     |

---

## 9. Key Files Reference

| Purpose                   | Path                                                    |
| ------------------------- | ------------------------------------------------------- |
| Todo Zod schemas          | `packages/domain/src/schemas/todo.ts`                   |
| Todo repository interface | `packages/domain/src/repositories/todo.repository.ts`   |
| Result type               | `packages/domain/src/types/result.ts`                   |
| Create todo use case      | `packages/application/src/todos/create-todo.ts`         |
| Todo DB table definition  | `packages/infra-db/src/schema/todo.ts`                  |
| Auth DB tables            | `packages/infra-db/src/schema/auth.ts`                  |
| Todo repository impl      | `packages/infra-db/src/repositories/todo.repository.ts` |
| Todo data mapper          | `packages/infra-db/src/mappers/todo.mapper.ts`          |
| Auth base config          | `packages/infra-auth/src/config/base-config.ts`         |
| Server auth instance      | `apps/server/src/lib/auth.ts`                           |
| Server todo routes        | `apps/server/src/routes/todos.ts`                       |
| Web todo page             | `apps/web/src/routes/_authenticated/todos/index.tsx`    |
| Mobile auth client        | `apps/mobile/lib/auth-client.ts`                        |
| Mobile API client         | `apps/mobile/lib/api-client.ts`                         |
