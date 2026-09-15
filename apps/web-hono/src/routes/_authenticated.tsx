import { NOINDEX } from "@/lib/seo";
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated")({
  head: () => NOINDEX,
  beforeLoad: async (ctx) => {
    const { isAuthenticated } = ctx.context;

    if (!isAuthenticated) {
      throw redirect({ to: "/auth/login" });
    }
  },
});
