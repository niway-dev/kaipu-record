import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AudioSample } from "mediabunny";
import { describe, expect, it, vi } from "vitest";
import type { AudioEdits } from "../audio-edits";
import { AUDIO_LEAD_SECONDS, createAudioPump, type AudioPumpOptions } from "./audio-pump";
import type { RenderSegment } from "./export-plan";

/**
 * NIW2-806: the audio is produced in step with the video instead of after it. The point of
 * these tests is that only WHEN each sample is produced changed: the sequence handed to the
 * audio source (timestamp, duration, size, format and the data itself) is the same either way.
 */

const REFERENCE = { sourceId: null, sampleRate: 48000, channels: 2 };
const BLOCK_FRAMES = 1024; // what a decoder yields per sample
const FPS = 30;

/** What the sink saw of one sample; the data is hashed. */
interface Captured {
  timestamp: number;
  duration: number;
  numberOfFrames: number;
  numberOfChannels: number;
  sampleRate: number;
  hash: string;
}

const capture = (sample: AudioSample): Captured => {
  const data = new Float32Array(sample.numberOfFrames * sample.numberOfChannels);
  sample.copyTo(data, { planeIndex: 0, format: "f32" });
  return {
    timestamp: sample.timestamp,
    duration: sample.duration,
    numberOfFrames: sample.numberOfFrames,
    numberOfChannels: sample.numberOfChannels,
    sampleRate: sample.sampleRate,
    hash: createHash("sha256").update(new Uint8Array(data.buffer)).digest("hex"),
  };
};

/**
 * A decoder over a file of `rate` Hz and `channels` channels whose signal is never zero, so a
 * muted span shows. Like mediabunny's sink it yields whole blocks: the one holding `start`
 * (pre-roll included) up to the first starting at or after `end`.
 */
function fileReader(rate: number, channels: number) {
  return {
    samples(start: number, end: number): AsyncIterable<AudioSample> {
      return (async function* () {
        for (let block = Math.floor((start * rate) / BLOCK_FRAMES); ; block++) {
          const first = block * BLOCK_FRAMES;
          if (first / rate >= end) return;
          const data = new Float32Array(BLOCK_FRAMES * channels);
          for (let f = 0; f < BLOCK_FRAMES; f++) {
            for (let c = 0; c < channels; c++) {
              data[f * channels + c] = Math.sin((first + f) * 0.013 + c) * 0.5 + 0.001 * (c + 1);
            }
          }
          yield new AudioSample({
            data,
            format: "f32",
            numberOfChannels: channels,
            sampleRate: rate,
            timestamp: first / rate,
          });
        }
      })();
    },
  };
}

const clip = (
  timelineStart: number,
  sourceStart: number,
  sourceEnd: number,
  sourceId: string | null = null,
): RenderSegment => ({
  kind: "clip",
  timelineStart,
  duration: sourceEnd - sourceStart,
  sourceStart,
  sourceEnd,
  sourceId,
});

/**
 * A representative timeline, 9.4 s on the output axis:
 *   0.0  clip of the opened recording, cut 0.37..2.87, with a muted span inside
 *   2.5  clip of the same recording after a cut (4.1..5.1)
 *   3.5  a slide of 2.4 s (silence in three pieces)
 *   5.9  a clip of joined recording "nosound", whose file has no audio (silence by plan)
 *   7.9  a clip of joined recording "mono44", 44.1 kHz mono: resampled and mapped to stereo
 */
function fixture() {
  const segments: RenderSegment[] = [
    clip(0, 0.37, 2.87),
    clip(2.5, 4.1, 5.1),
    { kind: "slide", timelineStart: 3.5, duration: 2.4, assetId: "slide" },
    clip(5.9, 200, 202, "nosound"),
    clip(7.9, 100.5, 102, "mono44"),
  ];
  const perSegment: ("decode" | "silence")[] = ["decode", "decode", "silence", "silence", "decode"];
  const edits: AudioEdits = {
    audioMuted: false,
    mutedRanges: [
      { id: "a", sourceStart: 1.0, sourceEnd: 1.3 },
      { id: "b", sourceStart: 100.9, sourceEnd: 101.1 },
    ],
  };
  const totalDuration = 9.4;
  return { segments, perSegment, edits, totalDuration };
}

