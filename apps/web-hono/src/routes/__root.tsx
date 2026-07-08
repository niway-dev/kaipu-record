import type { QueryClient } from "@tanstack/react-query";

import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import { Toaster } from "@kaipu/web-ui";
import { I18nProvider, type Locale, type Messages } from "@kaipu/i18n";
import es from "@kaipu/i18n/messages/es";
import en from "@kaipu/i18n/messages/en";

import Header from "../components/header";
import appCss from "../index.css?url";
import { getAuthSession } from "@/lib/auth/get-auth-session";
import { getLocale } from "@/server-functions/get-locale";
import { setLocale as setLocaleFn } from "@/server-functions/set-locale";
import type { AuthSession } from "@/lib/auth/types";

export interface RouterAppContext {
  queryClient: QueryClient;
  isAuthenticated: boolean;
  session: AuthSession | null;
  locale: Locale;
  messages: Messages;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Kaipu Record — Grabá tu pantalla, sin complicaciones",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  component: RootDocument,
  staleTime: 10 * 60 * 1000, // 10 minutes
  beforeLoad: async () => {
    const [session, i18n] = await Promise.all([getAuthSession(), getLocale()]);
    return {
      session: session ?? null,
      isAuthenticated: !!session,
      locale: i18n.locale,
      messages: i18n.messages,
    };
  },
});

// Critical inline styles to prevent flash of unstyled content
const criticalStyles = `
  html, body {
    background-color: oklch(14.5% 0 0);
    color: oklch(98.5% 0 0);
    margin: 0;
    padding: 0;
  }
`;

function RootDocument() {
  const context = Route.useRouteContext();
  const router = useRouter();
  const { isAuthenticated, session, locale } = context;

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isLanding = pathname === "/";

  // Persist to the cookie, then re-run beforeLoad so the whole tree re-renders
  // with the new messages (resolved server-side — no flash).
  const handleSetLocale = async (next: Locale) => {
    await setLocaleFn({ data: next });
    await router.invalidate();
  };

  return (
    <html lang={locale} className="dark" suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: criticalStyles }} />
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        <I18nProvider
          initialLocale={locale}
          messagesByLocale={{ es, en }}
          onLocaleChange={(next) => void handleSetLocale(next)}
        >
          <div className="min-h-svh">
            {!isLanding && (
              <Header
                isAuthenticated={isAuthenticated}
                userName={session?.user?.name ?? ""}
                userEmail={session?.user?.email ?? ""}
              />
            )}
            <main className={isLanding ? "" : "pt-12"}>
              <Outlet />
            </main>
          </div>
        </I18nProvider>
        <Toaster richColors />
        <TanStackRouterDevtools position="bottom-left" />
        <ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
        <Scripts />
      </body>
    </html>
  );
}
