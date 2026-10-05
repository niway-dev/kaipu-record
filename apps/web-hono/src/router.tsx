import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routerWithQueryClient } from "@tanstack/react-router-with-query";

import Loader from "./components/loader";
import { DEFAULT_LANDING_THEME } from "./lib/landing-theme";
import { createQueryClient } from "./lib/query-client";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = createQueryClient();
  const router = routerWithQueryClient(
    createTanStackRouter({
      routeTree,
      scrollRestoration: true,
      defaultPreloadStaleTime: 0,
      context: {
        queryClient,
        locale: "es",
        messages: {},
        messageSlices: [],
        // Placeholder until the root's beforeLoad reads the cookie; it must
        // match DEFAULT_LANDING_THEME or the first paint would be the wrong one.
        landingTheme: DEFAULT_LANDING_THEME,
      },
      defaultPendingComponent: () => <Loader />,
      defaultNotFoundComponent: () => <div>Not Found</div>,
    }),
    queryClient,
  );
  return router;
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
