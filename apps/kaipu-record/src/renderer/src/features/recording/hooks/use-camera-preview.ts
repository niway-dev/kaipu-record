import { useEffect, useRef, useState, type RefObject } from "react";

export interface CameraPreview {
  videoRef: RefObject<HTMLVideoElement | null>;
  hasStream: boolean;
}

/**
 * Opens a live camera stream while `enabled` and wires it to a <video> ref.
 * Stops all tracks when disabled or on unmount so the camera light turns off.
 */
export function useCameraPreview(enabled: boolean): CameraPreview {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [hasStream, setHasStream] = useState(false);

  useEffect(() => {
    if (!enabled) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setHasStream(false);
      return;
    }

    let active = true;
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: "user", width: { ideal: 320 }, height: { ideal: 240 } },
        audio: false,
      })
      .then((stream) => {
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setHasStream(true);
      })
      .catch(() => {
        if (active) setHasStream(false);
      });

    return () => {
      active = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [enabled]);

  return { videoRef, hasStream };
}
