import { useCallback, useEffect, useState } from "react";
import type { TranscriptionModelInfo } from "@shared/types/transcription";
import { useFlag } from "@renderer/features/analytics/use-flag";
import { useTranscriptionStatus } from "@renderer/features/transcription/use-transcription-status";
import { transcriptionOfferModel } from "./onboarding-flow";

export interface TranscriptionOffer {
  /** The model on offer: what the step describes (label, size, install folder, license). */
  model: TranscriptionModelInfo;
  /**
   * Starts the download and resolves when it ends, which can be minutes away: callers do not
   * await it. A no-op when the model is already downloading or installed.
   */
  download(): Promise<void>;
}

/**
 * Whether the onboarding offers the speech model, and the means to start its download. The
 * offer exists only with the `transcription` flag on, an engine that can run here and the
 * default model not installed (`transcriptionOfferModel`). With the flag off nothing is
 * loaded from main.
 *
 * The offer is kept once seen: starting the download turns the model into `downloading`, and
 * the step must not vanish from under the user (the dots would shift) while they move on.
 */
export function useTranscriptionOffer(): TranscriptionOffer | null {
  const enabled = useFlag("transcription");
  const { status, download } = useTranscriptionStatus({ enabled });
  const live = enabled ? transcriptionOfferModel(status) : null;
  const [kept, setKept] = useState<TranscriptionModelInfo | null>(null);
  useEffect(() => {
    if (live) setKept((current) => current ?? live);
  }, [live]);

  const model = enabled ? (kept ?? live) : null;
  const modelId = model?.id;
  const state = status?.models.find((m) => m.id === modelId)?.status.state;
  const start = useCallback(async () => {
    if (!modelId || state === "downloading" || state === "ready") return;
    await download(modelId);
  }, [modelId, state, download]);

  return model ? { model, download: start } : null;
}
