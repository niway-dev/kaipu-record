import type { ReactNode } from "react";
import { I18nProvider, type Locale } from "@kaipu/i18n";
import es from "@kaipu/i18n/messages/es";
import en from "@kaipu/i18n/messages/en";
import { setRuntimeLocale } from "@renderer/lib/runtime-i18n";
import { applyTheme } from "@renderer/lib/apply-theme";

/**
 * Wraps any renderer root in <I18nProvider>, resolving the initial locale from
 * persisted AppSettings (the main process owns it). Persistence + external
 * changes reuse the existing settings bridge — no i18n-specific IPC.
 *
 * Async: it awaits the settings once so the provider mounts already in the right
 * language (no flash). `main.tsx` resolves it before `root.render`.
 * It is the single per-window root (main.tsx wraps every render target in it),
 * so applying the persisted theme here covers all four windows.
 */
/** Keep non-React code (recorder-store) + the document's `lang` (screen-reader
 *  pronunciation of the translated a11y text) in sync with the active locale. */
function syncLocale(locale: Locale): void {
  setRuntimeLocale(locale);
  document.documentElement.lang = locale;
}

export async function I18nRoot({ children }: { children: ReactNode }): Promise<React.JSX.Element> {
  const settings = await window.electronAPI.getSettings();
  syncLocale(settings.locale);
  applyTheme(settings.theme);

  return (
    <I18nProvider
      initialLocale={settings.locale}
      messagesByLocale={{ es, en }}
      onLocaleChange={(locale: Locale) => {
        syncLocale(locale);
        void window.electronAPI.updateSettings({ locale });
      }}
      subscribeExternal={(apply) =>
        window.electronAPI.onSettingsChanged((s) => {
          syncLocale(s.locale);
          applyTheme(s.theme);
          apply(s.locale);
        })
      }
    >
      {children}
    </I18nProvider>
  );
}
