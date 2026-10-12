import { IPC_CHANNELS } from "@shared/types";
import type { StorageUsageResult } from "@shared/types/cloud-storage";
import type { AuthHandle } from "../infrastructure/auth-store";
import { fetchStorageUsage } from "./storage-client";
import { StorageUsageService } from "./storage-usage-service";
import { secureIpc } from "../security/ipc-guard";

/** Cloud account IPC that is not about the library itself (capacity today). */
export function registerCloudStorageHandlers(deps: { auth: AuthHandle; serverUrl: string }): void {
  const usage = new StorageUsageService({
    account: deps.auth.getCurrentAccount,
    fetchUsage: (token) => fetchStorageUsage({ serverUrl: deps.serverUrl }, token),
  });
  secureIpc.handle(IPC_CHANNELS.getStorageUsage, (): Promise<StorageUsageResult> => usage.get());
}
