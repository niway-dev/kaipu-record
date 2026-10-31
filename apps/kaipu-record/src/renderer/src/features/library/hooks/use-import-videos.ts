import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslations } from "@kaipu/i18n";
import {
  importableVideoExtension,
  MAX_IMPORT_FILES,
  type ImportVideoFailure,
  type ImportVideoFailureReason,
  type ImportVideoResult,
} from "@shared/import-video";
import { reportError } from "@renderer/features/analytics";
import type { LocalRecording } from "@shared/types/library-storage";
import { showToast } from "@renderer/ui/toast-store";

/** i18n key (under `library`) of the sentence that explains each failure reason. */
const REASON_KEY = {
  "unsupported-type": "importReasonUnsupported",
  "not-found": "importReasonNotFound",
  "not-a-file": "importReasonNotAFile",
  unreadable: "importReasonUnreadable",
  "no-video-track": "importReasonNoVideo",
  "copy-failed": "importReasonCopyFailed",
  "too-many": "importReasonTooMany",
  "already-in-library": "importReasonAlreadyInLibrary",
} as const satisfies Record<ImportVideoFailureReason, string>;

export interface ImportVideosOptions {
  /**
   * Take over what happens once videos came in, instead of the "is in your Library" toast
   * (Prepare opens the first one, NIW2-587). Failures are still reported by the hook.
   */
  onImported?(imported: readonly LocalRecording[]): void;
}

export interface ImportVideos {
  /**
   * An import is running or waiting. A second import started meanwhile (a second drop) is
   * queued behind the running one, never dropped.
   */
  importing: boolean;
  /** Open the file dialog and import what the user picks. */
  pickAndImport(): Promise<void>;
  /** Import files dropped on the Library; anything that is not a video is skipped with a toast. */
  importDropped(files: readonly File[]): Promise<void>;
}

/**
 * Bringing outside videos into the Library (NIW2-579). Main validates, copies and
 * re-lists (`library:changed`); this hook only starts the import and reports it: a
 * toast per outcome, with "Open" when exactly one video came in.
 */
export function useImportVideos(options: ImportVideosOptions = {}): ImportVideos {
  const t = useTranslations("library");
  const navigate = useNavigate();
  const [importing, setImporting] = useState(false);
  /** Imports started and not finished yet, the running one included. */
  const pending = useRef(0);
  /** The tail of the queue: each import starts once the one before it has settled. */
  const queue = useRef<Promise<void>>(Promise.resolve());
  const onImportedRef = useRef(options.onImported);
  onImportedRef.current = options.onImported;

  const report = useCallback(
    (result: ImportVideoResult): void => {
      const [only] = result.imported;
      const onImported = onImportedRef.current;
      if (onImported) {
        if (result.imported.length > 0) onImported(result.imported);
      } else if (result.imported.length === 1 && only) {
        showToast({
          message: t("importedOne", { title: only.title }),
          action: { label: t("importOpen"), onClick: () => navigate(`/library/${only.assetId}`) },
        });
      } else if (result.imported.length > 1) {
        showToast({ message: t("importedMany", { count: result.imported.length }) });
      }
      if (result.failed.length > 0) showToast({ message: failureMessage(result.failed, t) });
    },
    [navigate, t],
  );

  const run = useCallback(
    (start: () => Promise<ImportVideoResult>): Promise<void> => {
      pending.current += 1;
      setImporting(true);
      const next = queue.current.then(async () => {
        try {
          const result = await start();
          if (!result.canceled) report(result);
        } catch (error) {
          reportError(t("importReasonCopyFailed"), error, { context: { phase: "import-video" } });
        } finally {
          pending.current -= 1;
          if (pending.current === 0) setImporting(false);
        }
      });
      queue.current = next;
      return next;
    },
    [report, t],
  );

  const pickAndImport = useCallback(() => run(() => window.electronAPI.importVideos()), [run]);

  const importDropped = useCallback(
    async (files: readonly File[]): Promise<void> => {
      const paths: string[] = [];
      const notVideos: string[] = [];
      const noPath: string[] = [];
      for (const file of files) {
        if (!importableVideoExtension(file.name)) {
          notVideos.push(file.name);
          continue;
        }
        // A video with no path on disk (dragged out of a web page) cannot be copied.
        const path = window.electronAPI.pathForFile(file);
        if (path) paths.push(path);
        else noPath.push(file.name);
      }
      if (notVideos.length > 0) {
        showToast({ message: t("importDropIgnored", { fileNames: notVideos.join(", ") }) });
      }
      if (noPath.length > 0) {
        showToast({ message: t("importDropNoPath", { fileNames: noPath.join(", ") }) });
      }
      if (paths.length === 0) return;
      await run(() => window.electronAPI.importVideoFiles(paths));
    },
    [run, t],
  );

  return { importing, pickAndImport, importDropped };
}

type Translate = ReturnType<typeof useTranslations<"library">>;

/** One file: name and why. Several: every name, so none goes unreported. */
function failureMessage(failed: readonly ImportVideoFailure[], t: Translate): string {
  const [first] = failed;
  if (failed.length === 1 && first) {
    return t("importFailedOne", {
      fileName: first.fileName,
      reason: t(REASON_KEY[first.reason], { max: MAX_IMPORT_FILES }),
    });
  }
  return t("importFailedMany", {
    count: failed.length,
    fileNames: failed.map((f) => f.fileName).join(", "),
  });
}
