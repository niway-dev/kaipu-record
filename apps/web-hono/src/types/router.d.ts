import "@tanstack/react-router";

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /**
     * Which chrome the root document wraps this route in.
     *
     * `"marketing"` means the route renders its own public header and footer
     * (`LandingNav` + `Footer`), so the root must not add the app `Header` and
     * legal footer on top — that is what produced two headers on `/roadmap`.
     *
     * Routes that omit this get the app shell, which is the right default for
     * anything behind sign-in.
     */
    shell?: "marketing";
  }
}
