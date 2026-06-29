import { parseVersionGateConfig, type VersionGateConfig } from "@shared/version-gate";

/**
 * Fetch + parse the remote version-gate config. Returns null on ANY failure
 * (network, non-2xx, malformed JSON, failed validation) — the caller treats
 * null as "no opinion" so the gate stays fail-open.
 */
export async function fetchVersionGateConfig(url: string): Promise<VersionGateConfig | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const raw: unknown = await res.json();
    return parseVersionGateConfig(raw);
  } catch {
    return null;
  }
}
