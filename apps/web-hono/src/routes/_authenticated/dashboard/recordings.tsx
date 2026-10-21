import { createFileRoute } from "@tanstack/react-router";

import { RecordingsPage } from "@/components/dashboard/recordings-page";

export const Route = createFileRoute("/_authenticated/dashboard/recordings")({
  // Imported on demand: the hooks module pulls in the oRPC client, the API
  // contract and zod, and a static import here would put all of it in the entry
  // chunk, which every public page downloads.
  loader: async ({ context }) => {
    const { recordingsQueryOptions } = await import("@/hooks/use-recordings");
    return context.queryClient.ensureQueryData(recordingsQueryOptions());
  },
  component: RecordingsPage,
});
