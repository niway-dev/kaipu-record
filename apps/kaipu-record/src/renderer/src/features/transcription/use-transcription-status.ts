import { useCallback, useEffect, useRef, useState } from "react";
import type {
  TranscriptionModelDownloadResult,
  TranscriptionStatus,
} from "@shared/types/transcription";

/** Why the last download of a model failed; `unknown` when the IPC call itself rejected. */
export type ModelDownloadFailure =
  | Extract<TranscriptionModelDownloadResult, { status: "failed" }>["code"]
  | "unknown";

/** What the app shows when main cannot even answer: the engine cannot be used. */
const UNREACHABLE: TranscriptionStatus = {
  availability: { status: "unavailable", reason: "engine-broken" },
  defaultModelId: "",
  models: [],
  job: null,
};

export interface TranscriptionStatusApi {
  /** `null` until the first answer arrives. */
  status: TranscriptionStatus | null;
  /**
   * The failure code of each model's last download. Main's own failed status carries only a
   * message, and only until the app restarts; the code is what picks the wording.
   */
  failures: Readonly<Record<string, ModelDownloadFailure>>;
  refresh(): Promise<void>;
  /** Resolves when the download has ended, whatever its outcome. */
  download(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}

/** How often a visible download's state is re-read, for the settle that no event announces. */
const DOWNLOAD_POLL_MS = 2000;

/**
 * The speech model's state for the offer UI: loaded once, kept live by the progress events
 * main pushes during a download, and refreshed whenever a call changes it.
 */
export function useTranscriptionStatus(): TranscriptionStatusApi {
  const [status, setStatus] = useState<TranscriptionStatus | null>(null);
  const [failures, setFailures] = useState<Record<string, ModelDownloadFailure>>({});
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const next = await window.electronAPI.getTranscriptionStatus().catch(() => UNREACHABLE);
    if (mounted.current) setStatus(next);
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const unsubscribe = window.electronAPI.onTranscriptionModelProgress((progress) => {
      setStatus((current) => {
        if (!current?.models.some((m) => m.id === progress.id)) return current;
        return {
          ...current,
          models: current.models.map((m) =>
            m.id === progress.id
              ? {
                  ...m,
                  status: {
                    state: "downloading",
                    receivedBytes: progress.receivedBytes,
                    totalBytes: progress.totalBytes,
                  },
                }
              : m,
          ),
        };
      });
    });
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, [refresh]);

  // A download started elsewhere (another mount of this hook, an earlier visit to the page) ends
  // with no event this mount hears, so while one runs the status is re-read until it settles.
  const downloading = status?.models.some((m) => m.status.state === "downloading") ?? false;
  useEffect(() => {
    if (!downloading) return;
    let inFlight = false;
    const timer = setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      // A failed background read keeps what is on screen: only the first load and a user's own
      // call may report the engine as unreachable.
      void window.electronAPI
        .getTranscriptionStatus()
        .then((next) => {
          if (mounted.current) setStatus(next);
        })
        .catch(() => {})
        .finally(() => {
          inFlight = false;
        });
    }, DOWNLOAD_POLL_MS);
    return () => clearInterval(timer);
  }, [downloading]);

  const download = useCallback(
    async (id: string) => {
      setFailures((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      // Main's first progress event can be a moment away; the button must change at once.
      setStatus((current) =>
        current
          ? {
              ...current,
              models: current.models.map((m) =>
                m.id === id
                  ? {
                      ...m,
                      status: { state: "downloading", receivedBytes: 0, totalBytes: m.sizeBytes },
                    }
                  : m,
              ),
            }
          : current,
      );
      const failure = await window.electronAPI
        .downloadTranscriptionModel(id)
        .then((result) => (result.status === "failed" ? result.code : null))
        .catch((): ModelDownloadFailure => "unknown");
      if (failure && mounted.current) setFailures((current) => ({ ...current, [id]: failure }));
      await refresh();
    },
    [refresh],
  );

  const cancel = useCallback(async (id: string) => {
    await window.electronAPI.cancelTranscriptionModelDownload(id);
  }, []);

  const remove = useCallback(
    async (id: string) => {
      await window.electronAPI.removeTranscriptionModel(id);
      await refresh();
    },
    [refresh],
  );

  return { status, failures, refresh, download, cancel, remove };
}
