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
