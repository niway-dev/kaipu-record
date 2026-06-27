import React from "react";
import { Camera } from "lucide-react";
import { useCameraPreview } from "@renderer/features/recording/hooks/use-camera-preview";
import styles from "./camera-bubble.module.css";

/**
 * Root mounted in the floating camera-bubble window (`?window=camera-bubble`).
 * Shows the live webcam in a draggable circle; the screen recording captures it
 * because the window sits on screen. Reuses the (tested) `useCameraPreview` hook.
 */
export function CameraBubble(): React.JSX.Element {
  const { videoRef, hasStream } = useCameraPreview(true);
  return (
    <div className={styles.bubble}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={styles.video}
        style={{ display: hasStream ? "block" : "none" }}
      />
      {!hasStream && <Camera size={30} className={styles.placeholder} />}
    </div>
  );
}
