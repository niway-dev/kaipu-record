import React from "react";
import { useTranslations } from "@kaipu/i18n";
import {
  BACKGROUNDS,
  backgroundCss,
  PADDING_RANGE,
  RADIUS_RANGE,
  SHADOW_RANGE,
} from "./backgrounds";
import type { BeautifyController } from "./use-beautify";
import styles from "./beautify-panel.module.css";

/** The right-side "Beautify" panel: background swatches + the three sliders. */
export function BeautifyPanel({ beautify }: { beautify: BeautifyController }): React.JSX.Element {
  const t = useTranslations("screenshots");
  const { state, commit, beginEdit, setLive, endEdit } = beautify;

  return (
    <aside className={styles.panel}>
      <p className={styles.heading}>{t("beautifyHeading")}</p>

      <p className={styles.label}>{t("background")}</p>
      <div className={styles.swatches}>
        {BACKGROUNDS.map((bg) => (
          <button
            key={bg.id}
            type="button"
            title={t(bg.nameKey)}
            aria-label={t(bg.nameKey)}
            className={`${styles.swatch} ${state.bg === bg.id ? styles.selected : ""}`}
            style={{ background: backgroundCss(bg.id) }}
            onClick={() => commit({ bg: bg.id })}
          />
        ))}
      </div>

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

      <p className={styles.tip}>{t("beautifyTip")}</p>
    </aside>
  );
}

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
        onKeyDown={onBegin}
        onKeyUp={onEnd}
        onChange={(e) => onLive(Number(e.target.value))}
      />
    </div>
  );
}
