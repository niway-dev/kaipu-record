import { createFileRoute, redirect } from "@tanstack/react-router";

/** The library moved into the dashboard; old links and bookmarks keep working. */
export const Route = createFileRoute("/_authenticated/recordings/")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/recordings", replace: true });
  },
});
