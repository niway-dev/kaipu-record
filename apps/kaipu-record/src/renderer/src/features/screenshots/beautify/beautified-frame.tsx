import React from "react";
import { backgroundCss, frameRadius, shadowCss, type BeautifyState } from "./backgrounds";
import styles from "./beautified-frame.module.css";

/** The screenshot framed by the current beautify settings, with an optional
 *  overlay (the annotation layer) positioned exactly over the image. */
export function BeautifiedFrame({
  src,
  beautify,
  overlay,
}: {
  src: string;
  beautify: BeautifyState;
  overlay?: React.ReactNode;
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
      <div className={styles.shotWrap}>
        <img
          src={src}
          alt="Captura"
          className={styles.shot}
          style={{ borderRadius: `${beautify.radius}px`, boxShadow: shadowCss(beautify.shadow) }}
        />
        {overlay}
      </div>
    </div>
  );
}