function run(options: { downmix?: boolean } = {}) {
  const { segments, perSegment, edits, totalDuration } = fixture();
  const samples: Captured[] = [];
  const log: string[] = [];
  const closed = vi.fn(() => log.push("close"));
  const pumpOptions: AudioPumpOptions = {
    segments,
    perSegment,
    edits,
    joined: [
      { sourceId: "nosound", offset: 200 },
      { sourceId: "mono44", offset: 100 },
    ],
    readers: new Map([
      [null, fileReader(48000, 2)],
      ["mono44", fileReader(44100, 1)],
    ]),
    reference: REFERENCE,
    silenceSampleRate: 48000,
    silenceChannelCount: options.downmix ? 1 : 2,
    downmix: options.downmix ?? false,
    sink: {
      add: async (sample) => {
        samples.push(capture(sample));
        log.push("audio");
      },
      close: closed,
    },
  };
  return { pump: createAudioPump(pumpOptions), samples, log, closed, totalDuration };
}

/** The old order: no video at all, the whole audio produced in one go. */
async function allAtOnce(options?: { downmix?: boolean }) {
  const r = run(options);
  await r.pump.drain();
  return r;
}

/** The new order: audio asked for ahead of every video frame, the rest drained at the end. */
async function interleaved(options?: { downmix?: boolean }) {
  const r = run(options);
  const videoAdds: { t: number; cursor: number; done: boolean }[] = [];
  const frames = Math.floor(r.totalDuration * FPS);
  for (let i = 0; i < frames; i++) {
    const t = i / FPS;
    await r.pump.advanceTo(t + AUDIO_LEAD_SECONDS);
    videoAdds.push({ t, cursor: r.pump.cursor, done: r.pump.done });
    r.log.push("video");
  }
  await r.pump.drain();
  return { ...r, videoAdds };
}

describe("createAudioPump: the same samples in either order", () => {
  it("hands the audio source an identical sequence when it is interleaved with the video", async () => {
    const old = await allAtOnce();
    const next = await interleaved();
    expect(old.samples.length).toBeGreaterThan(200);
    expect(next.samples).toEqual(old.samples);
  });

  it("does the same with the mono downmix of the Light preset", async () => {
    const old = await allAtOnce({ downmix: true });
    const next = await interleaved({ downmix: true });
    expect(next.samples).toEqual(old.samples);
  });

  it("keeps the cursor contiguous from 0 and the whole timeline's length", async () => {
    const { samples, totalDuration } = await interleaved();
    let expected = 0;
    for (const s of samples) {
      expect(s.timestamp).toBeCloseTo(expected, 9);
      expected += s.duration;
    }
    // Within one decoder block of the timeline: sample rounding, not drift.
    expect(Math.abs(expected - totalDuration)).toBeLessThan(BLOCK_FRAMES / 44100);
  });

  it("covers every case of the fixture: silence in pieces, zeroed spans and a resampled clip", async () => {
    const { samples } = await allAtOnce();
    const silentHash = (frames: number, channels: number) =>
      createHash("sha256")
        .update(new Uint8Array(new Float32Array(frames * channels).buffer))
        .digest("hex");
    // The slide: 2.4 s in 1 s pieces (48000, 48000, 19200 frames), all zero.
    const slidePieces = samples.filter(
      (s) => s.numberOfFrames === 48000 || s.numberOfFrames === 19200,
    );
    expect(slidePieces.map((s) => s.numberOfFrames)).toEqual([48000, 48000, 19200, 48000, 48000]);
    for (const s of slidePieces) expect(s.hash).toBe(silentHash(s.numberOfFrames, 2));
    // The muted span of the first clip leaves some all-zero blocks among sounding ones.
    const zeroBlocks = samples.filter((s) => s.hash === silentHash(s.numberOfFrames, 2));
    expect(zeroBlocks.length).toBeGreaterThan(slidePieces.length);
    // The mono 44.1 kHz clip arrives in the reference format.
    expect(samples.every((s) => s.sampleRate === 48000 && s.numberOfChannels === 2)).toBe(true);
  });
});

