/**
 * Whether the camera bubble may leave the screen capture right now (ADR 0032).
 *
 * Protecting the bubble only makes sense while its face is recorded somewhere else: in the
 * active take's webcam file. A take that records no webcam file (the camera was off when it
 * started, its camera did not open, or its webcam file ended mid-take) must keep the bubble
 * in the screen recording, or the face is in neither file. So the bubble is protected when no
 * take is active (the next take's protection is decided before its screen capture starts) or
 * when the active take records a live webcam file; it is left in the capture otherwise.
 *
 * Main sees the take through its writer sessions: the screen session opens the take (with no
 * webcam yet), the webcam session gives it one, `webcamEnded` (the renderer's report, or a
 * webcam session that could not be created) takes it away, and finalize, abort or a forced
 * reset end it. Only the newest take counts: a start discarded during the countdown is aborted
 * after its replacement was created, and never records.
 */
export class BubbleProtection {
  private take: { id: string; webcam: boolean } | null = null;

  /** The take's screen session was created: a take is active, with no webcam file yet. */
  screenCreated(sessionId: string): void {
    this.take = { id: sessionId, webcam: false };
  }

  /** The take's webcam session is being created: the take records the face itself. */
  webcamCreated(sessionId: string): void {
    if (this.take?.id === sessionId) this.take.webcam = true;
  }

  /** The take records no (more) webcam: it never opened, could not be created, or ended. */
  webcamEnded(sessionId: string): void {
    if (this.take?.id === sessionId) this.take.webcam = false;
  }

  /** The take was finalized or aborted. */
  ended(sessionId: string): void {
    if (this.take?.id === sessionId) this.take = null;
  }

  /** Every take was dropped (a forced reset). */
  reset(): void {
    this.take = null;
  }

  /**
   * Whether the active take records the face in a live webcam file: a camera turned off then
   * parks the bubble rather than destroying it, and the file goes on through the gap.
   */
  recordsWebcam(): boolean {
    return this.take?.webcam === true;
  }

  /** Whether the bubble should be content-protected now. */
  protects(): boolean {
    return this.take === null || this.take.webcam;
  }
}
