import { useMemo, useState, type MouseEvent } from "react";
import { useLocale, useTranslations } from "@kaipu/i18n";
import { Button, ModalOverlay } from "@kaipu/ui";
import { absoluteDate, formatDuration } from "@renderer/features/library/format";
import { LibraryPicker, useLibraryPicker } from "@renderer/features/library/picker";
import type { LibraryVideo } from "@renderer/features/library/types";
import { resolutionLabel } from "@renderer/features/video-editor/add-from-library";
import { formatMB } from "@renderer/features/video-editor/export/export-size";
import type { UiAreaProps } from "@renderer/lib/ui-area";
import { exportableVideos } from "./exportable-videos";
import styles from "./pick-video-modal.module.css";

const TITLE_ID = "pick-video-title";

export interface PickVideoModalProps {
  videos: readonly LibraryVideo[];
  /** The video on screen: selected when the modal opens and marked "Exporting now". */
  currentAssetId?: string;
  /** `uiArea(...)` of the screen that opens it, spread on the sheet. */
  area: UiAreaProps;
  /** Export this video: the footer button, and a double click on a row. */
  onPick(video: LibraryVideo): void;
  /** Escape, Cancel, ✕ or a click outside: nothing changes. */
  onClose(): void;
}

/**
 * "Pick from Library" and "Change video": the Library's originals in a modal, a list on the left
 * and a muted quick look on the right, like the editor's Add from Library. It is a
 * `LibraryPicker` with Export's parts: the originals only (`exportableVideos`, no screenshots),
 * a "Exporting now" badge on the video on screen, and Cancel / Export this video in the footer.
 */
export function PickVideoModal({
  videos,
  currentAssetId,
  area,
  onPick,
  onClose,
}: PickVideoModalProps): React.JSX.Element {
  const t = useTranslations("export");
  const locale = useLocale();
  const items = useMemo(() => exportableVideos(videos), [videos]);
  return (
    <ModalOverlay onCancel={onClose} labelledBy={TITLE_ID} size="xwide">
      <LibraryPicker
        {...area}
        data-testid="pick-video-modal"
        testIdPrefix="pick-video"
        items={items}
        // The video on screen starts selected; with none (or one that is not listed) the first
        // row stands in.
        defaultSelectedId={currentAssetId ?? null}
        onActivate={onPick}
      >
        <LibraryPicker.Header title={t("pickVideoTitle")} titleId={TITLE_ID}>
          <LibraryPicker.Search placeholder={t("pickVideoSearch")} />
          <LibraryPicker.Close label={t("pickVideoClose")} onClick={onClose} />
        </LibraryPicker.Header>
        <LibraryPicker.Body
          empty={<LibraryPicker.Note>{t("pickerEmpty")}</LibraryPicker.Note>}
          noMatch={(query) => (
            <LibraryPicker.Note
              title={t("pickVideoNoMatch", { query })}
              hint={t("pickVideoNoMatchHint")}
            />
          )}
        >
          <LibraryPicker.List
            label={t("pickVideoList")}
            renderRow={(video) => (
              <LibraryPicker.Row
                item={video}
                badge={video.assetId === currentAssetId ? t("pickVideoCurrent") : undefined}
                meta={[
                  formatDuration(video.durationSeconds),
                  formatMB(video.fileSizeBytes),
                  resolutionLabel(video),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            )}
          />
          <LibraryPicker.Preview durationBadge={false} showTime>
            {(video) => <Facts video={video} locale={locale} />}
          </LibraryPicker.Preview>
        </LibraryPicker.Body>
        <LibraryPicker.Footer>
          <Button variant="outline" onClick={onClose}>
            {t("pickVideoCancel")}
          </Button>
          <ExportThisVideo onPick={onPick} />
        </LibraryPicker.Footer>
      </LibraryPicker>
    </ModalOverlay>
  );
}

/** Recorded, size and resolution of the selected video, under the scrub bar. */
function Facts({ video, locale }: { video: LibraryVideo; locale: string }): React.JSX.Element {
  const t = useTranslations("export");
  const resolution = resolutionLabel(video);
  const facts: [string, string][] = [
    [t("pickVideoRecorded"), absoluteDate(video.createdAt, locale)],
    [t("pickVideoSize"), formatMB(video.fileSizeBytes)],
    ...(resolution ? ([[t("pickVideoResolution"), resolution]] as [string, string][]) : []),
  ];
  return (
    <dl className={styles.facts} data-testid="pick-video-facts">
      {facts.map(([label, value]) => (
        <div key={label} className={styles.fact}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The primary button: it needs the picker's selection, so it is a part of the root. */
function ExportThisVideo({ onPick }: { onPick(video: LibraryVideo): void }): React.JSX.Element {
  const t = useTranslations("export");
  const { selected } = useLibraryPicker();
  return (
    <Button variant="primary" disabled={!selected} onClick={() => selected && onPick(selected)}>
      {t("pickVideoConfirm")}
    </Button>
  );
}

/**
 * The state both buttons share: `onOpen` goes on the trigger, `modal` is rendered next to it.
 * Closing, with or without a pick, puts focus back on the button that opened it.
 */
export function usePickVideoModal(props: Omit<PickVideoModalProps, "onClose">): {
  onOpen(event: MouseEvent<HTMLElement>): void;
  modal: React.JSX.Element | null;
} {
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const { onPick } = props;
  // Every close, a pick included, hands focus back to the trigger if it is still in the document.
  // When a pick then replaces the screen and unmounts the trigger, focus falls to the body.
  const close = (): void => {
    if (opener?.isConnected) opener.focus();
    setOpener(null);
  };
  return {
    onOpen: (event) => setOpener(event.currentTarget),
    modal: opener ? (
      <PickVideoModal
        {...props}
        onPick={(video) => {
          close();
          onPick(video);
        }}
        onClose={close}
      />
    ) : null,
  };
}
