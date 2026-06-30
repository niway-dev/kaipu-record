import React from "react";
import { backgroundCss, frameRadius, shadowCss, type BeautifyState } from "./backgrounds";
import styles from "./beautified-frame.module.css";

/** The screenshot framed by the current beautify settings, with an optional
 *  overlay (the annotation layer) positioned exactly over the image. */
export function BeautifiedFrame({
  src,
  beautify,
  overlay,
  imgRef,
  zoom = 1,
}: {
  src: string;
  beautify: BeautifyState;
  overlay?: React.ReactNode;
  imgRef?: React.Ref<HTMLImageElement>;
  /**
   * View magnification. Scales the frame visually; the annotation layer keeps
   * measuring its layout size, so annotations stay aligned at any zoom. Export
   * reads the image's layout pixels, so zoom is view-only (never bakes in).
   */
  zoom?: number;
}): React.JSX.Element {
  return (
    <div
      className={styles.frame}
      style={{
        background: backgroundCss(beautify.bg),
        padding: `${beautify.padding}px`,
        borderRadius: `${frameRadius(beautify.bg, beautify.radius)}px`,
        transform: zoom === 1 ? undefined : `scale(${zoom})`,
      }}
    >
      <div className={styles.shotWrap}>
        <img
          ref={imgRef}
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
