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

import { LegalLinks } from "@/components/legal/legal-links";
import Header from "../components/header";
import { siteHeadMeta } from "@/lib/seo";
import appCss from "../index.css?url";
import { getAuthSession } from "@/lib/auth/get-auth-session";
import { getLocale } from "@/server-functions/get-locale";
import { setLocale as setLocaleFn } from "@/server-functions/set-locale";
import { getLandingTheme } from "@/server-functions/get-landing-theme";
import type { LandingTheme } from "@/lib/landing-theme";
import type { AuthSession } from "@/lib/auth/types";

export interface RouterAppContext {
  queryClient: QueryClient;
  isAuthenticated: boolean;
  session: AuthSession | null;
  locale: Locale;
  messages: Messages;
  /** The landing's own dark/light choice; unrelated to the app shell's theme. */
  landingTheme: LandingTheme;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  head: ({ match }) => ({
    meta: siteHeadMeta(match.context.locale),
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      // Raster only: the fox has no vector cut yet (see @kaipu/brand), and a
      // stale SVG here would win over every PNG in Chrome.
      { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
      { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
    ],
  }),
  component: RootDocument,
  staleTime: 10 * 60 * 1000, // 10 minutes
  beforeLoad: async () => {
    const [session, i18n, theme] = await Promise.all([
      getAuthSession(),
      getLocale(),
      getLandingTheme(),
    ]);
    return {
      session: session ?? null,
      isAuthenticated: !!session,
      locale: i18n.locale,
      messages: i18n.messages,
      landingTheme: theme.theme,
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

  // Public pages bring their own header and footer, so the app shell must stand
  // down for them. Read from the route's own staticData rather than matching on
  // the pathname: a new public page then declares its shell next to its route
  // instead of having to be remembered in a list here.
  const isMarketing = useRouterState({
    select: (s) => s.matches.some((m) => m.staticData.shell === "marketing"),
  });

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
            {!isMarketing && (
              <Header
                isAuthenticated={isAuthenticated}
                userName={session?.user?.name ?? ""}
                userEmail={session?.user?.email ?? ""}
              />
            )}
            <main className={isMarketing ? "" : "pt-12"}>
              <Outlet />
            </main>
            {!isMarketing && (
              <footer className="border-t px-6 py-8 text-muted-foreground">
                <LegalLinks />
              </footer>
            )}
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
