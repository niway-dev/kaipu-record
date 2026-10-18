import { beforeEach, describe, expect, it } from "vitest";
import {
  clearLastQuietCapture,
  keepLastQuietCapture,
  peekLastQuietCapture,
  releaseLastQuietCapture,
  takeLastQuietCapture,
  type QuietCapture,
} from "./last-quiet-capture";

const SHOT: QuietCapture = { png: Buffer.from([1]), width: 1, height: 1, mode: "frame" };
const NEXT: QuietCapture = { ...SHOT, png: Buffer.from([2]) };

beforeEach(() => {
  clearLastQuietCapture();
  takeLastQuietCapture();
});

describe("last quiet capture", () => {
  it("peek reads the bytes without freeing them", () => {
    keepLastQuietCapture(SHOT);
    expect(peekLastQuietCapture()?.capture).toBe(SHOT);
    expect(peekLastQuietCapture()?.capture).toBe(SHOT);
    expect(takeLastQuietCapture()).toBe(SHOT);
    expect(peekLastQuietCapture()).toBeNull();
  });

  it("release frees the bytes of its own capture only", () => {
    keepLastQuietCapture(SHOT);
    const old = peekLastQuietCapture()!.sequence;

    // A new capture starts and keeps its own bytes.
    clearLastQuietCapture();
    keepLastQuietCapture(NEXT);
    releaseLastQuietCapture(old);
    expect(peekLastQuietCapture()?.capture).toBe(NEXT);

    releaseLastQuietCapture(peekLastQuietCapture()!.sequence);
    expect(peekLastQuietCapture()).toBeNull();
  });
});
