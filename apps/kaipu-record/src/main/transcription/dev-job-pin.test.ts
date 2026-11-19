import { describe, expect, it, vi } from "vitest";
import type { TranscriptionJobProgress } from "@shared/types/transcription";
import { PinnedJobs } from "./dev-job-pin";

const REQUEST = { id: "clip", assetId: "asset-1", modelId: "m", durationMs: 12_000 };

function setup(pin: ConstructorParameters<typeof PinnedJobs>[0]) {
  const sent: TranscriptionJobProgress[] = [];
  const jobs = new PinnedJobs(pin, (progress) => sent.push(progress));
  return { jobs, sent };
}

const RUNNING = { kind: "running", segmentsDone: 3, segmentsTotal: 12 } as const;

describe("PinnedJobs running", () => {
  it("accepts a job and says nothing until the audio arrives", () => {
    const { jobs, sent } = setup(RUNNING);
    const begin = jobs.begin(REQUEST);
    expect(begin).toEqual({ status: "accepted", jobId: expect.any(String) });
    expect(sent).toEqual([]);
  });

  it("announces 3 of 12 transcribing once, on the first audio, for the item", () => {
    const { jobs, sent } = setup(RUNNING);
    const begin = jobs.begin(REQUEST);
    if (begin.status !== "accepted") throw new Error("not accepted");
    jobs.audio(begin.jobId);
    jobs.audio(begin.jobId);
    expect(sent).toEqual([
      {
        jobId: begin.jobId,
        id: "clip",
        phase: "transcribing",
        segmentsDone: 3,
        segmentsTotal: 12,
      },
    ]);
  });

  it("never reports done", () => {
    const { jobs, sent } = setup(RUNNING);
    const begin = jobs.begin(REQUEST);
    if (begin.status !== "accepted") throw new Error("not accepted");
    jobs.audio(begin.jobId);
    expect(sent.some((p) => p.phase === "done")).toBe(false);
  });

  it("refuses a second job as busy while one is pinned, and accepts again after a cancel", () => {
    const { jobs, sent } = setup(RUNNING);
    const first = jobs.begin(REQUEST);
    if (first.status !== "accepted") throw new Error("not accepted");
    expect(jobs.begin({ ...REQUEST, id: "other" })).toEqual({ status: "refused", reason: "busy" });
    jobs.cancel(first.jobId);
    expect(sent.at(-1)).toMatchObject({ jobId: first.jobId, id: "clip", phase: "cancelled" });
    expect(jobs.begin({ ...REQUEST, id: "other" }).status).toBe("accepted");
  });

  it("ignores a job id it did not hand out", () => {
    const { jobs, sent } = setup(RUNNING);
    jobs.begin(REQUEST);
    jobs.audio("nope");
    jobs.cancel("nope");
    expect(sent).toEqual([]);
  });
});

describe("PinnedJobs failed", () => {
  it("ends the job at once with the pinned failure on the first audio", () => {
    const { jobs, sent } = setup({ kind: "failed", failure: "engine-failed" });
    const begin = jobs.begin(REQUEST);
    if (begin.status !== "accepted") throw new Error("not accepted");
    expect(sent).toEqual([]);
    jobs.audio(begin.jobId);
    expect(sent).toEqual([
      {
        jobId: begin.jobId,
        id: "clip",
        phase: "failed",
        segmentsDone: 0,
        segmentsTotal: 0,
        failure: "engine-failed",
      },
    ]);
  });

  it("frees the engine after the failure and ignores audio still in flight", () => {
    const { jobs, sent } = setup({ kind: "failed", failure: "write-failed" });
    const begin = jobs.begin(REQUEST);
    if (begin.status !== "accepted") throw new Error("not accepted");
    jobs.audio(begin.jobId);
    const count = sent.length;
    jobs.audio(begin.jobId);
    expect(sent).toHaveLength(count);
    expect(jobs.begin(REQUEST).status).toBe("accepted");
  });

  it("announces through the callback it was given", () => {
    const broadcast = vi.fn();
    const jobs = new PinnedJobs({ kind: "failed", failure: "no-audio" }, broadcast);
    const begin = jobs.begin(REQUEST);
    if (begin.status !== "accepted") throw new Error("not accepted");
    jobs.audio(begin.jobId);
    expect(broadcast).toHaveBeenCalledTimes(1);
  });
});
