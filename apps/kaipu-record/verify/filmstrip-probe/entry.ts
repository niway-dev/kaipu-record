/**
 * Probe only (NIW2-844 layer 2): the filmstrip worker plus a `bench` message that times the two
 * ways to decode a set of slots on one open file: one decoder pass per keyframe group (how the
 * engine worked before it batched slots into passes of `PASS_SLOTS`) and a single forward pass
 * over all of them. Built with `bun build` by
 * `verify/filmstrip-worker.verify.ts`; never shipped.
 */
import "./fetch-patch";
import "../../src/renderer/src/features/video-editor/filmstrip-worker";
import { ALL_FORMATS, EncodedPacketSink, Input } from "mediabunny";
import type { Slot } from "../../src/renderer/src/features/video-editor/filmstrip-frames";
import {
  createFilmstripUrlSource,
  openFilmstripFileFrom,
} from "../../src/renderer/src/features/video-editor/filmstrip-mediabunny";
import type { DecoderPreference } from "../../src/renderer/src/features/video-editor/filmstrip-messages";
import {
  groupByKeyframe,
  type PlannedSlot,
} from "../../src/renderer/src/features/video-editor/filmstrip-plan";

interface BenchMessage {
  type: "bench";
  id: number;
  url: string;
  decoder: DecoderPreference;
  mode: "per-slot" | "single-pass";
  slots: Slot[];
}

interface InfoMessage {
  type: "info";
  id: number;
  url: string;
}

const engineHandler = (self as unknown as { onmessage: (event: MessageEvent) => void }).onmessage;

async function bench(message: BenchMessage): Promise<void> {
  const post = self.postMessage as unknown as (m: unknown) => void;
  try {
    const openStart = performance.now();
    const file = await openFilmstripFileFrom(
      new Input({ source: createFilmstripUrlSource(message.url), formats: ALL_FORMATS }),
      message.decoder,
    );
    const openMs = performance.now() - openStart;
    const planStart = performance.now();
    const planned: PlannedSlot[] = [];
    for (const [rank, slot] of message.slots.entries()) {
      const plan = await file.plan(slot);
      if (plan.kind === "plan") planned.push({ ...plan, rank });
    }
    const planMs = performance.now() - planStart;

    const frames: { decodeMs: number; encodeMs: number; wallMs: number }[] = [];
    const runStart = performance.now();
    let last = runStart;
    const groups =
      message.mode === "per-slot"
        ? groupByKeyframe(planned)
        : [
            {
              keyTimestamp: 0,
              items: [...planned].sort((a, b) => a.targetTimestamp - b.targetTimestamp),
            },
          ];
    for (const group of groups) {
      for await (const decoded of file.decode(group)) {
        const now = performance.now();
        frames.push({ decodeMs: decoded.decodeMs, encodeMs: decoded.encodeMs, wallMs: now - last });
        last = now;
      }
    }
    const totalMs = performance.now() - runStart;
    await file.close();
    post({
      type: "bench-done",
      id: message.id,
      mode: message.mode,
      decoder: message.decoder,
      openMs,
      planMs,
      totalMs,
      planned: planned.length,
      keyframePlans: planned.filter((p) => p.keyframe).length,
      frames,
    });
  } catch (error) {
    post({ type: "bench-error", id: message.id, message: String(error) });
  }
}

/** Duration, size and the spacing of the first key packets: what the scenario plans slots from. */
async function info(message: InfoMessage): Promise<void> {
  const post = self.postMessage as unknown as (m: unknown) => void;
  const input = new Input({ source: createFilmstripUrlSource(message.url), formats: ALL_FORMATS });
  try {
    const openStart = performance.now();
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error("no video track");
    const duration = await input.computeDuration();
    const openMs = performance.now() - openStart;
    const sink = new EncodedPacketSink(track);
    const keys: number[] = [];
    let key = await sink.getFirstKeyPacket({ metadataOnly: true });
    while (key && keys.length < 40) {
      keys.push(key.timestamp);
      key = await sink.getNextKeyPacket(key, { metadataOnly: true });
    }
    post({
      type: "info-done",
      id: message.id,
      duration,
      openMs,
      width: track.displayWidth,
      height: track.displayHeight,
      codec: track.codec,
      firstKeys: keys,
    });
  } catch (error) {
    post({ type: "bench-error", id: message.id, message: String(error) });
  } finally {
    input.dispose();
  }
}

(self as unknown as { onmessage: (event: MessageEvent) => void }).onmessage = (event) => {
  if (event.data?.type === "info") void info(event.data as InfoMessage);
  else if (event.data?.type === "bench") void bench(event.data as BenchMessage);
  else engineHandler(event);
};
