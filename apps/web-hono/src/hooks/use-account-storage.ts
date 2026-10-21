import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { toCapacityView, type CapacityView } from "@kaipu/domain/capacity";
import { client } from "@/lib/orpc-client";
import { classifyStorageError, toStorageResult } from "@/lib/storage-usage";

export const accountKeys = {
  all: ["account"] as const,
  storage: () => [...accountKeys.all, "storage"] as const,
  entitlements: () => [...accountKeys.all, "entitlements"] as const,
};

/** A 401 or 404 will not change by asking again; anything else gets one retry. */
const retry = (count: number, error: unknown): boolean =>
  classifyStorageError(error) === "error" && count < 1;

export function useAccountStorage() {
  const storage = useQuery({
    queryKey: accountKeys.storage(),
    queryFn: async () => {
      const response = await client.me.storage();
      // An empty or malformed answer is a fault, never "0 B used".
      if (!response.data) throw new Error(response.error?.message ?? "No storage data");
      return response.data;
    },
    retry,
    refetchOnWindowFocus: true,
  });
  const entitlements = useQuery({
    queryKey: accountKeys.entitlements(),
    queryFn: async () => {
      const response = await client.me.entitlements();
      if (!response.data) throw new Error(response.error?.message ?? "No entitlements data");
      return response.data;
    },
    retry,
  });

  const view: CapacityView = useMemo(
    () =>
      toCapacityView(
        toStorageResult({
          data: storage.data,
          error: storage.error,
          isError: storage.isError,
          dataUpdatedAt: storage.dataUpdatedAt,
        }),
      ),
    [storage.data, storage.error, storage.isError, storage.dataUpdatedAt],
  );

  return {
    view,
    plan: entitlements.data ?? null,
    refreshing: storage.isFetching,
    refresh: () => {
      void storage.refetch();
      void entitlements.refetch();
    },
  };
}
