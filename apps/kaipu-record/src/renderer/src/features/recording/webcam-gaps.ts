import type { WebcamGap } from "@shared/webcam-track";

/**
 * The periods of a take with the camera turned off (ADR 0037 § camera toggled mid-take), in
 * screen ms: the webcam file holds its last frame through each, and the editor hides it there.
 * A gap opens when the camera is turned off and closes when its first frame is back in the
 * file, or when the file ends (the camera could not be opened again). One still open when the
 * take stops is a trailing gap, closed at the take's end.
 */
export class WebcamGapLog {
  private readonly gaps: WebcamGap[] = [];
  private openedAt: number | null = null;

  /** The camera was turned off at `atMs`. A gap already open stays as it was. */
  open(atMs: number): void {
    if (this.openedAt === null) this.openedAt = atMs;
  }

  /** The camera's frames are back (or the file ended) at `atMs`. No-op without an open gap. */
  close(atMs: number): void {
    if (this.openedAt === null) return;
    if (atMs > this.openedAt) this.gaps.push({ startMs: this.openedAt, endMs: atMs });
    this.openedAt = null;
  }

  /** Every gap, one still open closed at the take's end `endMs`. */
  finish(endMs: number): WebcamGap[] {
    this.close(endMs);
    return this.gaps.map((gap) => ({ ...gap }));
  }
}
