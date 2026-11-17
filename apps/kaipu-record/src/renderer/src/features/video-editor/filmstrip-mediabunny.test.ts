import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ALL_FORMATS, BufferSource, Input } from "mediabunny";
import { describe, expect, it } from "vitest";
import { createFilmstripUrlSource, createPacketIndex } from "./filmstrip-mediabunny";
import { READ_CACHE_BYTES } from "./filmstrip-messages";
import { countPacketsTo, planSlot, type PlannedSlot } from "./filmstrip-plan";
import type { Slot } from "./filmstrip-frames";

/*
 * Real containers, 64x36, 30 fps, 12 s, B-frames on, the index at the END of the file like a
 * Kaipu recording. `keyframes-2s` has a key packet every 2 s; `one-keyframe` has exactly one
 * (360 packets). Both made with ffmpeg:
 *   ffmpeg -f lavfi -i testsrc=size=64x36:rate=30:duration=12 -c:v libx264 -preset veryfast
 *     -bf 2 -g 60 (or 9999) -keyint_min 60 (or 9999) -sc_threshold 0 -crf 45 -pix_fmt yuv420p -an
 */
async function indexOf(name: string) {
  const bytes = readFileSync(resolve(__dirname, "__fixtures__", name));
  const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error("fixture has no video track");
  return createPacketIndex(track);
}

const slot = (start: number, end: number): Slot => ({ index: 0, start, end, visible: true });

describe("createFilmstripUrlSource: AC13 the read cache is capped", () => {
  it("AC13: caps the read cache at 8 MiB instead of mediabunny's 64 MiB default", () => {
    const source = createFilmstripUrlSource("kaipu-media://recording/a?w=ws");
    const cache = (source as unknown as { _orchestrator: { options: { maxCacheSize: number } } })
      ._orchestrator.options.maxCacheSize;
    expect(READ_CACHE_BYTES).toBe(8 * 1024 * 1024);
    expect(cache).toBe(READ_CACHE_BYTES);
  });
});

describe("the packet index on a real container with a keyframe every 2 s", () => {
  it("finds the key packet at or before a time, and the frame at or before it", async () => {
    const index = await indexOf("filmstrip-keyframes-2s.mp4");
    expect(await index.keyAtOrBefore(0)).toBe(0);
    expect(await index.keyAtOrBefore(3.99)).toBe(2);
    expect(await index.keyAtOrBefore(4)).toBe(4);
    expect(await index.keyAtOrBefore(11.9)).toBe(10);
    const frame = await index.frameAtOrBefore(3);
    expect(frame).not.toBeNull();
    expect(frame as number).toBeLessThanOrEqual(3);
    expect(frame as number).toBeGreaterThan(2.9);
  });

  it("lists packets in decode order from a key packet, and the count to a frame is bounded by the GOP", async () => {
    const index = await indexOf("filmstrip-keyframes-2s.mp4");
    const target = (await index.frameAtOrBefore(3)) as number;
    const counted = await countPacketsTo(index.packetTimestampsFrom(2), target, 300);
    expect(counted.reached).toBe(true);
    // One second after the keyframe at 30 fps: about 30 packets.
    expect(counted.count).toBeGreaterThan(25);
    expect(counted.count).toBeLessThan(40);
  });

  it("fills a slot that holds a keyframe with that key packet alone", async () => {
    const index = await indexOf("filmstrip-keyframes-2s.mp4");
    expect(await planSlot(index, slot(4, 6))).toMatchObject({
      kind: "plan",
      keyframe: true,
      keyTimestamp: 4,
      targetTimestamp: 4,
    });
  });

  it("plans an exact decode inside a GOP, counted from the previous keyframe", async () => {
    const index = await indexOf("filmstrip-keyframes-2s.mp4");
    const plan = (await planSlot(index, slot(5, 5.5))) as PlannedSlot;
    expect(plan.kind).toBe("plan");
    expect(plan.keyframe).toBe(false);
    expect(plan.keyTimestamp).toBe(4);
    expect(plan.targetTimestamp).toBeGreaterThanOrEqual(5);
    expect(plan.targetTimestamp).toBeLessThan(5.5);
  });

  it("skips a slot past the end of the file", async () => {
    const index = await indexOf("filmstrip-keyframes-2s.mp4");
    expect(await planSlot(index, slot(20, 21))).toEqual({ kind: "skip", reason: "no-frame" });
  });
});

describe("AC8: a file with a single keyframe", () => {
  it("never plans an exact decode of more than 300 packets, and a tile 301 packets away is skipped", async () => {
    const index = await indexOf("filmstrip-one-keyframe.mp4");
    // Packet 300 from the keyframe is at about 10 s (30 fps): a slot there needs ~300 packets.
    const near = (await planSlot(index, slot(2, 2.5))) as PlannedSlot;
    expect(near.kind).toBe("plan");
    const far = await planSlot(index, slot(11, 11.5)); // ~ packet 330 from the one keyframe
    expect(far).toEqual({ kind: "skip", reason: "over-cap" });
  });

  it("gives the first slot its keyframe, and walks no further than the cap to decide the rest", async () => {
    const index = await indexOf("filmstrip-one-keyframe.mp4");
    expect(await planSlot(index, slot(0, 1))).toMatchObject({ kind: "plan", keyframe: true });
    // Every slot of the 12 s file is either planned within the cap or skipped as over it.
    for (let start = 1; start < 12; start += 1) {
      const plan = await planSlot(index, slot(start, start + 1));
      if (plan.kind === "skip") expect(plan.reason).toBe("over-cap");
      else {
        const counted = await countPacketsTo(
          index.packetTimestampsFrom(plan.keyTimestamp),
          plan.targetTimestamp,
          300,
        );
        expect(counted.count).toBeLessThanOrEqual(300);
      }
    }
  });
});
