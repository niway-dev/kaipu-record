import { Outlet } from "@tanstack/react-router";

import { LegalLinks } from "@/components/legal/legal-links";
import type { AuthSession } from "@/lib/auth/types";
import { AppToaster } from "./app-toaster";
import Header from "./header";

/**
 * The chrome of every non-marketing route: the app header (with the account
 * menu), the legal footer and the toast host.
 *
 * It is mounted by the `auth` and `_authenticated` layouts rather than the root
 * document, so the public pages never download the account menu, the auth client
 * or the toaster. Both layouts resolve the session in their own `beforeLoad` and
 * pass it in.
 */
export function AppShell({ session }: { session: AuthSession | null }) {
  return (
    <>
      <Header
        isAuthenticated={!!session}
        userName={session?.user?.name ?? ""}
        userEmail={session?.user?.email ?? ""}
      />
      <main className="pt-12">
        <Outlet />
      </main>
      <footer className="border-t px-6 py-8 text-muted-foreground">
        <LegalLinks />
      </footer>
      <AppToaster />
    </>
  );
}
