import { describe, expect, it } from "vitest";
import { BubbleProtection } from "./bubble-protection";

/**
 * The bubble leaves the capture only while its face is recorded in the active take's webcam
 * file (ADR 0037). Otherwise the face would be in neither file.
 */
describe("BubbleProtection", () => {
  it("protects with no take active, so the next take starts with the bubble excluded", () => {
    expect(new BubbleProtection().protects()).toBe(true);
  });

  it("protects a take that records a webcam file", () => {
    const state = new BubbleProtection();
    state.screenCreated("s1");
    state.webcamCreated("s1");
    expect(state.protects()).toBe(true);
  });

  it("leaves the bubble in a take that started with the camera off (turned on mid-take)", () => {
    const state = new BubbleProtection();
    state.screenCreated("s1");
    expect(state.protects()).toBe(false);
  });

  it("leaves it in once the take's webcam ended (off then on mid-take, unplugged, failed)", () => {
    const state = new BubbleProtection();
    state.screenCreated("s1");
    state.webcamCreated("s1");
    state.webcamEnded("s1");
    expect(state.protects()).toBe(false);
  });

  it("protects again once the take ends, by finalize/abort or a forced reset", () => {
    const state = new BubbleProtection();
    state.screenCreated("s1");
    state.ended("s1");
    expect(state.protects()).toBe(true);
    state.screenCreated("s2");
    state.reset();
    expect(state.protects()).toBe(true);
  });

  it("follows only the newest take: a discarded start's late abort or report changes nothing", () => {
    const state = new BubbleProtection();
    state.screenCreated("old");
    state.screenCreated("new");
    state.webcamCreated("new");
    state.webcamEnded("old");
    state.ended("old");
    expect(state.protects()).toBe(true);
    state.webcamCreated("old");
    state.webcamEnded("new");
    expect(state.protects()).toBe(false);
  });
});

describe("BubbleProtection.recordsWebcam", () => {
  it("is true only while the active take records a live webcam file", () => {
    const protection = new BubbleProtection();
    expect(protection.recordsWebcam()).toBe(false); // no take
    protection.screenCreated("a");
    expect(protection.recordsWebcam()).toBe(false); // no webcam yet
    protection.webcamCreated("a");
    expect(protection.recordsWebcam()).toBe(true);
    protection.webcamEnded("a");
    expect(protection.recordsWebcam()).toBe(false);
    protection.webcamCreated("a");
    protection.ended("a");
    expect(protection.recordsWebcam()).toBe(false);
  });
});
