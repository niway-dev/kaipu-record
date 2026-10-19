import { createFileRoute, redirect } from "@tanstack/react-router";

/** The account page split into the dashboard's profile and settings pages. */
export const Route = createFileRoute("/_authenticated/account/")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/profile", replace: true });
  },
});
