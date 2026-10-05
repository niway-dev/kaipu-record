import { QueryCache, QueryClient } from "@tanstack/react-query";

// Create a new QueryClient per request (required for SSR)
export function createQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        // Loaded on demand: sonner is only needed once something fails, and a
        // static import would put it in the entry chunk of every page.
        void import("sonner").then(({ toast }) => {
          toast.error(`Error: ${error.message}`, {
            action: {
              label: "retry",
              onClick: query.invalidate,
            },
          });
        });
      },
    }),
  });
}
