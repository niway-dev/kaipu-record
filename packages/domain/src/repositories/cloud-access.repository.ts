/**
 * Cloud upload access + operator switch. Access is automatic for accounts with a verified email
 * (Task 0 #8) — there is no allowlist. The switch is flipped through the `cloud:uploads` admin
 * command (Task 11), never through the API.
 */
export interface CloudControl {
  /** When false the server issues no new upload tickets; reads and deletes keep working. */
  uploadsEnabled: boolean;
}

export interface ICloudAccessRepository {
  /** True when the account's email is verified. */
  hasAccess(userId: string): Promise<boolean>;
  getControl(): Promise<CloudControl>;
}
