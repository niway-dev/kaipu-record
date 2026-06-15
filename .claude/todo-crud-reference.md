# Todo CRUD - Full Implementation Reference

All code for the Todo CRUD example across every layer. Use this to re-apply the todo feature on a fresh copy of the template.

> **Important**: The namespace below uses `@monorepo-template/*`. Replace with whatever namespace the new project uses.

---

## 1. Domain Layer (`packages/domain/`)

### `src/schemas/todo.ts`

```ts
import { z } from "zod";

export const todoBaseSchema = z.object({
  id: z.string(),
  title: z.string().min(1, "Title is required").max(500),
  completed: z.boolean(),
  userId: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const createTodoSchema = z.object({
  title: z.string().min(1, "Title is required").max(500),
});

export const updateTodoSchema = z.object({
  title: z.string().min(1, "Title is required").max(500).optional(),
  completed: z.boolean().optional(),
});

export type TodoBase = z.infer<typeof todoBaseSchema>;
export type CreateTodo = z.infer<typeof createTodoSchema>;
export type UpdateTodo = z.infer<typeof updateTodoSchema>;
```

### `src/repositories/todo.repository.ts`

```ts
import type { TodoBase, CreateTodo, UpdateTodo } from "../schemas/todo";

export interface ITodoRepository {
  findById(id: string, userId: string): Promise<TodoBase | null>;
  findAllByUserId(userId: string): Promise<TodoBase[]>;
  create(data: CreateTodo & { userId: string }): Promise<TodoBase>;
  update(id: string, userId: string, data: UpdateTodo): Promise<TodoBase | null>;
  delete(id: string, userId: string): Promise<boolean>;
}
```

### Barrel exports

`src/schemas/index.ts` -- add:

```ts
export {
  todoBaseSchema, createTodoSchema, updateTodoSchema,
  type TodoBase, type CreateTodo, type UpdateTodo,
} from "./todo";
```

`src/repositories/index.ts` -- add:

```ts
export type { ITodoRepository } from "./todo.repository";
```

---

## 2. Application Layer (`packages/application/`)

### `src/todos/create-todo.ts`

```ts
import type { ITodoRepository } from "@monorepo-template/domain/repositories";
import type { CreateTodo, TodoBase } from "@monorepo-template/domain/schemas";

export async function createTodo(
  repository: ITodoRepository,
  data: CreateTodo,
  userId: string,
): Promise<TodoBase> {
  return repository.create({ ...data, userId });
}
```

### `src/todos/list-todos.ts`

```ts
import type { ITodoRepository } from "@monorepo-template/domain/repositories";
import type { TodoBase } from "@monorepo-template/domain/schemas";

export async function listTodos(
  repository: ITodoRepository,
  userId: string,
): Promise<TodoBase[]> {
  return repository.findAllByUserId(userId);
}
```

### `src/todos/get-todo.ts`

```ts
import type { ITodoRepository } from "@monorepo-template/domain/repositories";
import type { TodoBase } from "@monorepo-template/domain/schemas";

export async function getTodo(
  repository: ITodoRepository,
  id: string,
  userId: string,
): Promise<TodoBase | null> {
  return repository.findById(id, userId);
}
```

### `src/todos/update-todo.ts`

```ts
import type { ITodoRepository } from "@monorepo-template/domain/repositories";
import type { UpdateTodo, TodoBase } from "@monorepo-template/domain/schemas";

export async function updateTodo(
  repository: ITodoRepository,
  id: string,
  userId: string,
  data: UpdateTodo,
): Promise<TodoBase | null> {
  return repository.update(id, userId, data);
}
```

### `src/todos/delete-todo.ts`

```ts
import type { ITodoRepository } from "@monorepo-template/domain/repositories";

export async function deleteTodo(
  repository: ITodoRepository,
  id: string,
  userId: string,
): Promise<boolean> {
  return repository.delete(id, userId);
}
```

### `src/todos/index.ts`

```ts
export { createTodo } from "./create-todo";
export { listTodos } from "./list-todos";
export { getTodo } from "./get-todo";
export { updateTodo } from "./update-todo";
export { deleteTodo } from "./delete-todo";
```

---

## 3. Infra-DB Layer (`packages/infra-db/`)

### `src/schema/todo.ts`

```ts
import { text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createTable } from "../utils/table-creator";
import { userTable } from "./auth";

export const todoTable = createTable(
  "todo",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    title: text("title").notNull(),
    completed: boolean("completed").default(false).notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("todo_userId_idx").on(table.userId)],
);

export const todoRelations = relations(todoTable, ({ one }) => ({
  user: one(userTable, {
    fields: [todoTable.userId],
    references: [userTable.id],
  }),
}));
```

### `src/mappers/todo.mapper.ts`

```ts
import type { TodoBase } from "@monorepo-template/domain/schemas";
import type { todoTable } from "../schema/todo";

type TodoRow = typeof todoTable.$inferSelect;

export function mapTodoToDomain(row: TodoRow): TodoBase {
  return {
    id: row.id,
    title: row.title,
    completed: row.completed,
    userId: row.userId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
```

