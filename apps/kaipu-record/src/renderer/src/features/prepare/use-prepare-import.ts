import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslations } from "@kaipu/i18n";
import { useFileDrop } from "@renderer/features/library/hooks/use-file-drop";
import { useImportVideos } from "@renderer/features/library/hooks/use-import-videos";
import { showToast } from "@renderer/ui/toast-store";
import type { DestinationId } from "./destinations";
import { preparePath } from "./prepare-path";

export interface PrepareImport {
  /** An import is running: the drop zone and the footer say so. */
  importing: boolean;
  /** Files from the OS are being dragged over the window. */
  dragging: boolean;
  /** "Choose a file…": the Library's import dialog. */
  pickAndImport(): Promise<void>;
}

interface PrepareImportOptions {
  /** The destination selected when the import finishes, carried over as `?to=`. */
  destination(): DestinationId | null;
  /** Re-list the Library, so the page opened next already holds the new video. */
  refresh(): Promise<void>;
}

/**
 * Bring an outside video into Prepare (NIW2-587): the Library's import (NIW2-579, the same
 * main-side validation and copy into the vault), then Prepare opened on the first new video
 * with the destination that was selected. More than one: all are imported, the rest are
 * named in a toast.
 *
 * While Prepare is mounted the whole window takes file drops (`useFileDrop`), so a video
 * dropped anywhere on the page imports, and a drop never makes Electron navigate the
 * window to the file.
 *
 * An import can outlive the screen: the user may leave Export while a large file copies.
 * Then nothing navigates; the Library's own toast says the video came in, with "Open".
 */
export function usePrepareImport({ destination, refresh }: PrepareImportOptions): PrepareImport {
  const t = useTranslations("prepare");
  const tLibrary = useTranslations("library");
  const navigate = useNavigate();
  const latest = useRef({ destination, refresh });
  latest.current = { destination, refresh };
  const mounted = useRef(true);
  useEffect(() => {
    // Set here as well as in the initial value, so StrictMode's remount restores it.
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const onImported = useCallback(
    (imported: readonly { assetId: string; title: string }[]): void => {
      const [first, ...rest] = imported;
      if (!first) return;
      if (!mounted.current) {
        // The user left Export mid-import: do not pull them back, say where the video is.
        showToast(
          rest.length === 0
            ? {
                message: tLibrary("importedOne", { title: first.title }),
                action: {
                  label: tLibrary("importOpen"),
                  onClick: () => navigate(`/library/${first.assetId}`),
                },
              }
            : { message: tLibrary("importedMany", { count: imported.length }) },
        );
        return;
      }
      const { destination: selected, refresh: relist } = latest.current;
      const to = selected() ?? undefined;
      void relist().then(() => {
        if (mounted.current) navigate(preparePath(first.assetId, to));
      });
      if (rest.length > 0) showToast({ message: t("dropMoreInLibrary", { count: rest.length }) });
    },
    [navigate, t, tLibrary],
  );

  const { importing, pickAndImport, importDropped } = useImportVideos({ onImported });
  const { dragging } = useFileDrop((files) => void importDropped(files));
  return { importing, dragging, pickAndImport };
}
