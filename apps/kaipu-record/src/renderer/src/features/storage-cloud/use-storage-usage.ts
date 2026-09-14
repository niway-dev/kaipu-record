import { useCallback, useEffect, useRef, useState } from "react";
import type { StorageUsageResult } from "@shared/types/cloud-storage";

export interface StorageUsageStore {
  /** `null` until the first answer arrives for the current account. */
  result: StorageUsageResult | null;
  refreshing: boolean;
  refresh(): Promise<void>;
}

/**
 * Queries the account's cloud capacity on mount and again whenever `accountKey` changes
 * (sign-in, sign-out, account switch). Pass `enabled: false` to skip the IPC entirely —
 * the dev simulator uses that. A late answer for a previous account is dropped.
 */
export function useStorageUsage(accountKey: string | null, enabled = true): StorageUsageStore {
  const [result, setResult] = useState<StorageUsageResult | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const mine = ++generation.current;
    setRefreshing(true);
    try {
      const next = await window.electronAPI.getStorageUsage();
      if (mine === generation.current) setResult(next);
    } catch {
      if (mine === generation.current) setResult({ kind: "error" });
    } finally {
      if (mine === generation.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    setResult(null);
    void load();
  }, [accountKey, enabled, load]);

  return { result, refreshing, refresh: load };
}
