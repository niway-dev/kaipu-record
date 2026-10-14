import { useEffect, useRef, useState } from "react";
import { Share2, Video } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { formatDuration } from "@renderer/features/video-editor/components/export-sheet";
import { SizeMeter } from "@renderer/features/video-editor/components/size-meter";
import { githubFit } from "@renderer/features/video-editor/export/export-presets";
import { formatMB, percentLighter } from "@renderer/features/video-editor/export/export-size";
import { StatusCard, StatusCardActions, StatusCardButton, StatusCardText } from "./status-card";

/** How long the card stays without the pointer on it. */
export const RECORDING_SAVED_CARD_MS = 8000;

export interface RecordingSavedCardProps {
  durationSeconds: number;
  sizeBytes: number;
  /** Width × height once the file has been read; left out until then. */
  dimensions: { width: number; height: number } | null;
  /** What a Light copy would weigh; null until the file is read. */
  lightEstimateBytes: number | null;
  onShare(): void;
  onDismiss(): void;
}

/**
 * "Recording saved" (NIW2-218 export redesign): right after a recording heavier than
 * GitHub's limit, its page offers a Light copy, with the saving on a before/after bar. Hides itself after 8 s — paused while the pointer is on it — and
 * Settings → Export quality turns it off.
 */
export function RecordingSavedCard({
  durationSeconds,
  sizeBytes,
  dimensions,
  lightEstimateBytes,
  onShare,
  onDismiss,
}: RecordingSavedCardProps): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const [hovered, setHovered] = useState(false);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  useEffect(() => {
    if (hovered) return;
    const timer = setTimeout(() => onDismissRef.current(), RECORDING_SAVED_CARD_MS);
    return () => clearTimeout(timer);
  }, [hovered]);

  const lighter = percentLighter(lightEstimateBytes, sizeBytes);
  const subtitle = [
    formatDuration(durationSeconds),
    dimensions && t("presetDimensions", dimensions),
    formatMB(sizeBytes),
  ]
    .filter(Boolean)
    .join(" · ");
  const title = t("recordingSavedTitle");

  return (
    <StatusCard
      label={title}
      icon={<Video size={18} strokeWidth={1.8} />}
      title={title}
      subtitle={subtitle}
      onDismiss={onDismiss}
      dismissLabel={t("dismissCard")}
      footer={t("recordingSavedFooter")}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {lightEstimateBytes !== null && (
        <SizeMeter
          originalBytes={sizeBytes}
          resultBytes={lightEstimateBytes}
          // GitHub only when the Light copy really fits its 10 MB.
          label={
            githubFit(lightEstimateBytes) === "fits"
              ? t("recordingSavedMeter", { size: formatMB(lightEstimateBytes) })
              : t("recordingSavedMeterNoGithub", { size: formatMB(lightEstimateBytes) })
          }
        />
      )}
      <StatusCardText>
        {lighter !== null
          ? t("recordingSavedBody", { percent: lighter })
          : t("recordingSavedBodyNoEstimate")}
      </StatusCardText>
      <StatusCardActions>
        <StatusCardButton
          variant="primary"
          onClick={() => {
            onDismiss();
            onShare();
          }}
        >
          <Share2 size={15} strokeWidth={1.8} />
          {t("recordingSavedShare")}
        </StatusCardButton>
      </StatusCardActions>
    </StatusCard>
  );
}
