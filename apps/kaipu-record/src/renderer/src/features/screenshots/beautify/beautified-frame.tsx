import React from "react";
import { backgroundCss, frameRadius, shadowCss, type BeautifyState } from "./backgrounds";
import styles from "./beautified-frame.module.css";

/** The screenshot framed by the current beautify settings (live preview). */
export function BeautifiedFrame({
  src,
  beautify,
}: {
  src: string;
  beautify: BeautifyState;
}): React.JSX.Element {
  return (
    <div
      className={styles.frame}
      style={{
        background: backgroundCss(beautify.bg),
        padding: `${beautify.padding}px`,
        borderRadius: `${frameRadius(beautify.bg, beautify.radius)}px`,
      }}
    >
      <img
        src={src}
        alt="Captura"
        className={styles.shot}
        style={{ borderRadius: `${beautify.radius}px`, boxShadow: shadowCss(beautify.shadow) }}
      />
    </div>
  );
}
