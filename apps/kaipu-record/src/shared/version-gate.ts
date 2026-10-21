/**
 * Pure version-gate model shared by both processes. No electron/node/DOM imports.
 * House rule: `as const` + derived types, no TS enums (same idiom as shared/analytics.ts).
 */

/** 10 minutes between network checks — the primary rate limiter for focus re-checks. */
export const VERSION_GATE_THROTTLE_MS = 10 * 60 * 1000;

/** Where the "Actualizar" button points when the config omits a downloadUrl. */
export const DEFAULT_DOWNLOAD_URL = "https://github.com/niway-dev/kaipu-record/releases/latest";

export interface VersionGateConfig {
  minVersion: string;
  latestVersion: string;
  message?: string;
  downloadUrl?: string;
}

export type GateState =
  | { kind: "ok" }
  | { kind: "soft"; message: string; downloadUrl: string }
  | { kind: "hard"; message: string; downloadUrl: string };

/** Parse "1.2.3" into [1, 2, 3]; non-numeric or missing parts become 0. */
function parts(version: string): [number, number, number] {
  const split = version.split(".").map((p) => {
    const n = Number.parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  });
  return [split[0] ?? 0, split[1] ?? 0, split[2] ?? 0];
}

/** -1 | 0 | 1 for a vs b on plain x.y.z. Missing/short parts are treated as 0. */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

const DEFAULT_HARD_MESSAGE =
  "Esta versión ya no es compatible. Actualizá para seguir usando Kaipu.";
const DEFAULT_SOFT_MESSAGE = "Hay una versión nueva con mejoras. Actualizá cuando puedas.";

/** Map current version + config → GateState. minVersion drives hard, latestVersion drives soft. */
export function evaluateGate(currentVersion: string, config: VersionGateConfig): GateState {
  const downloadUrl = config.downloadUrl ?? DEFAULT_DOWNLOAD_URL;
  if (compareSemver(currentVersion, config.minVersion) < 0) {
    return { kind: "hard", message: config.message ?? DEFAULT_HARD_MESSAGE, downloadUrl };
  }
  if (compareSemver(currentVersion, config.latestVersion) < 0) {
    return { kind: "soft", message: config.message ?? DEFAULT_SOFT_MESSAGE, downloadUrl };
  }
  return { kind: "ok" };
}

/** Validate untrusted JSON. Returns null on anything malformed (→ fail-open). */
export function parseVersionGateConfig(raw: unknown): VersionGateConfig | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.minVersion !== "string" || typeof r.latestVersion !== "string") return null;
  const config: VersionGateConfig = { minVersion: r.minVersion, latestVersion: r.latestVersion };
  if (typeof r.message === "string") config.message = r.message;
  if (typeof r.downloadUrl === "string") config.downloadUrl = r.downloadUrl;
  return config;
}
