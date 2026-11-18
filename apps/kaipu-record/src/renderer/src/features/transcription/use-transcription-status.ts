import { useMemo, useSyncExternalStore } from "react";
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

export interface TranscriptionStatusOptions {
  /**
   * `false` keeps the hook idle: no IPC call and no progress listener, `status` stays `null`.
   * For a host that shows the offer only behind the `transcription` flag and must not wake
   * the engine's status check with the flag off. Default `true`.
   */
  enabled?: boolean;
}

interface StoreSnapshot {
  status: TranscriptionStatus | null;
  failures: Readonly<Record<string, ModelDownloadFailure>>;
}

const IDLE: StoreSnapshot = { status: null, failures: {} };

// One store for every consumer: a Library of 200 cards must cost one status read, one progress
// listener and one download poller, and a download started by any consumer must show in all.
let snapshot: StoreSnapshot = IDLE;
const listeners = new Set<() => void>();
let stopProgress: (() => void) | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollInFlight = false;
/** Bumped whenever the store goes idle, so a call that started before that cannot write after it. */
let generation = 0;

function publish(next: StoreSnapshot): void {
  snapshot = next;
  syncPoll();
  for (const listener of listeners) listener();
}

function setStatus(update: (current: TranscriptionStatus | null) => TranscriptionStatus | null) {
  const next = update(snapshot.status);
  if (next !== snapshot.status) publish({ ...snapshot, status: next });
}

function isDownloading(status: TranscriptionStatus | null): boolean {
  return status?.models.some((m) => m.status.state === "downloading") ?? false;
}

// A download started elsewhere (an earlier visit to the page, another window) ends with no event
// this store hears, so while one runs the status is re-read until it settles.
function syncPoll(): void {
  const wanted = listeners.size > 0 && isDownloading(snapshot.status);
  if (wanted && pollTimer === null) {
    const owner = generation;
    pollTimer = setInterval(() => {
      if (pollInFlight) return;
      pollInFlight = true;
      // A failed background read keeps what is on screen: only the first load and a user's own
      // call may report the engine as unreachable.
      void window.electronAPI
        .getTranscriptionStatus()
        .then((next) => {
          if (owner === generation) setStatus(() => next);
        })
        .catch(() => {})
        .finally(() => {
          // `stop()` already reset the gate; a poll that outlived it must not reopen it for the
          // poll that replaced it.
          if (owner === generation) pollInFlight = false;
        });
    }, DOWNLOAD_POLL_MS);
  } else if (!wanted && pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/**
 * Re-reads the model status for every consumer. Anything that learns the status changed behind
 * the store's back (main refusing a job because the model is gone) calls this; with no consumer
 * mounted it does nothing.
 */
export async function refreshTranscriptionStatus(): Promise<void> {
  await refresh();
}

async function refresh(): Promise<void> {
  const owner = generation;
  const next = await window.electronAPI.getTranscriptionStatus().catch(() => UNREACHABLE);
  if (owner === generation && listeners.size > 0) setStatus(() => next);
}

function start(): void {
  void refresh();
  stopProgress = window.electronAPI.onTranscriptionModelProgress((progress) => {
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
}

function stop(): void {
  generation += 1;
  stopProgress?.();
  stopProgress = null;
  if (pollTimer !== null) clearInterval(pollTimer);
  pollTimer = null;
  pollInFlight = false;
  snapshot = IDLE;
}

function subscribeToStatus(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) start();
  return () => {
    // Already gone (the store was reset under it): nothing to release.
    if (!listeners.delete(listener)) return;
    if (listeners.size === 0) stop();
  };
}

function subscribeIdle(): () => void {
  return () => {};
}

const getSnapshot = (): StoreSnapshot => snapshot;
const getIdleSnapshot = (): StoreSnapshot => IDLE;

async function download(id: string): Promise<void> {
  const owner = generation;
  const live = (): boolean => owner === generation && listeners.size > 0;
  const { [id]: _cleared, ...rest } = snapshot.failures;
  // Main's first progress event can be a moment away; every button must change at once.
  publish({
    failures: rest,
    status: snapshot.status && {
      ...snapshot.status,
      models: snapshot.status.models.map((m) =>
        m.id === id
          ? { ...m, status: { state: "downloading", receivedBytes: 0, totalBytes: m.sizeBytes } }
          : m,
      ),
    },
  });
  const failure = await window.electronAPI
    .downloadTranscriptionModel(id)
    .then((result) => (result.status === "failed" ? result.code : null))
    .catch((): ModelDownloadFailure => "unknown");
  if (failure && live())
    publish({ ...snapshot, failures: { ...snapshot.failures, [id]: failure } });
  await refresh();
}

// A rejected IPC call is swallowed, not left as an unhandled rejection. Remove then re-reads the
// state, so a model that is still on disk keeps showing as installed.
async function cancel(id: string): Promise<void> {
  await window.electronAPI.cancelTranscriptionModelDownload(id).catch(() => {});
}

async function remove(id: string): Promise<void> {
  await window.electronAPI.removeTranscriptionModel(id).catch(() => {});
  await refresh();
}

/** Test seam: drops the shared status, the failures, every subscriber and the poller. */
export function resetTranscriptionStatusStore(): void {
  listeners.clear();
  stop();
}

/**
 * The speech model's state for the offer UI, shared by every consumer: loaded once when the first
 * one subscribes, kept live by the progress events main pushes during a download, and refreshed
 * whenever a call changes it.
 */
export function useTranscriptionStatus({
  enabled = true,
}: TranscriptionStatusOptions = {}): TranscriptionStatusApi {
  const current = useSyncExternalStore(
    enabled ? subscribeToStatus : subscribeIdle,
    enabled ? getSnapshot : getIdleSnapshot,
  );
  return useMemo(
    () => ({
      status: current.status,
      failures: current.failures,
      refresh,
      download,
      cancel,
      remove,
    }),
    [current],
  );
}
