import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import css from "../styles.css?url";
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Kaipu Console" },
      { name: "robots", content: "noindex, nofollow" },
    ],
    links: [{ rel: "stylesheet", href: css }],
  }),
  component: () => (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  ),
  notFoundComponent: () => (
    <main className="login">
      <h1>Page not found</h1>
      <a href="/">Back to Console</a>
    </main>
  ),
  errorComponent: ({ reset }) => (
    <main className="login">
      <h1>Unable to load Console</h1>
      <p>The service is unavailable. Try again shortly.</p>
      <button onClick={reset}>Try again</button>
    </main>
  ),
});
