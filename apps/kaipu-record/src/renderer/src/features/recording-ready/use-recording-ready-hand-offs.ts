import { useEffect } from "react";
import { generatePath, useNavigate } from "react-router-dom";
import { ROUTES } from "@shared/routes";
import type { RecordingReadyHandOff } from "@shared/types/recording-ready";
import { editorPathFor } from "@renderer/features/editor/open-in-editor";
import { preparePath } from "@renderer/features/prepare/prepare-path";

/**
 * Where a hand-off from the floating card lands, through the same helpers as the in-app
 * card: Prepare's (`preparePath`, so a renamed Prepare route follows), the editor's, and the
 * recording's own page.
 */
export function pathForHandOff(handOff: RecordingReadyHandOff): string {
  switch (handOff.target) {
    case "prepare":
      return preparePath(handOff.assetId, handOff.destination ?? undefined);
    case "editor":
      return editorPathFor({ assetId: handOff.assetId, kind: "recording" });
    case "detail":
      return generatePath(ROUTES.libraryDetail, { assetId: handOff.assetId });
  }
}

/**
 * The floating "Your video is ready" card's hand-offs to the main window (mounted once, in
 * `AppRoot`). Main has already closed the card and shown this window; here it navigates.
 */
export function useRecordingReadyHandOffs(): void {
  const navigate = useNavigate();
  useEffect(
    () => window.electronAPI.onRecordingReadyOpen((handOff) => navigate(pathForHandOff(handOff))),
    [navigate],
  );
}
