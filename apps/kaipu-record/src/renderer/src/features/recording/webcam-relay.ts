/**
 * The track the webcam encoder reads for the whole take, fed from whichever camera track is
 * live (ADR 0037 § camera toggled mid-take).
 *
 * mediabunny's `MediaStreamVideoTrackSource` is bound to the one track it was built with, and
 * a camera turned off mid-take must be released (its in-use light goes off), so a new camera
 * track comes back when it is turned on again. The encoder reads this relay's track instead:
 * a `MediaStreamTrackGenerator` that the current camera's frames are copied into through a
 * `MediaStreamTrackProcessor`. While no camera feeds it, it carries no frame, and mediabunny
 * (given an explicit frame rate) keeps writing its last frame on the take's clock, so the
 * webcam file never stops and every later frame stays where it belongs. The editor hides that
 * held frame (the take's `gaps`).
 *
 * Both classes are Chromium's (Insertable Streams for MediaStreamTrack) and have no DOM types
 * here; an environment without them gets no relay (`null`), and the take keeps the old rule:
 * a camera turned off ends the webcam file.
 */

interface TrackProcessor {
  readonly readable: ReadableStream<VideoFrame>;
}
interface TrackGenerator extends MediaStreamTrack {
  readonly writable: WritableStream<VideoFrame>;
}

/** The two constructors, as Chromium exposes them on `window`; injected by the tests. */
export interface WebcamRelayGlobals {
  MediaStreamTrackProcessor?: new (init: { track: MediaStreamTrack }) => TrackProcessor;
  MediaStreamTrackGenerator?: new (init: { kind: "video" }) => TrackGenerator;
}

export interface WebcamRelay {
  /** The track to encode: it lives until `stop`, whatever camera feeds it. */
  readonly track: MediaStreamTrack;
  /**
   * Copy `camera`'s frames into the relay from now on, instead of the previous camera's.
   * Resolves true once its first frame went through; false when it ended (or was cut, or
   * could not be read) before one did. The camera itself stays the caller's to stop.
   *
   * `onLost` is called, once, when the copying stops after that first frame for any reason
   * but `cut`, a later `feed` or `stop`: the camera ended, a frame could not be read or
   * written. The relay then carries no frame, so the file holds its last one: the caller
   * ends the file there.
   */
  feed(camera: MediaStreamTrack, onLost?: () => void): Promise<boolean>;
  /** Stop copying frames (the camera was turned off); the relay track goes on, empty. */
  cut(): void;
  /** End the relay track: the take, or its webcam file, is over. */
  stop(): void;
}

/** A relay, or null where this Chromium has no track processor or generator. */
export function createWebcamRelay(
  env: WebcamRelayGlobals = globalThis as unknown as WebcamRelayGlobals,
): WebcamRelay | null {
  const Processor = env.MediaStreamTrackProcessor;
  const Generator = env.MediaStreamTrackGenerator;
  if (typeof Processor !== "function" || typeof Generator !== "function") return null;
  let generator: TrackGenerator;
  let writer: WritableStreamDefaultWriter<VideoFrame>;
  try {
    generator = new Generator({ kind: "video" });
    writer = generator.writable.getWriter();
  } catch {
    return null;
  }
  /** The reader of the camera feeding the relay; a reader that is not this one stops. */
  let current: ReadableStreamDefaultReader<VideoFrame> | null = null;
  let stopped = false;

  const cut = (): void => {
    const reader = current;
    current = null;
    void reader?.cancel().catch(() => undefined);
  };

  return {
    track: generator,
    feed(camera, onLost) {
      cut();
      if (stopped) return Promise.resolve(false);
      let reader: ReadableStreamDefaultReader<VideoFrame>;
      try {
        reader = new Processor({ track: camera }).readable.getReader();
      } catch {
        return Promise.resolve(false);
      }
      current = reader;
      return new Promise<boolean>((resolve) => {
        let first = true;
        const pump = async (): Promise<void> => {
          try {
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              if (current !== reader) {
                value.close();
                break;
              }
              try {
                // The generator takes the frame over (it closes it once written).
                await writer.write(value);
              } catch (error) {
                value.close();
                throw error;
              }
              if (first) {
                first = false;
                resolve(true);
              }
            }
          } catch {
            // Cut or stopped (the read was cancelled), or the camera could not be read or the
            // frame written: told apart below.
          }
          // Still the relay's camera: the copying stopped on its own, not by cut, feed or stop.
          const lost = current === reader;
          if (lost) cut(); // a write that failed leaves the camera's stream open
          if (first) resolve(false);
          else if (lost) onLost?.();
        };
        void pump();
      });
    },
    cut,
    stop() {
      if (stopped) return;
      stopped = true;
      cut();
      void writer.close().catch(() => undefined);
      generator.stop();
    },
  };
}
