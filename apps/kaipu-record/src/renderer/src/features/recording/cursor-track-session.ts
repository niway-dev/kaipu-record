/**
 * Renderer half of the cursor track: tells main to start sampling for a writer
 * session, measures the renderer→main clock offset once, and forwards the clock
 * anchor and every pause/resume edge ALREADY CONVERTED to main-clock ms.
 * Main never needs to know anything about the renderer's clock.
 *
 * Every call is best-effort: a failure here must never break a recording, so all
 * IPC errors are swallowed and the session degrades to "no cursor track". The whole
 * opening handshake is also raced against a timeout: main's `cursorTrackStart` handler
 * resolves the captured display through `desktopCapturer.getSources()`, and main can be
 * blocked for an unbounded time (a permission dialog, a busy encoder). Without the race
 * a stalled IPC would leave the recorder store in "starting" forever.
 */
import { measureClockOffset } from "./clock-sync";

export interface CursorTrackApi {
  cursorTrackStart(sessionId: string, sourceId: string): Promise<{ enabled: boolean }>;
  cursorClockNow(): Promise<number>;
  cursorTrackAnchor(sessionId: string, t0MainMs: number, quality: "exact" | "estimated"): void;
  cursorTrackPause(sessionId: string, atMainMs: number): void;
  cursorTrackResume(sessionId: string, atMainMs: number): void;
}

export interface CursorTrackSession {
  anchor(t0RendererMs: number, quality: "exact" | "estimated"): void;
  pause(atRendererMs: number): void;
  resume(atRendererMs: number): void;
}

export interface CursorTrackSessionOptions {
  /** Renderer clock; injected by the tests. */
  now?: () => number;
  /** Budget for `cursorTrackStart` + the ping handshake together. */
  timeoutMs?: number;
}

/**
 * Generous for `desktopCapturer.getSources()` on a healthy machine, short enough that a
 * blocked main process costs the cursor track and not the take.
 */
export const CURSOR_TRACK_START_TIMEOUT_MS = 500;

const NOOP_SESSION: CursorTrackSession = {
  anchor: () => {},
  pause: () => {},
  resume: () => {},
};

export async function beginCursorTrackSession(
  api: CursorTrackApi,
  sessionId: string,
  sourceId: string,
  options: CursorTrackSessionOptions = {},
): Promise<CursorTrackSession> {
  const now = options.now ?? (() => performance.now());
  const timeoutMs = options.timeoutMs ?? CURSOR_TRACK_START_TIMEOUT_MS;
  const open = async (): Promise<CursorTrackSession> => {
    try {
      const { enabled } = await api.cursorTrackStart(sessionId, sourceId);
      if (!enabled) return NOOP_SESSION;
      const { offset } = await measureClockOffset(() => api.cursorClockNow(), now);
      return {
        anchor: (t0, quality) => api.cursorTrackAnchor(sessionId, t0 + offset, quality),
        pause: (at) => api.cursorTrackPause(sessionId, at + offset),
        resume: (at) => api.cursorTrackResume(sessionId, at + offset),
      };
    } catch (error) {
      console.warn("cursor track unavailable for this recording", error);
      return NOOP_SESSION;
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<CursorTrackSession>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`cursor track start timed out after ${timeoutMs} ms`);
      resolve(NOOP_SESSION);
    }, timeoutMs);
  });
  try {
    return await Promise.race([open(), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}
