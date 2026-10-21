import { createFileRoute, redirect } from "@tanstack/react-router";

/** Old home of the account page. Kept so existing links and bookmarks still land somewhere. */
export const Route = createFileRoute("/account")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/profile" });
  },
});
