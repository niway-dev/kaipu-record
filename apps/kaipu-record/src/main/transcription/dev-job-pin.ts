import type {
  TranscriptionBeginResult,
  TranscriptionJobProgress,
  TranscriptionJobRequest,
} from "@shared/types/transcription";
import type { TranscriptionJobPin } from "./dev-override";

/**
 * The job half of the `KAIPU_TRANSCRIPTION` dev override, for the UI state catalog (unpackaged
 * builds only: `resolveTranscriptionOverride` returns null in a packaged app, so this class is
 * never built there).
 *
 * It stands in for `TranscriptionService` so a shot can show a job that is running or has
 * failed without an engine or a speech model. The renderer is untouched and runs its real flow:
 * it asks to begin, decodes the recording's audio and streams it, and listens for progress. This
 * answers the same IPC calls:
 *
 * - `begin` accepts (one job at a time, like the service);
 * - the first audio chunk, or the end of the audio, makes it announce the pinned progress once:
 *   `running` stays at `segmentsDone` of `segmentsTotal` while transcribing, and `failed` ends
 *   at once with the pinned failure. The announcement waits for the audio because the renderer
 *   attaches its progress listener before it sends the first chunk, never before;
 * - `cancel` ends a running job with `cancelled`, which is how the catalog puts it away.
 *
 * Nothing is written to the vault and no `done` is ever announced, so no transcript appears.
 */
export class PinnedJobs {
  private nextId = 1;
  private job: { jobId: string; itemId: string; announced: boolean } | null = null;

  constructor(
    private readonly pin: TranscriptionJobPin,
    private readonly broadcast: (progress: TranscriptionJobProgress) => void,
  ) {}

  begin(request: TranscriptionJobRequest): TranscriptionBeginResult {
    if (this.job) return { status: "refused", reason: "busy" };
    const jobId = `pinned-${this.nextId++}`;
    this.job = { jobId, itemId: request.id, announced: false };
    return { status: "accepted", jobId };
  }

  /** The first chunk, or the end of the audio, whichever comes first. */
  audio(jobId: string): void {
    const job = this.job;
    if (!job || job.jobId !== jobId || job.announced) return;
    job.announced = true;
    if (this.pin.kind === "running") {
      this.broadcast({
        jobId,
        id: job.itemId,
        phase: "transcribing",
        segmentsDone: this.pin.segmentsDone,
        segmentsTotal: this.pin.segmentsTotal,
      });
      return;
    }
    this.job = null;
    this.broadcast({
      jobId,
      id: job.itemId,
      phase: "failed",
      segmentsDone: 0,
      segmentsTotal: 0,
      failure: this.pin.failure,
    });
  }

  cancel(jobId: string): void {
    const job = this.job;
    if (!job || job.jobId !== jobId) return;
    this.job = null;
    this.broadcast({
      jobId,
      id: job.itemId,
      phase: "cancelled",
      segmentsDone: this.pin.kind === "running" ? this.pin.segmentsDone : 0,
      segmentsTotal: this.pin.kind === "running" ? this.pin.segmentsTotal : 0,
    });
  }
}
