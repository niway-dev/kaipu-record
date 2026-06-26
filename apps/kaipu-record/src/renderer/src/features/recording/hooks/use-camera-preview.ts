import { useEffect, useRef, useState, type RefObject } from "react";

/** A small, square-ish preview is all the UI shows, so we cap the resolution. */
const PREVIEW_CONSTRAINTS: MediaStreamConstraints = {
  video: { facingMode: "user", width: { ideal: 320 }, height: { ideal: 240 } },
  audio: false,
};

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
    // Tear down whatever is currently open and detach it from the element.
    const releaseStream = (): void => {
      const open = streamRef.current;
      streamRef.current = null;
      if (open) for (const track of open.getTracks()) track.stop();
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    if (!enabled) {
      releaseStream();
      setHasStream(false);
      return;
    }

    // An AbortController lets us discard a stream that resolves after the effect
    // has already been cleaned up (toggle off, or unmount, mid-request).
    const controller = new AbortController();

    const open = async (): Promise<void> => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(PREVIEW_CONSTRAINTS);
        if (controller.signal.aborted) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setHasStream(true);
      } catch {
        if (!controller.signal.aborted) setHasStream(false);
      }
    };

    void open();

    return () => {
      controller.abort();
      releaseStream();
    };
  }, [enabled]);

  return { videoRef, hasStream };
}
