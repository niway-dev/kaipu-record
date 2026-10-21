import { createFileRoute, redirect } from "@tanstack/react-router";

/** Old home of the recordings table. Kept so existing links and bookmarks still land somewhere. */
export const Route = createFileRoute("/recordings")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/recordings" });
  },
});
