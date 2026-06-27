import React, { type RefObject } from "react";
import { Camera } from "lucide-react";
import styles from "./webcam-preview.module.css";

interface WebcamPreviewProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  hasStream: boolean;
}

/** Dumb camera preview. The live stream is managed by `useCameraPreview`. */
export function WebcamPreview({ videoRef, hasStream }: WebcamPreviewProps): React.JSX.Element {
  return (
    <div className={styles.preview}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={styles.video}
        style={{ display: hasStream ? "block" : "none" }}
      />
      {!hasStream && <Camera size={20} className={styles.icon} />}
    </div>
  );
}
