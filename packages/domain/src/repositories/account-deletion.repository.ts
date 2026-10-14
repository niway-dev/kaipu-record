/** A pending account deletion: the account is deactivated until `scheduledAt`. */
export interface AccountDeletion {
  userId: string;
  requestedAt: Date;
  scheduledAt: Date;
  /** Locale for the final "your account was deleted" email, captured at request time. */
  locale: string;
}

/** A due deletion plus what the final email needs, read before the user row disappears. */
export interface DueAccountDeletion extends AccountDeletion {
  email: string;
}

export interface IAccountDeletionRepository {
  find(userId: string): Promise<AccountDeletion | null>;
  /** Idempotent: an existing schedule is kept (a second request never pushes the date out). */
  schedule(data: AccountDeletion): Promise<AccountDeletion>;
  /** Restore: removes the schedule. `false` when there was nothing to cancel. */
  cancel(userId: string): Promise<boolean>;
  /** Deletes every session of the user: web cookies and desktop bearer tokens alike. */
  revokeSessions(userId: string): Promise<number>;
  listDue(now: Date, limit: number): Promise<DueAccountDeletion[]>;
  /**
   * Atomically enqueue the cloud purge and hard-delete the user row (the cascade removes every
   * cloud row and the schedule itself) — only if the deletion is still scheduled and due at `now`.
   * `false` when it was restored in the meantime or the user is already gone.
   */
  finalize(userId: string, now: Date): Promise<boolean>;
}
