import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * The bubble is at most 480 DIP (960 px on a Retina screen) and is recorded as part of
 * the screen, so 640×480 is the ceiling worth asking for; more would only cost CPU.
 */
const PREVIEW_SIZE = { width: { ideal: 640 }, height: { ideal: 480 } };

/** The chosen camera when there is one; otherwise the user-facing default. */
function previewConstraints(deviceId: string | null): MediaStreamConstraints {
  return {
    video: deviceId
      ? { deviceId: { exact: deviceId }, ...PREVIEW_SIZE }
      : { facingMode: "user", ...PREVIEW_SIZE },
    audio: false,
  };
}

export interface CameraPreview {
  videoRef: RefObject<HTMLVideoElement | null>;
  hasStream: boolean;
}

/**
 * Opens a live camera stream while `enabled` and wires it to a <video> ref.
 * Stops all tracks when disabled or on unmount so the camera light turns off.
 * A `deviceId` change reopens the stream on that camera; a device that is gone
 * (unplugged since it was picked) falls back to the default camera.
 */
export function useCameraPreview(enabled: boolean, deviceId: string | null = null): CameraPreview {
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
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia(previewConstraints(deviceId));
        } catch (error) {
          if (!deviceId || controller.signal.aborted) throw error;
          stream = await navigator.mediaDevices.getUserMedia(previewConstraints(null));
        }
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
  }, [enabled, deviceId]);

  return { videoRef, hasStream };
}
