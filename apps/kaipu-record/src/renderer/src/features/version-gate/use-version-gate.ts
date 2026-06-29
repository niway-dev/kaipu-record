import { useEffect, useRef, useState } from "react";
import {
  VERSION_GATE_THROTTLE_MS,
  evaluateGate,
  type GateState,
  type VersionGateConfig,
} from "@shared/version-gate";
import { fetchVersionGateConfig } from "./fetch-version-gate-config";

/**
 * Evaluate the version gate against a remote config. Fail-open: returns
 * { kind: "ok" } until a fetched config says otherwise. Re-checks on window
 * focus, throttled to VERSION_GATE_THROTTLE_MS, and caches the last-good config
 * so a throttled/failed focus check never regresses a real block.
 */
export function useVersionGate(): GateState {
  const [state, setState] = useState<GateState>({ kind: "ok" });
  const lastGood = useRef<VersionGateConfig | null>(null);
  const lastCheckedAt = useRef<number>(0);
  const versionRef = useRef<string | null>(null);

  useEffect(() => {
    const url = import.meta.env.VITE_VERSION_GATE_URL;
    if (!url) return; // gate disabled (e.g. local dev) — stay ok
    const gateUrl: string = url; // narrowed; closures below capture this

    let cancelled = false;

    async function check(): Promise<void> {
      lastCheckedAt.current = Date.now();
      if (!versionRef.current) versionRef.current = await window.electronAPI.getAppVersion();
      const fetched = await fetchVersionGateConfig(gateUrl);
      const config = fetched ?? lastGood.current;
      if (cancelled || !config || !versionRef.current) return;
      lastGood.current = config;
      setState(evaluateGate(versionRef.current, config));
    }

    void check();

    const onFocus = (): void => {
      if (Date.now() - lastCheckedAt.current >= VERSION_GATE_THROTTLE_MS) void check();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return state;
}
