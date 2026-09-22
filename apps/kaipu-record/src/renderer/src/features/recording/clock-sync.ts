/**
 * Renderer → main clock offset, NTP style: ask main for its `performance.now()` a
 * few times, keep the round trip with the smallest RTT, and assume main read its
 * clock halfway through it. `mainMs ≈ rendererMs + offset`.
 *
 * Why not compare `performance.timeOrigin + performance.now()` across processes:
 * each process fixes `timeOrigin` from the wall clock when it starts, and the
 * monotonic clock does not advance during system sleep. A renderer created after a
 * sleep (window re-created, renderer crash) then disagrees with main by the whole
 * sleep duration. A handshake measured at record time has no such failure mode.
 */

export interface ClockOffset {
  /** Add to a renderer `performance.now()` reading to get the main-clock reading. */
  offset: number;
  /** Round trip of the winning ping, ms — the offset's error is at most rtt / 2. */
  rtt: number;
}

export async function measureClockOffset(
  pingMain: () => Promise<number>,
  now: () => number = () => performance.now(),
  rounds = 7,
): Promise<ClockOffset> {
  let best: ClockOffset = { offset: 0, rtt: Number.POSITIVE_INFINITY };
  for (let i = 0; i < rounds; i++) {
    const sentAt = now();
    const mainNow = await pingMain();
    const receivedAt = now();
    const rtt = receivedAt - sentAt;
    if (rtt < best.rtt) best = { offset: mainNow - (sentAt + receivedAt) / 2, rtt };
  }
  return best;
}
