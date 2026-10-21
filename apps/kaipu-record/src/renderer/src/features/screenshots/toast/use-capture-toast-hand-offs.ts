import { useEffect } from "react";
import { generatePath, useNavigate } from "react-router-dom";
import { ROUTES } from "@shared/routes";
import { screenshotTitle } from "@shared/screenshot-title";
import { useOpenInEditor } from "@renderer/features/editor/open-in-editor";

/**
 * The capture toast's hand-offs to the main window (mounted once, in `AppRoot`). Main
 * asks; the renderer navigates, then reveals the window, so it comes back already showing
 * the item — the same order as the capture hotkey's editor path.
 */
export function useCaptureToastHandOffs(): void {
  const navigate = useNavigate();
  const { openCapture } = useOpenInEditor();

  // Annotate on a saved shot, or Open in Library.
  useEffect(
    () =>
      window.electronAPI.onOpenSavedScreenshot(({ target, assetId }) => {
        const route = target === "editor" ? ROUTES.editorImage : ROUTES.libraryDetail;
        navigate(generatePath(route, { assetId }));
        window.electronAPI.revealAfterCapture();
      }),
    [navigate],
  );

  // Annotate on a copy-only shot: main hands its kept bytes over once. `origin: "quiet"`:
  // main already copied them, so the editor runs no auto action.
  useEffect(
    () =>
      window.electronAPI.onOpenQuietCapture(({ png, width, height }) => {
        openCapture({
          kind: "blob",
          origin: "quiet",
          bytes: png,
          width,
          height,
          title: screenshotTitle(),
        });
        window.electronAPI.revealAfterCapture();
      }),
    [openCapture],
  );
}