describe("createAudioPump: interleaving", () => {
  it("has the audio reach each video frame, and no further than the lead plus one sample", async () => {
    const { videoAdds, samples } = await interleaved();
    const widest = Math.max(...samples.map((s) => s.duration));
    expect(videoAdds.length).toBeGreaterThan(200);
    for (const add of videoAdds) {
      // The audio already added covers this frame, unless the audio timeline had ended.
      if (!add.done) expect(add.cursor).toBeGreaterThanOrEqual(add.t);
      // And it never ran further ahead than the lead allows.
      expect(add.cursor).toBeLessThanOrEqual(add.t + AUDIO_LEAD_SECONDS + widest + 1e-9);
    }
  });

  it("does not produce the audio ahead of the video (the first frame sees about one second)", async () => {
    const { videoAdds, totalDuration } = await interleaved();
    expect(videoAdds[0]!.cursor).toBeLessThan(AUDIO_LEAD_SECONDS + 1.01);
    expect(videoAdds[0]!.cursor).toBeLessThan(totalDuration / 2);
  });

  it("alternates audio and video adds instead of putting all of one first", async () => {
    const { log } = await interleaved();
    const firstAudioAfterVideo = log.indexOf("audio", log.indexOf("video"));
    const lastVideo = log.lastIndexOf("video");
    // Audio is still being added after the first video frame and before the last one.
    expect(firstAudioAfterVideo).toBeGreaterThan(-1);
    expect(firstAudioAfterVideo).toBeLessThan(lastVideo);
    const videoBeforeLastAudio = log
      .slice(0, log.lastIndexOf("audio"))
      .filter((e) => e === "video");
    expect(videoBeforeLastAudio.length).toBeGreaterThan(100);
  });

  it("closes the audio source once, when the timeline ends, and not before", async () => {
    const { pump, closed } = run();
    await pump.advanceTo(2);
    expect(closed).not.toHaveBeenCalled();
    await pump.drain();
    await pump.drain();
    await pump.advanceTo(Infinity);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(pump.done).toBe(true);
  });

  it("leaves the decoder of a clip in progress to dispose()", async () => {
    const returned = vi.fn();
    const reader = {
      samples: (): AsyncIterable<AudioSample> => ({
        [Symbol.asyncIterator]: () => ({
          next: async () => ({
            done: false as const,
            value: new AudioSample({
              data: new Float32Array(BLOCK_FRAMES * 2),
              format: "f32",
              numberOfChannels: 2,
              sampleRate: 48000,
              timestamp: 0,
            }),
          }),
          return: async () => {
            returned();
            return { done: true as const, value: undefined };
          },
        }),
      }),
    };
    const pump = createAudioPump({
      segments: [clip(0, 0, 10)],
      perSegment: ["decode"],
      edits: { audioMuted: false, mutedRanges: [] },
      joined: [],
      readers: new Map([[null, reader]]),
      reference: REFERENCE,
      silenceSampleRate: 48000,
      silenceChannelCount: 2,
      downmix: false,
      sink: { add: async () => {}, close: () => {} },
    });
    await pump.advanceTo(0.1);
    expect(returned).not.toHaveBeenCalled();
    await pump.dispose();
    expect(returned).toHaveBeenCalledTimes(1);
  });
});

describe("export-worker.ts feeds the muxer in step", () => {
  // The worker needs WebCodecs and cannot run here, so this pins its wiring in the source: the
  // one place a video frame is added is preceded by the audio pump's advance, and the pump
  // is drained after the last frame.
  const worker = readFileSync(resolve(__dirname, "export-worker.ts"), "utf8");

  it("asks the pump for audio past the frame before every video add", () => {
    expect(worker.match(/await videoSource\.add\(/g)).toHaveLength(1);
    const advance = worker.indexOf("audio?.advanceTo(outTs + AUDIO_LEAD_SECONDS)");
    expect(advance).toBeGreaterThan(-1);
    expect(advance).toBeLessThan(worker.indexOf("await videoSource.add("));
  });

  it("sends clip frames and slide frames through that one place", () => {
    expect(worker).toContain("emit: addVideoFrame");
    expect(worker).toContain("await addVideoFrame(outTs, frameDuration)");
  });

  it("drains the pump after the last frame, then finalizes", () => {
    const close = worker.indexOf("videoSource.close()");
    const drain = worker.indexOf("await audio?.drain()");
    expect(close).toBeGreaterThan(worker.lastIndexOf("addVideoFrame"));
    expect(drain).toBeGreaterThan(close);
    expect(worker.indexOf("await out.finalize()")).toBeGreaterThan(drain);
  });
});
