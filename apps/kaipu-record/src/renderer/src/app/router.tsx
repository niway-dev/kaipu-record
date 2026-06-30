import { createHashRouter, RouterProvider } from "react-router-dom";
import { AppShell } from "@renderer/shell/app-shell";
import { RouteErrorBoundary, NotFound } from "@renderer/shell/route-error";
import { RecordPage } from "@renderer/pages/record/record-page";
import { LibraryPage } from "@renderer/pages/library/library-page";
import { LibraryDetailPage } from "@renderer/pages/library-detail/library-detail-page";
import { SettingsPage } from "@renderer/pages/settings/settings-page";
import { ShortcutsPage } from "@renderer/pages/shortcuts/shortcuts-page";
import { ScreenshotsPage } from "@renderer/pages/screenshots/screenshots-page";
import { ScreenshotEditorPage } from "@renderer/pages/screenshot-editor/screenshot-editor-page";

/**
 * Route tree for the app.
 *
 * `createHashRouter` (data router) is used on purpose:
 *   - Hash routing is required in packaged Electron because the renderer is
 *     loaded via `file://`, where real path routing (BrowserRouter) breaks.
 *   - The data router enables `useBlocker` for future unsaved-changes guards
 *     (e.g. an editor page).
 *
 * Error handling:
 *   - `errorElement` catches thrown render errors anywhere under the shell.
 *   - The `*` catch-all renders an in-shell 404 (sidebar stays visible) instead
 *     of letting React Router fall back to its default error screen.
 *
 * Add new pages as children of <AppShell /> so they share the sidebar/layout.
 */
const router = createHashRouter([
  {
    element: <AppShell />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <RecordPage /> },
      { path: "/library", element: <LibraryPage /> },
      { path: "/library/:id", element: <LibraryDetailPage /> },
      { path: "/screenshots", element: <ScreenshotsPage /> },
      { path: "/screenshot-editor", element: <ScreenshotEditorPage /> },
      { path: "/shortcuts", element: <ShortcutsPage /> },
      { path: "/settings", element: <SettingsPage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

export function AppRouter(): React.JSX.Element {
  return <RouterProvider router={router} />;
}
