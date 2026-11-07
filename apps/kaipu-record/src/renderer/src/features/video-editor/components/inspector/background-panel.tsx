/**
 * The inspector's Background section with nothing selected (NIW2-668, ADR 0051): the screenshot
 * editor's nine swatches and its padding, corners and shadow sliders, now around the video's
 * picture in the preview, the MP4 and the GIF. The swatches are the screenshot editor's own
 * component; the sliders are the video inspector's `HistorySlider`, so a drag is one undo step.
 * While the preset is `none` nothing is drawn around the picture, so the sliders are disabled
 * rather than moving without a visible change.
 */
import { useTranslations } from "@kaipu/i18n";
import {
  PADDING_RANGE,
  RADIUS_RANGE,
  SHADOW_RANGE,
} from "@renderer/features/screenshots/beautify/backgrounds";
import { BackgroundSwatches } from "@renderer/features/screenshots/beautify/background-swatches";
import { uiArea } from "@renderer/lib/ui-area";
import type { BackgroundEditing } from "../../use-background-editing";
import { HistorySlider } from "../history-slider";
import styles from "./inspector.module.css";

export function BackgroundPanel({ edits }: { edits: BackgroundEditing }): React.JSX.Element {
  const t = useTranslations("videoEditor");
  // The names the screenshot editor already has, through its own namespace.
  const s = useTranslations("screenshots");
  const { background } = edits;
  const off = background.bg === "none";
  return (
    <section
      {...uiArea("editorVideo.background")}
      className={styles.section}
      aria-label={t("backgroundTitle")}
    >
      <h2 className={styles.title}>{t("backgroundTitle")}</h2>
      <BackgroundSwatches value={background.bg} onSelect={edits.choose} />
      <HistorySlider
        label={s("padding")}
        value={background.padding}
        min={PADDING_RANGE.min}
        max={PADDING_RANGE.max}
        step={1}
        format={(value) => `${value} px`}
        disabled={off}
        onBegin={edits.begin}
        onLive={(value) => edits.live({ padding: value })}
        onEnd={edits.end}
        onCommit={(value) => edits.commit({ padding: value })}
      />
      <HistorySlider
        label={s("corners")}
        value={background.radius}
        min={RADIUS_RANGE.min}
        max={RADIUS_RANGE.max}
        step={1}
        format={(value) => `${value} px`}
        disabled={off}
        onBegin={edits.begin}
        onLive={(value) => edits.live({ radius: value })}
        onEnd={edits.end}
        onCommit={(value) => edits.commit({ radius: value })}
      />
      <HistorySlider
        label={s("shadow")}
        value={background.shadow}
        min={SHADOW_RANGE.min}
        max={SHADOW_RANGE.max}
        step={1}
        format={(value) => `${value}%`}
        disabled={off}
        onBegin={edits.begin}
        onLive={(value) => edits.live({ shadow: value })}
        onEnd={edits.end}
        onCommit={(value) => edits.commit({ shadow: value })}
      />
      <p className={styles.note}>{off ? t("backgroundHint") : t("backgroundNote")}</p>
    </section>
  );
}
