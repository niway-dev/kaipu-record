/**
 * The account page's door to account deletion.
 *
 * The server side (soft delete with a 7-day grace period, the purge sweep) is NIW2-214 / PR #268.
 * The page talks to this port instead of to the API so it can ship, and be tested, before that
 * lands: `mockAccountDeletionClient` is in memory, `httpAccountDeletionClient` calls the routes
 * #268 documents (backend/account-deletion.md) and stays off behind
 * `VITE_ACCOUNT_DELETION_ENABLED` until they are on `main`.
 */

/** What deleting would remove, when the API can say. Shown in the confirmation dialog. */
export interface DeletionImpact {
  cloudFiles: number;
  pendingUploads: number;
}

export type DeletionStatus =
  | { status: "active"; impact?: DeletionImpact }
  | { status: "scheduled"; requestedAt: string; scheduledAt: string };

export type DeletionFailure = "wrong-password" | "session-not-fresh" | "failed";

export type RequestDeletionResult =
  | { ok: true; status: Extract<DeletionStatus, { status: "scheduled" }> }
  | { ok: false; reason: DeletionFailure };

export interface AccountDeletionClient {
  /** Schedules the deletion. `password` is sent for accounts that have one. */
  requestDeletion(input: { password?: string }): Promise<RequestDeletionResult>;
  /** Rejects when the status cannot be read; callers treat that as "unknown", never "active". */
  getDeletionStatus(): Promise<DeletionStatus>;
  /** Cancels a scheduled deletion (Restore). Rejects on failure. */
  cancelDeletion(): Promise<Extract<DeletionStatus, { status: "active" }>>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Mirrors the grace period PR #268 decided; the real date always comes from the server. */
const MOCK_GRACE_DAYS = 7;

export interface MockAccountDeletionOptions {
  /** The password the mock accepts. */
  password?: string;
  impact?: DeletionImpact;
  now?: () => number;
  /** Start already scheduled, e.g. a user who signs in during the grace period. */
  initial?: Extract<DeletionStatus, { status: "scheduled" }>;
}

export const MOCK_ACCOUNT_PASSWORD = "correct-password";

/** In-memory client for tests and local dev. Each call to the factory is an independent store. */
export function createMockAccountDeletionClient(
  options: MockAccountDeletionOptions = {},
): AccountDeletionClient {
  const password = options.password ?? MOCK_ACCOUNT_PASSWORD;
  const impact = options.impact ?? { cloudFiles: 12, pendingUploads: 3 };
  const now = options.now ?? Date.now;
  let scheduled = options.initial ?? null;

  return {
    async requestDeletion(input) {
      if (input.password !== undefined && input.password !== password) {
        return { ok: false, reason: "wrong-password" };
      }
      // Like the server, a repeated request keeps the first date.
      if (!scheduled) {
        const requested = now();
        scheduled = {
          status: "scheduled",
          requestedAt: new Date(requested).toISOString(),
          scheduledAt: new Date(requested + MOCK_GRACE_DAYS * DAY_MS).toISOString(),
        };
      }
      return { ok: true, status: scheduled };
    },
    async getDeletionStatus() {
      return scheduled ?? { status: "active", impact };
    },
    async cancelDeletion() {
      scheduled = null;
      return { status: "active", impact };
    },
  };
}

export const mockAccountDeletionClient: AccountDeletionClient = createMockAccountDeletionClient();

export interface HttpAccountDeletionOptions {
  /** Proves the account password before the request; see `requestDeletion`. */
  verifyPassword?: (password: string) => Promise<boolean>;
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
}

const ROUTE = "/api/v1/me/account-deletion";

/** The routes accept either the bare payload or the `{ data }` envelope the other routes use. */
function unwrap(body: unknown): unknown {
  if (body && typeof body === "object" && "data" in body) {
    const data = (body as { data: unknown }).data;
    if (data !== null && data !== undefined) return data;
  }
  return body;
}

function parseStatus(body: unknown): DeletionStatus {
  const payload = unwrap(body) as Partial<{
    status: string;
    requestedAt: string;
    scheduledAt: string;
  }> | null;
  if (payload?.status === "active") return { status: "active" };
  if (
    payload?.status === "scheduled" &&
    typeof payload.requestedAt === "string" &&
    typeof payload.scheduledAt === "string"
  ) {
    return {
      status: "scheduled",
      requestedAt: payload.requestedAt,
      scheduledAt: payload.scheduledAt,
    };
  }
  throw new Error("Unexpected account deletion status");
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function failureKind(body: unknown): string | undefined {
  const data = (body as { data?: { kind?: unknown } } | null)?.data;
  return typeof data?.kind === "string" ? data.kind : undefined;
}

export function createHttpAccountDeletionClient(
  options: HttpAccountDeletionOptions = {},
): AccountDeletionClient {
  const doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const url = `${options.baseUrl ?? ""}${ROUTE}`;
  const send = (path: string, method: "GET" | "POST") =>
    doFetch(`${url}${path}`, {
      method,
      credentials: "include",
      headers: method === "POST" ? { "content-type": "application/json" } : undefined,
      body: method === "POST" ? "{}" : undefined,
    });

  async function getDeletionStatus(): Promise<DeletionStatus> {
    const response = await send("", "GET");
    if (!response.ok) throw new Error(`Account deletion status failed (${response.status})`);
    return parseStatus(await readJson(response));
  }

  return {
    async requestDeletion({ password }) {
      // The route's documented guard is a session signed in within 24 hours; it takes no password.
      // So the password is proved here, by the sign-in the page already trusts, before asking.
      if (password !== undefined && options.verifyPassword) {
        if (!(await options.verifyPassword(password))) {
          return { ok: false, reason: "wrong-password" };
        }
      }
      let response: Response;
      try {
        response = await send("", "POST");
      } catch {
        return { ok: false, reason: "failed" };
      }
      if (!response.ok) {
        const body = await readJson(response);
        return {
          ok: false,
          reason: failureKind(body) === "session-not-fresh" ? "session-not-fresh" : "failed",
        };
      }
      // The request revokes every session, so the status is read from the answer when it carries
      // one and otherwise falls back to the route's GET.
      try {
        const body = await readJson(response);
        const parsed = parseStatus(body);
        if (parsed.status === "scheduled") return { ok: true, status: parsed };
      } catch {
        // fall through to the GET below
      }
      try {
        const status = await getDeletionStatus();
        if (status.status === "scheduled") return { ok: true, status };
      } catch {
        // The request is idempotent and keeps the first date, so asking again is safe.
      }
      return { ok: false, reason: "failed" };
    },
    getDeletionStatus,
    async cancelDeletion() {
      const response = await send("/restore", "POST");
      if (!response.ok) throw new Error(`Account deletion restore failed (${response.status})`);
      return { status: "active" };
    },
  };
}
