/**
 * Reads the renderer-clock time of the MP4's first media sample (video time 0).
 *
 * mediabunny's default `timestampBase: "synced-zero"` stores
 * `performance.now() / 1000` of the first video/audio sample it accepts in the
 * PRIVATE field `Output._firstMediaStreamTimestamp` and stamps every later sample
 * relative to it. That field is the exact t0 the cursor track needs. It is private,
 * so: (1) read it defensively, (2) fall back to an estimate, (3) a unit test
 * (first-media-timestamp.test.ts) fails loudly if a mediabunny upgrade removes it.
 */

export interface FirstMediaTimestamp {
  /** Renderer `performance.now()` ms of video time 0. */
  rendererMs: number;
  quality: "exact" | "estimated";
}

interface OutputProbe {
  _firstMediaStreamTimestamp?: number | null;
}

export async function waitForFirstMediaTimestamp(
  output: object,
  /** Renderer ms captured right after `await output.start()` — used if the field never fills. */
  fallbackMs: number,
  options: {
    timeoutMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<FirstMediaTimestamp> {
  const timeoutMs = options.timeoutMs ?? 3000;
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const probe = output as OutputProbe;
  if (!("_firstMediaStreamTimestamp" in probe))
    return { rendererMs: fallbackMs, quality: "estimated" };
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const seconds = probe._firstMediaStreamTimestamp;
    if (typeof seconds === "number") return { rendererMs: seconds * 1000, quality: "exact" };
    await sleep(16);
  }
  return { rendererMs: fallbackMs, quality: "estimated" };
}

/**
 * The first-media time once the output has stopped: `measured` when it is exact, else the
 * private field read again. The live wait gives up after 3 s (a slow first frame) and settles
 * for an estimate, but the field, once mediabunny sets it, stays set for the output's life, so
 * a take that stops later can still record the exact time. Still the estimate when the field
 * is absent or never filled.
 */
export function rereadFirstMediaTimestamp(
  output: object,
  measured: FirstMediaTimestamp,
): FirstMediaTimestamp {
  if (measured.quality === "exact") return measured;
  const seconds = (output as OutputProbe)._firstMediaStreamTimestamp;
  return typeof seconds === "number" ? { rendererMs: seconds * 1000, quality: "exact" } : measured;
}
