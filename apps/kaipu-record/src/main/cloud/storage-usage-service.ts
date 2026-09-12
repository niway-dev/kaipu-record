import type { StorageUsage, StorageUsageResult } from "@shared/types/cloud-storage";

export interface StorageUsageServiceDeps {
  account(): { userId: string; token: string } | null;
  fetchUsage(token: string): Promise<StorageUsage>;
  now?: () => number;
}

function isUnauthorized(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { kind?: unknown }).kind === "unauthorized";
}

/**
 * Answers "how much cloud space does this account have?" with an honest result.
 * Remembers the last good answer per account (memory only), so a failed refresh shows
 * the known figure marked stale rather than an error or, worse, zeros. The memory is
 * keyed by userId: account B never sees account A's numbers.
 */
export class StorageUsageService {
  private readonly lastGood = new Map<string, { usage: StorageUsage; fetchedAt: number }>();

  constructor(private readonly deps: StorageUsageServiceDeps) {}

  async get(): Promise<StorageUsageResult> {
    const account = this.deps.account();
    if (!account) return { kind: "signed-out" };
    try {
      const usage = await this.deps.fetchUsage(account.token);
      const fetchedAt = (this.deps.now ?? Date.now)();
      this.lastGood.set(account.userId, { usage, fetchedAt });
      return { kind: "ok", usage, fetchedAt };
    } catch (err) {
      if (isUnauthorized(err)) {
        this.lastGood.delete(account.userId);
        return { kind: "session-expired" };
      }
      const known = this.lastGood.get(account.userId);
      return known ? { kind: "stale", ...known } : { kind: "error" };
    }
  }
}
