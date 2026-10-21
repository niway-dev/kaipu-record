/**
 * Global mouse-click hook for the cursor track (uiohook-napi), wrapped so that:
 *   - it NEVER triggers the macOS Accessibility prompt: libuiohook asks for
 *     Accessibility the moment it starts untrusted, so on macOS we start it only when
 *     `isTrustedAccessibilityClient(false)` already says yes. The prompt is shown only
 *     by the onboarding/settings UI (doc 03 § UI, PR 10).
 *   - it runs ONLY while a recording is sampling (started with the first tracker,
 *     stopped with the last), never at idle;
 *   - it subscribes to mouse-down ONLY. Be precise about what that buys: uIOhook.start()
 *     installs a PROCESS-WIDE input tap, and libuiohook receives every key and mouse
 *     event while it runs — that is exactly what the OS permission grants. What we
 *     control is what we keep. No keydown/keyup/input listener is registered here or
 *     anywhere else, and no keyboard event ever leaves this file. Keep it that way: the
 *     onboarding copy promises users that only mouse clicks are kept.
 *   - a missing/broken native binary degrades to "no clicks", never a crash.
 * Electron and the native module are injected so the policy is unit-tested.
 */
import type { CursorButton } from "@shared/cursor-track";

export interface HookLike {
  on(event: "mousedown", listener: (e: { button: unknown }) => void): unknown;
  start(): void;
  stop(): void;
}

export interface ClickHookDeps {
  platform: NodeJS.Platform;
  /** macOS: `systemPreferences.isTrustedAccessibilityClient(false)` — MUST NOT prompt. */
  isAccessibilityTrusted(): boolean;
  /** Lazily require the native module; null when it cannot load. */
  load(): HookLike | null;
}

/** libuiohook: 1 = left, 2 = right, 3 = middle. */
export function toCursorButton(raw: unknown): CursorButton | null {
  if (raw === 1) return 0;
  if (raw === 2) return 2;
  if (raw === 3) return 1;
  return null;
}

export class ClickHook {
  private hook: HookLike | null = null;
  private loadFailed = false;
  private running = false;

  constructor(
    private readonly deps: ClickHookDeps,
    private readonly onClick: (button: CursorButton) => void,
  ) {}

  /** Whether this platform + permission state allows the hook at all (no side effects). */
  allowed(): boolean {
    if (this.deps.platform === "darwin") return this.deps.isAccessibilityTrusted();
    return this.deps.platform === "win32";
  }

  /** Start if allowed; returns whether clicks are being captured. Idempotent. */
  ensureRunning(): boolean {
    if (this.running) return true;
    if (this.loadFailed || !this.allowed()) return false;
    try {
      if (!this.hook) {
        const hook = this.deps.load();
        if (!hook) {
          this.loadFailed = true;
          return false;
        }
        hook.on("mousedown", (e) => {
          const button = toCursorButton(e.button);
          if (button !== null) this.onClick(button);
        });
        this.hook = hook;
      }
      this.hook.start();
      this.running = true;
    } catch (error) {
      console.warn("click hook unavailable", error);
      this.loadFailed = true;
      this.running = false;
    }
    return this.running;
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    try {
      this.hook?.stop();
    } catch (error) {
      console.warn("click hook stop failed", error);
    }
  }

  get isRunning(): boolean {
    return this.running;
  }
}
