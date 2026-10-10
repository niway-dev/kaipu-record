import { useSyncExternalStore } from "react";
import type { AuthStatus } from "@shared/types/auth";
import type { StorageUsage, StorageUsageResult } from "@shared/types/cloud-storage";
import { FREE_ENTITLEMENTS } from "@shared/entitlements";

/**
 * DEV-ONLY simulator for Settings → Storage and cloud. Forces the account state and every
 * capacity query state with fake numbers, so each design state can be checked without a
 * server (and keeps working once the server exists). Same guard as the watermark override:
 * every read checks `import.meta.env.DEV`, a build-time `false` in production, so this is
 * dead code there and a hand-edited localStorage key changes nothing.
 */

export const SIM_ACCOUNTS = ["real", "signed-in", "signed-out"] as const;
export type SimAccount = (typeof SIM_ACCOUNTS)[number];

export const SIM_CAPACITIES = [
  "real",
  "loading",
  "ok",
  "near-full",
  "stale",
  "error",
  "session-expired",
  "beta-unavailable",
  "not-available",
  "suspended",
] as const;
export type SimCapacity = (typeof SIM_CAPACITIES)[number];

export interface StorageSimulator {
  account: SimAccount;
  capacity: SimCapacity;
}

const STORAGE_KEY = "kaipu:dev:storage-simulator";
const OFF: StorageSimulator = { account: "real", capacity: "real" };

let current: StorageSimulator = read();
const listeners = new Set<() => void>();

function read(): StorageSimulator {
  if (!import.meta.env.DEV) return OFF;
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<
      Record<keyof StorageSimulator, unknown>
    > | null;
    return {
      account: (SIM_ACCOUNTS as readonly unknown[]).includes(parsed?.account)
        ? (parsed!.account as SimAccount)
        : "real",
      capacity: (SIM_CAPACITIES as readonly unknown[]).includes(parsed?.capacity)
        ? (parsed!.capacity as SimCapacity)
        : "real",
    };
  } catch {
    return OFF;
  }
}

export function writeStorageSimulator(patch: Partial<StorageSimulator>): void {
  if (!import.meta.env.DEV) return;
  current = { ...current, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* localStorage unavailable — keep the in-memory value */
  }
  for (const listener of listeners) listener();
}

export function useStorageSimulator(): StorageSimulator {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (import.meta.env.DEV ? current : OFF),
  );
}

const MB = 1_000_000;

function usage(overrides: Partial<StorageUsage> = {}): StorageUsage {
  // A Free account: the plan's capacity, not a made-up number.
  const capacityBytes = FREE_ENTITLEMENTS.features.cloudStorageBytes;
  const base = { capacityBytes, usedBytes: 150 * MB, reservedBytes: 30 * MB };
  const merged = { ...base, ...overrides };
  return {
    pendingUploads: 1,
    uploadsEnabled: true,
    cloudUploads: true,
    availableBytes: Math.max(0, merged.capacityBytes - merged.usedBytes - merged.reservedBytes),
    ...merged,
  };
}

/** The account status to show, with the simulator applied. */
export function simulatedAuthStatus(real: AuthStatus, sim: StorageSimulator): AuthStatus {
  if (sim.account === "signed-out") return { kind: "signed-out" };
  if (sim.account === "signed-in") {
    return {
      kind: "signed-in",
      userId: "dev-simulated",
      email: "dev@kaipu.local",
      name: "Dev",
      entitlements: FREE_ENTITLEMENTS,
    };
  }
  return real;
}

/**
 * The capacity result to show for a simulated state; `undefined` means "use the real query".
 * `null` is the loading state (no answer yet).
 */
export function simulatedStorageResult(
  sim: StorageSimulator,
  now: number,
): StorageUsageResult | null | undefined {
  switch (sim.capacity) {
    case "real":
      return undefined;
    case "loading":
      return null;
    case "ok":
      return { kind: "ok", usage: usage(), fetchedAt: now };
    case "near-full":
      return {
        kind: "ok",
        usage: usage({ usedBytes: 215 * MB, reservedBytes: 15 * MB }),
        fetchedAt: now,
      };
    case "stale":
      return { kind: "stale", usage: usage(), fetchedAt: now - 3 * 60 * 60 * 1000 };
    case "error":
      return { kind: "error" };
    case "session-expired":
      return { kind: "session-expired" };
    case "beta-unavailable":
      return { kind: "ok", usage: usage({ cloudUploads: false }), fetchedAt: now };
    case "not-available":
      return { kind: "not-available" };
    case "suspended":
      return { kind: "ok", usage: usage({ uploadsEnabled: false }), fetchedAt: now };
  }
}
