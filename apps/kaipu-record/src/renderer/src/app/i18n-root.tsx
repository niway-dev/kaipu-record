import type { ReactNode } from "react";
import { I18nProvider, type Locale } from "@kaipu/i18n";
import es from "@kaipu/i18n/messages/es";
import en from "@kaipu/i18n/messages/en";
import { setRuntimeLocale } from "@renderer/lib/runtime-i18n";

/**
 * Wraps any renderer root in <I18nProvider>, resolving the initial locale from
 * persisted AppSettings (the main process owns it). Persistence + external
 * changes reuse the existing settings bridge — no i18n-specific IPC.
 *
 * Async: it awaits the settings once so the provider mounts already in the right
 * language (no flash). `main.tsx` resolves it before `root.render`.
 */
export async function I18nRoot({ children }: { children: ReactNode }): Promise<React.JSX.Element> {
  const settings = await window.electronAPI.getSettings();
  // Keep non-React code (module singletons like recorder-store) in sync too.
  setRuntimeLocale(settings.locale);

  return (
    <I18nProvider
      initialLocale={settings.locale}
      messagesByLocale={{ es, en }}
      onLocaleChange={(locale: Locale) => {
        setRuntimeLocale(locale);
        void window.electronAPI.updateSettings({ locale });
      }}
      subscribeExternal={(apply) =>
        window.electronAPI.onSettingsChanged((s) => {
          setRuntimeLocale(s.locale);
          apply(s.locale);
        })
      }
    >
      {children}
    </I18nProvider>
  );
}
