import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { IntlProvider } from "use-intl";
import { TIME_ZONE, type Locale } from "./config";

type Messages = Record<string, unknown>;

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export interface I18nProviderProps {
  initialLocale: Locale;
  messagesByLocale: Record<Locale, Messages>;
  /** Platform persistence: cookie on web, settings IPC on desktop. */
  onLocaleChange?: (locale: Locale) => void;
  /**
   * External locale changes (e.g. the desktop settings broadcast). Receives an
   * `apply` that sets state WITHOUT re-persisting (prevents an IPC loop) and
   * returns an unsubscribe.
   */
  subscribeExternal?: (apply: (locale: Locale) => void) => () => void;
  children: ReactNode;
}

export function I18nProvider({
  initialLocale,
  messagesByLocale,
  onLocaleChange,
  subscribeExternal,
  children,
}: I18nProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next);
      onLocaleChange?.(next);
    },
    [onLocaleChange],
  );

  useEffect(() => {
    if (!subscribeExternal) return;
    return subscribeExternal((next) => setLocaleState(next));
  }, [subscribeExternal]);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);

  return (
    <LocaleContext.Provider value={value}>
      <IntlProvider
        locale={locale}
        messages={messagesByLocale[locale]}
        timeZone={TIME_ZONE}
        now={new Date()}
      >
        {children}
      </IntlProvider>
    </LocaleContext.Provider>
  );
}

export function useLocale(): Locale {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within <I18nProvider>");
  return ctx.locale;
}

export function useSetLocale(): (locale: Locale) => void {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useSetLocale must be used within <I18nProvider>");
  return ctx.setLocale;
}
