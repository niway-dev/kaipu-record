import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

const STORAGE_KEY = "kaipu-theme";
type Theme = "dark" | "light";

let listeners: Array<() => void> = [];

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function setTheme(next: Theme) {
  // dark is the default: represented as NO attribute + no storage entry.
  if (next === "light") {
    document.documentElement.dataset.theme = "light";
    localStorage.setItem(STORAGE_KEY, "light");
  } else {
    delete document.documentElement.dataset.theme;
    localStorage.removeItem(STORAGE_KEY);
  }
  for (const notify of listeners) notify();
}

function subscribe(notify: () => void) {
  listeners.push(notify);
  return () => {
    listeners = listeners.filter((l) => l !== notify);
  };
}

/** Sun/moon button switching the landing's kaipu tokens via data-theme on <html>. */
export function ThemeToggle() {
  // SSR snapshot is "dark" (the default); the inline head script has already
  // applied any stored "light" before hydration, so the client snapshot agrees.
  const theme = useSyncExternalStore(subscribe, currentTheme, () => "dark" as Theme);
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
