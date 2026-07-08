import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

const STORAGE_KEY = "kaipu-theme";
export type Theme = "dark" | "light";

let listeners: Array<() => void> = [];

function readTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function setTheme(next: Theme) {
  // dark is the default: represented as no storage entry.
  try {
    if (next === "light") {
      localStorage.setItem(STORAGE_KEY, "light");
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage unavailable: readTheme() will keep reporting "dark", so the
    // toggle is a no-op. Acceptable — no known browser mode lands here.
  }
  for (const notify of listeners) notify();
}

function subscribe(notify: () => void) {
  listeners.push(notify);
  return () => {
    listeners = listeners.filter((l) => l !== notify);
  };
}

/**
 * Landing-scoped theme: dark default, "light" persisted under kaipu-theme.
 * The landing route applies it as data-theme on its own wrapper — never on
 * <html> — so app/auth routes (shadcn, .dark class) can't be affected.
 */
export function useLandingTheme(): Theme {
  return useSyncExternalStore(subscribe, readTheme, () => "dark" as Theme);
}

/** Sun/moon button switching the landing's kaipu tokens. */
export function ThemeToggle() {
  const theme = useLandingTheme();
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      aria-label={theme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
      onClick={() => setTheme(next)}
      className="rounded-md border border-[var(--kaipu-border)] p-1.5 text-[var(--kaipu-text-secondary)] transition hover:text-[var(--kaipu-text-primary)]"
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