### `src/repositories/todo.repository.ts`

```ts
import { eq, and } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import type { ITodoRepository } from "@monorepo-template/domain/repositories";
import type { CreateTodo, UpdateTodo, TodoBase } from "@monorepo-template/domain/schemas";
import { todoTable } from "../schema/todo";
import { mapTodoToDomain } from "../mappers/todo.mapper";
import type * as schema from "../schema";

export class TodoRepository implements ITodoRepository {
  constructor(private db: NeonHttpDatabase<typeof schema>) {}

  async findById(id: string, userId: string): Promise<TodoBase | null> {
    const results = await this.db
      .select()
      .from(todoTable)
      .where(and(eq(todoTable.id, id), eq(todoTable.userId, userId)))
      .limit(1);
    return results[0] ? mapTodoToDomain(results[0]) : null;
  }

  async findAllByUserId(userId: string): Promise<TodoBase[]> {
    const results = await this.db
      .select()
      .from(todoTable)
      .where(eq(todoTable.userId, userId))
      .orderBy(todoTable.createdAt);
    return results.map(mapTodoToDomain);
  }

  async create(data: CreateTodo & { userId: string }): Promise<TodoBase> {
    const results = await this.db
      .insert(todoTable)
      .values({ title: data.title, userId: data.userId })
      .returning();
    return mapTodoToDomain(results[0]!);
  }

  async update(id: string, userId: string, data: UpdateTodo): Promise<TodoBase | null> {
    const results = await this.db
      .update(todoTable)
      .set(data)
      .where(and(eq(todoTable.id, id), eq(todoTable.userId, userId)))
      .returning();
    return results[0] ? mapTodoToDomain(results[0]) : null;
  }

  async delete(id: string, userId: string): Promise<boolean> {
    const results = await this.db
      .delete(todoTable)
      .where(and(eq(todoTable.id, id), eq(todoTable.userId, userId)))
      .returning();
    return results.length > 0;
  }
}
```

---

## 4. Server (`apps/server/src/routes/todos.ts`)

```ts
import { Elysia } from "elysia";
import { env } from "cloudflare:workers";
import { createDatabaseClient } from "@monorepo-template/infra-db/client";
import { TodoRepository } from "@monorepo-template/infra-db/repositories";
import { createTodoSchema, updateTodoSchema } from "@monorepo-template/domain/schemas";
import { authMacro } from "../plugins/auth.plugin";
import { errorHandlerPlugin } from "../utils/error-handler-plugin";
import { successBody, createdBody } from "../utils/response-helpers";
import { NotFoundError } from "../utils/errors";

export const todoRoutes = new Elysia({ prefix: "/todos" })
  .use(errorHandlerPlugin)
  .decorate("db", createDatabaseClient(env.DATABASE_URL))
  .derive(({ db }) => ({
    todoRepository: new TodoRepository(db),
  }))
  .use(authMacro)
  .get("/", async ({ user, todoRepository }) => {
    const todos = await todoRepository.findAllByUserId(user.id);
    return successBody(todos);
  }, { isAuth: true })
  .get("/:id", async ({ user, todoRepository, params }) => {
    const todo = await todoRepository.findById(params.id, user.id);
    if (!todo) throw new NotFoundError("Todo");
    return successBody(todo);
  }, { isAuth: true })
  .post("/", async ({ user, todoRepository, body }) => {
    const todo = await todoRepository.create({ ...body, userId: user.id });
    return createdBody(todo);
  }, { body: createTodoSchema, isAuth: true })
  .put("/:id", async ({ user, todoRepository, params, body }) => {
    const todo = await todoRepository.update(params.id, user.id, body);
    if (!todo) throw new NotFoundError("Todo");
    return successBody(todo);
  }, { body: updateTodoSchema, isAuth: true })
  .delete("/:id", async ({ user, todoRepository, params }) => {
    const deleted = await todoRepository.delete(params.id, user.id);
    if (!deleted) throw new NotFoundError("Todo");
    return successBody({ success: true });
  }, { isAuth: true });
```

---

## 5. Files summary

| Layer       | File                                                    |
| ----------- | ------------------------------------------------------- |
| Domain      | `packages/domain/src/schemas/todo.ts`                   |
| Domain      | `packages/domain/src/repositories/todo.repository.ts`   |
| Application | `packages/application/src/todos/*.ts`                   |
| Infra-DB    | `packages/infra-db/src/schema/todo.ts`                  |
| Infra-DB    | `packages/infra-db/src/mappers/todo.mapper.ts`          |
| Infra-DB    | `packages/infra-db/src/repositories/todo.repository.ts` |
| Server      | `apps/server/src/routes/todos.ts`                       |
| Web         | `apps/web/src/hooks/use-todos.ts`                       |
| Web         | `apps/web/src/routes/_authenticated/todos/index.tsx`    |
