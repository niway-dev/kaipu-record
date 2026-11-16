import React from "react";
import { ModelOffer } from "@renderer/features/transcription/model-offer";
import { useTranscriptionStatus } from "@renderer/features/transcription/use-transcription-status";
import { uiArea } from "@renderer/lib/ui-area";

/**
 * Settings → Transcription: the speech model offer, one row for the default model and one for
 * every other model the catalog lists. When the engine cannot run here, a single row says why
 * instead of repeating it per model.
 */
export function TranscriptionSettings(): React.JSX.Element | null {
  const { status, failures, download, cancel, remove } = useTranscriptionStatus();
  if (!status) return null;

  const defaultModel = status.models.find((m) => m.id === status.defaultModelId) ?? null;
  const rows =
    status.availability.status === "unavailable"
      ? [defaultModel]
      : [defaultModel, ...status.models.filter((m) => m !== defaultModel)].filter(
          (m) => m !== null,
        );

  return (
    <>
      {rows.map((model) => (
        <ModelOffer
          key={model?.id ?? "unavailable"}
          ui={uiArea("settingsTranscription.model")}
          model={model}
          availability={status.availability}
          failure={model ? failures[model.id] : undefined}
          onDownload={() => model && void download(model.id)}
          onCancel={() => model && void cancel(model.id)}
          onRemove={() => model && void remove(model.id)}
        />
      ))}
    </>
  );
}
