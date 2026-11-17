import React from "react";
import { useTranslations } from "@kaipu/i18n";
import { PADDING_RANGE, RADIUS_RANGE, SHADOW_RANGE } from "./backgrounds";
import { BackgroundSwatches } from "./background-swatches";
import type { BeautifyController } from "./use-beautify";
import styles from "./beautify-panel.module.css";
import { uiArea } from "@renderer/lib/ui-area";

/** The right-side "Beautify" panel: background swatches + the three sliders. */
export function BeautifyPanel({
  beautify,
  canvasMode = false,
  embedded = false,
}: {
  beautify: BeautifyController;
  /** Canvas mode (`image-canvas`): the tip explains what the export box covers (mock A2). */
  canvasMode?: boolean;
  /**
   * Inside the tabbed side panel (NIW2-714): the panel brings the width, border and padding,
   * and the "Beautify" tab names this one, so the heading is dropped.
   */
  embedded?: boolean;
}): React.JSX.Element {
  const t = useTranslations("screenshots");
  const { state, commit, beginEdit, setLive, endEdit } = beautify;

  return (
    <aside
      {...uiArea("editorImage.beautify")}
      className={`${styles.panel} ${embedded ? styles.embedded : ""}`}
    >
      {!embedded && <p className={styles.heading}>{t("beautifyHeading")}</p>}

      <p className={styles.label}>{t("background")}</p>
      <BackgroundSwatches
        value={state.bg}
        onSelect={(bg) => commit({ bg })}
        className={styles.swatchesSpacing}
      />

      <Slider
        label={t("padding")}
        suffix=" px"
        value={state.padding}
        range={PADDING_RANGE}
        onBegin={beginEdit}
        onLive={(v) => setLive({ padding: v })}
        onEnd={endEdit}
      />
      <Slider
        label={t("corners")}
        suffix=" px"
        value={state.radius}
        range={RADIUS_RANGE}
        onBegin={beginEdit}
        onLive={(v) => setLive({ radius: v })}
        onEnd={endEdit}
      />
      <Slider
        label={t("shadow")}
        suffix="%"
        value={state.shadow}
        range={SHADOW_RANGE}
        onBegin={beginEdit}
        onLive={(v) => setLive({ shadow: v })}
        onEnd={endEdit}
      />

      <p className={styles.tip}>{t(canvasMode ? "beautifyTipCanvas" : "beautifyTip")}</p>
    </aside>
  );
}

const SLIDER_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

function Slider({
  label,
  suffix,
  value,
  range,
  onBegin,
  onLive,
  onEnd,
}: {
  label: string;
  suffix: string;
  value: number;
  range: { min: number; max: number };
  onBegin: () => void;
  onLive: (value: number) => void;
  onEnd: () => void;
}): React.JSX.Element {
  return (
    <div className={styles.control}>
      <div className={styles.controlHead}>
        <span className={styles.controlLabel}>{label}</span>
        <span className={styles.controlValue}>
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        className={styles.range}
        min={range.min}
        max={range.max}
        value={value}
        onPointerDown={onBegin}
        onPointerUp={onEnd}
        onKeyDown={(e) => {
          // Only a key that moves the thumb opens an edit. Any other key (Tab, or the Undo chord)
          // would open one that no key-up on this slider closes, and an open edit blocks Undo.
          if (SLIDER_KEYS.has(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) onBegin();
        }}
        onKeyUp={(e) => {
          if (SLIDER_KEYS.has(e.key)) onEnd();
        }}
        onChange={(e) => onLive(Number(e.target.value))}
      />
    </div>
  );
}
