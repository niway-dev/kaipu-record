# AI Assistant Context - Monorepo Template

## Authentication System

### Full-Stack Authentication with TanStack Start

This app uses a **custom auth proxy pattern** that makes TanStack Start a true full-stack framework.

### Key Pattern: Auth Proxy + Server Validation

```typescript
// Auth flow:
Browser -> /api/auth/* (proxy) -> Backend -> Database
              |
         Cookies work (same origin!)
              |
    Server validates in beforeLoad
              |
      Context flows to components
```

### When Working with Auth, Remember:

1. **Never bypass the proxy** -- use `basePath: "/api/auth"`, not `baseURL: "https://backend.com"`
2. **Use server-side validation** -- `beforeLoad` with `getAuthSession()`, not client-side `useEffect` redirects
3. **Access session via context** -- `Route.useRouteContext()`, not `authClient.useSession()`
4. **Respect the cache** -- 10-minute `staleTime`, don't set to 0

### File Locations

```
apps/web/src/
├── routes/
│   ├── __root.tsx                    # Session validation in beforeLoad
│   ├── _authenticated.tsx            # Protected route layout
│   └── api/auth/$.ts                 # Auth proxy (ALL auth requests)
│
└── lib/auth/
    ├── auth-client.ts                # Client-side auth (uses proxy)
    ├── auth-server.ts                # Server-side auth instance
    └── functions.ts                  # getAuthSession() server function
```

---

## Data Flow Patterns

### Server -> Client Data Flow

```typescript
// 1. Server validates (beforeLoad)
beforeLoad: async () => {
  const data = await serverFunction();
  return { data }; // Goes into context
}

// 2. Component accesses (useRouteContext)
function Component() {
  const { data } = Route.useRouteContext();
  return <div>{data}</div>;
}
```

### Context Hierarchy

```
__root.tsx
  └─ returns { session, isAuthenticated }
      └─ Available in ALL child routes via Route.useRouteContext()
          └─ _authenticated.tsx
              └─ Can access parent context
                  └─ _authenticated/todos/index.tsx
                      └─ Can access all parent contexts
```

---

## Caching Rules

### Three-Layer Cache System

1. **Backend Cache** (Better Auth): 10 minutes in memory
2. **Route Cache** (TanStack Router): 10 minutes via `staleTime`
3. **Context Cache** (React): Component lifecycle

---

## Data Loading Pattern: Server Pre-loading with TanStack Query

Routes use `loader` + `queryClient.ensureQueryData` to pre-fetch data on the server before the page renders. The same `queryOptions` are shared between the loader and the component hook, so the client reuses the server-fetched cache.

### Step 1: Define queryOptions in the hooks file

```typescript
// src/hooks/use-todos.ts
import { queryOptions, keepPreviousData } from "@tanstack/react-query";
import { listTodos } from "@/server-functions/list-todos";

interface TodosParams { page: number; limit: number; }

export const todoKeys = {
  all: ["todos"] as const,
  list: (params?: TodosParams) => [...todoKeys.all, "list", params] as const,
};

export const todosQueryOptions = (params: TodosParams) =>
  queryOptions({
    queryKey: todoKeys.list(params),
    queryFn: () => listTodos({ data: { page: params.page, limit: params.limit } }),
    placeholderData: keepPreviousData,
  });

export const useTodos = (params: TodosParams) => useQuery(todosQueryOptions(params));
```

### Step 2: Pre-load in the route loader

```typescript
// src/routes/_authenticated/todos/index.tsx
const DEFAULT_PAGE_SIZE = 5;

export const Route = createFileRoute("/_authenticated/todos/")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(
      todosQueryOptions({ page: 1, limit: DEFAULT_PAGE_SIZE })
    ),
  component: TodosPage,
});
```

### Step 3: Use the same hook in the component

```typescript
function TodosPage() {
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: DEFAULT_PAGE_SIZE });
  const { data: todosResponse, isPending, isPlaceholderData } = useTodos({
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
  });
  // Data is available immediately on first render (server pre-fetched)
  // Subsequent page changes use client-side fetching with keepPreviousData
}
```

### Key Points

- **`ensureQueryData`** fetches on the server and populates the query cache. The client hydrates this cache, so the first render has data immediately (no loading spinner).
- **`queryOptions()`** factory ensures the loader and hook share the exact same query key + fn.
- **`keepPreviousData`** as `placeholderData` keeps the old page visible while fetching the next page (avoids flash of loading state during pagination).
- **Server functions** (`@/server-functions/*`) are TanStack Start `createServerFn` wrappers that run on the server and are called from both the loader (SSR) and the client (CSR).
- **Mutations** use `queryClient.invalidateQueries({ queryKey: todoKeys.all })` to refetch after create/update/delete.

---

## Common Patterns

### Protected Route

Create under `_authenticated/` directory. Session guaranteed via parent `beforeLoad`.

### Auth Config Locations

1. Backend config: `packages/infra-auth/src/config/base-config.ts`
2. Client config: `apps/web/src/lib/auth/auth-client.ts`
3. Server instance: `apps/web/src/lib/auth/auth-server.ts`
