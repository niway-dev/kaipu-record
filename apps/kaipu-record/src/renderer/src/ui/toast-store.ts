/**
 * Module-singleton toast store. Lets non-React code (e.g. reportError) surface a
 * toast, while React subscribes via useSyncExternalStore. Single source of truth.
 */

export interface ToastAction {
  label: string;
  onClick(): void;
}

export interface ToastSpec {
  id: string;
  message: string;
  action?: ToastAction;
  durationMs: number;
}

const DEFAULT_DURATION_MS = 5000;
const MAX_TOASTS = 3;

let toasts: ToastSpec[] = [];
let counter = 0;
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Show a toast; returns its id. Auto-dismisses after `durationMs` (default 5s). */
export function showToast(spec: { message: string; action?: ToastAction; durationMs?: number }): string {
  const id = `toast-${++counter}`;
  const durationMs = spec.durationMs ?? DEFAULT_DURATION_MS;
  toasts = [...toasts, { id, message: spec.message, action: spec.action, durationMs }];
  timers.set(
    id,
    setTimeout(() => dismissToast(id), durationMs),
  );
  if (toasts.length > MAX_TOASTS) {
    const dropped = toasts.slice(0, toasts.length - MAX_TOASTS);
    toasts = toasts.slice(toasts.length - MAX_TOASTS);
    for (const t of dropped) {
      const timer = timers.get(t.id);
      if (timer) {
        clearTimeout(timer);
        timers.delete(t.id);
      }
    }
  }
  emit();
  return id;
}

export function dismissToast(id: string): void {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function getToasts(): ToastSpec[] {
  return toasts;
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
