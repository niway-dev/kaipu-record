import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * The bubble is at most 480 DIP (960 px on a Retina screen) and is recorded as part of
 * the screen, so 640×480 is the ceiling worth asking for without framing; more would only
 * cost CPU. Framing asks for more lines (see `cameraCaptureLines`), 4:3 like the default.
 */
export const DEFAULT_PREVIEW_LINES = 480;

/** How long the wanted lines must stay put before the stream is reopened for them. */
const LINES_SETTLE_MS = 400;

function previewSize(lines: number): { width: { ideal: number }; height: { ideal: number } } {
  return { width: { ideal: Math.round((lines * 4) / 3) }, height: { ideal: lines } };
}

/** The chosen camera when there is one; otherwise the user-facing default. */
function previewConstraints(deviceId: string | null, lines: number): MediaStreamConstraints {
  return {
    video: deviceId
      ? { deviceId: { exact: deviceId }, ...previewSize(lines) }
      : { facingMode: "user", ...previewSize(lines) },
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
 * `lines` is the image height asked for: a change reopens the stream only once it has
 * stayed the same for a moment, so dragging a zoom slider does not restart the camera.
 */
export function useCameraPreview(
  enabled: boolean,
  deviceId: string | null = null,
  lines: number = DEFAULT_PREVIEW_LINES,
): CameraPreview {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [hasStream, setHasStream] = useState(false);
  const [settledLines, setSettledLines] = useState(lines);

  useEffect(() => {
    if (lines === settledLines) return;
    const timer = setTimeout(() => setSettledLines(lines), LINES_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [lines, settledLines]);

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
          stream = await navigator.mediaDevices.getUserMedia(
            previewConstraints(deviceId, settledLines),
          );
        } catch (error) {
          if (!deviceId || controller.signal.aborted) throw error;
          stream = await navigator.mediaDevices.getUserMedia(
            previewConstraints(null, settledLines),
          );
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
  }, [enabled, deviceId, settledLines]);

  return { videoRef, hasStream };
}
