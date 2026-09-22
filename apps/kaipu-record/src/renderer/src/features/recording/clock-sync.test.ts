import { describe, expect, it } from "vitest";
import { measureClockOffset } from "./clock-sync";

describe("measureClockOffset", () => {
  it("keeps the ping with the smallest round trip", async () => {
    // Renderer clock = main clock − 250. Round trips: 10, 2 (best), 6.
    let rendererNow = 0;
    const script = [10, 2, 6];
    let call = 0;
    const now = (): number => rendererNow;
    const ping = async (): Promise<number> => {
      const rtt = script[call++];
      rendererNow += rtt / 2;
      const main = rendererNow + 250;
      rendererNow += rtt / 2;
      return main;
    };
    const result = await measureClockOffset(ping, now, 3);
    expect(result.rtt).toBe(2);
    expect(result.offset).toBe(250);
  });
});
