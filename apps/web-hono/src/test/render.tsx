import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { I18nProvider, type Locale } from "@kaipu/i18n";
import en from "@kaipu/i18n/messages/en";
import es from "@kaipu/i18n/messages/es";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Renders with the providers the app has: a fresh query cache (no retries) and the catalogs. */
export function renderWithProviders(ui: ReactElement, locale: Locale = "en") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider initialLocale={locale} messagesByLocale={{ en, es }}>
        {ui}
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}
