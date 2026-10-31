import { useEffect } from "react";
import { createHashRouter, Navigate, RouterProvider } from "react-router-dom";
import { AppRoot } from "@renderer/shell/app-root";
import { AppShell } from "@renderer/shell/app-shell";
import { RouteErrorBoundary, NotFound } from "@renderer/shell/route-error";
import { RecordPage } from "@renderer/pages/record/record-page";
import { LibraryPage } from "@renderer/pages/library/library-page";
import { LibraryDetailPage } from "@renderer/pages/library-detail/library-detail-page";
import { ExportPage, LegacyPrepareRedirect } from "@renderer/pages/export/export-page";
import { SettingsLayout } from "@renderer/pages/settings/settings-layout";
import {
  AppSettingsPage,
  DeveloperSettingsPage,
  WorkspacesSettingsPage,
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
import { EditorNewPage } from "@renderer/pages/editor/editor-new-page";
import {
  EditorImagePage,
  EditorVideoPage,
  LegacyScreenshotEditorRedirect,
} from "@renderer/pages/editor/editor-routes";
import { AuthPage } from "@renderer/pages/auth/auth-page";
import { ROUTES } from "@shared/routes";
import { prepareForSwitch, switchFlushers } from "@renderer/features/workspaces/prepare-switch";

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
 *   - /sign-in is a full-window page: a sibling of the shell, not a child, so it
 *     renders without the sidebar.
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
          // Export a copy of a recording for where it is going; its own rail entry.
          { path: ROUTES.export, element: <ExportPage /> },
          // Export with no video: the door for any video, from Kaipu or from outside.
          { path: ROUTES.exportNew, element: <ExportPage /> },
          // Prepare was the screen's old name: its URLs land on Export, query kept.
          { path: ROUTES.prepare, element: <LegacyPrepareRedirect /> },
          { path: ROUTES.prepareNew, element: <LegacyPrepareRedirect /> },
          { path: ROUTES.screenshots, element: <ScreenshotsPage /> },
          // Editor workspace: every Edit lands here, addressed by URL.
          { path: ROUTES.editor, element: <EditorHomePage /> },
          // New: an empty editor that opens the image editor on a pasted image.
          { path: ROUTES.editorNew, element: <EditorNewPage /> },
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
              { path: "workspaces", element: <WorkspacesSettingsPage /> },
              // The page was "Files" before workspaces (ADR 0032).
              { path: "files", element: <Navigate to="../workspaces" replace /> },
              { path: "app", element: <AppSettingsPage /> },
              ...(import.meta.env.DEV
                ? [{ path: "developer", element: <DeveloperSettingsPage /> }]
                : []),
            ],
          },
          { path: "*", element: <NotFound /> },
        ],
      },
      { path: ROUTES.signIn, element: <AuthPage /> },
    ],
  },
]);

export function AppRouter(): React.JSX.Element {
  // This window's part of a workspace switch: flush editors, let their leave guards ask
  // about unsaved work, close what holds an item (ADR 0032, decision 7).
  useEffect(
    () => window.electronAPI.workspaces.onPrepare(() => prepareForSwitch(router, switchFlushers())),
    [],
  );
  return <RouterProvider router={router} />;
}
