import { createHashRouter, Navigate, RouterProvider } from "react-router-dom";
import { AppRoot } from "@renderer/shell/app-root";
import { AppShell } from "@renderer/shell/app-shell";
import { RouteErrorBoundary, NotFound } from "@renderer/shell/route-error";
import { RecordPage } from "@renderer/pages/record/record-page";
import { LibraryPage } from "@renderer/pages/library/library-page";
import { LibraryDetailPage } from "@renderer/pages/library-detail/library-detail-page";
import { SettingsLayout } from "@renderer/pages/settings/settings-layout";
import {
  AppSettingsPage,
  DeveloperSettingsPage,
  FilesSettingsPage,
  GeneralSettingsPage,
  PermissionsSettingsPage,
  RecordingQualitySettingsPage,
  RecordingSettingsPage,
  ScreenshotsSettingsPage,
} from "@renderer/pages/settings/settings-pages";
import { CloudPage } from "@renderer/pages/cloud/cloud-page";
import { ShortcutsPage } from "@renderer/pages/shortcuts/shortcuts-page";
import { ScreenshotsPage } from "@renderer/pages/screenshots/screenshots-page";
import { ScreenshotEditorPage } from "@renderer/pages/screenshot-editor/screenshot-editor-page";
import { VideoEditorPage } from "@renderer/pages/video-editor/video-editor-page";
import { EditorHomePage } from "@renderer/pages/editor/editor-home-page";
import {
  EditorImagePage,
  EditorVideoPage,
  LegacyScreenshotEditorRedirect,
} from "@renderer/pages/editor/editor-routes";
import { AuthPage } from "@renderer/pages/auth/auth-page";
import { ROUTES } from "@shared/routes";

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
 * Layout:
 *   - <AppRoot /> wraps everything: the always-on IPC listeners, banners and the
 *     version gate, so they survive on every route.
 *   - <AppShell /> (sidebar + status bar) hosts the regular pages. Add new sidebar
 *     pages as its children so they share the layout.
 *   - /sign-in and /sign-up are full-window pages: siblings of the shell, not
 *     children, so they render without the sidebar.
 */
const router = createHashRouter([
  {
    element: <AppRoot />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <RecordPage /> },
          { path: ROUTES.library, element: <LibraryPage /> },
          { path: ROUTES.libraryDetail, element: <LibraryDetailPage /> },
          { path: ROUTES.screenshots, element: <ScreenshotsPage /> },
          // Editor workspace: every Edit lands here, addressed by URL.
          { path: ROUTES.editor, element: <EditorHomePage /> },
          { path: ROUTES.editorVideo, element: <EditorVideoPage /> },
          { path: ROUTES.editorImage, element: <EditorImagePage /> },
          // A fresh capture is not in the vault yet: its image travels in router state.
          { path: ROUTES.editorCapture, element: <ScreenshotEditorPage /> },
          // Legacy paths, kept so old navigations land on the new routes.
          { path: ROUTES.screenshotEditor, element: <LegacyScreenshotEditorRedirect /> },
          { path: ROUTES.videoEditor, element: <VideoEditorPage /> },
          { path: ROUTES.shortcuts, element: <ShortcutsPage /> },
          { path: ROUTES.cloud, element: <CloudPage /> },
          {
            path: ROUTES.settings,
            element: <SettingsLayout />,
            children: [
              { index: true, element: <Navigate to="general" replace /> },
              { path: "general", element: <GeneralSettingsPage /> },
              { path: "permissions", element: <PermissionsSettingsPage /> },
              { path: "recording-quality", element: <RecordingQualitySettingsPage /> },
              { path: "recording", element: <RecordingSettingsPage /> },
              { path: "screenshots", element: <ScreenshotsSettingsPage /> },
              { path: "files", element: <FilesSettingsPage /> },
              { path: "app", element: <AppSettingsPage /> },
              ...(import.meta.env.DEV
                ? [{ path: "developer", element: <DeveloperSettingsPage /> }]
                : []),
            ],
          },
          { path: "*", element: <NotFound /> },
        ],
      },
      { path: ROUTES.signIn, element: <AuthPage mode="sign-in" /> },
      { path: ROUTES.signUp, element: <AuthPage mode="sign-up" /> },
    ],
  },
]);

export function AppRouter(): React.JSX.Element {
  return <RouterProvider router={router} />;
}
