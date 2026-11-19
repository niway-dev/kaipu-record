/**
 * Browser side of the decode benchmark. It runs the app's real `decodeAudioToPcm` over a
 * recording served at `url`, discards each chunk (counting bytes), and measures main-thread
 * stalls with a requestAnimationFrame heartbeat and a 16 ms setInterval heartbeat that run on
 * the same thread as the decode, the way the app runs it.
 */
import { decodeAudioToPcm } from "TRANSCRIPTION_AUDIO_DIR/decode-audio";

interface Gaps {
  count: number;
  p50: number;
  p99: number;
  max: number;
  over100ms: number;
}

function summarize(gaps: number[]): Gaps {
  const sorted = [...gaps].sort((a, b) => a - b);
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return {
    count: sorted.length,
    p50: at(0.5),
    p99: at(0.99),
    max: sorted[sorted.length - 1] ?? 0,
    over100ms: sorted.filter((gap) => gap > 100).length,
  };
}

interface ChromeMemory {
  usedJSHeapSize: number;
}

async function runDecode(url: string) {
  const rafGaps: number[] = [];
  const timerGaps: number[] = [];
  let running = true;
  let lastRaf = performance.now();
  let lastTimer = performance.now();
  const onFrame = (now: number): void => {
    rafGaps.push(now - lastRaf);
    lastRaf = now;
    if (running) requestAnimationFrame(onFrame);
  };
  requestAnimationFrame(onFrame);
  const timer = setInterval(() => {
    const now = performance.now();
    timerGaps.push(now - lastTimer);
    lastTimer = now;
  }, 16);
  let peakHeap = 0;
  const memory = (performance as unknown as { memory?: ChromeMemory }).memory;
  const heapTimer = setInterval(() => {
    if (memory) peakHeap = Math.max(peakHeap, memory.usedJSHeapSize);
  }, 500);

  let chunks = 0;
  let bytes = 0;
  let minChunk = Infinity;
  let maxChunk = 0;
  let decodedMs = 0;
  const started = performance.now();
  try {
    for await (const chunk of decodeAudioToPcm({ url }, { onDecoded: (ms) => (decodedMs = ms) })) {
      chunks += 1;
      bytes += chunk.byteLength;
      minChunk = Math.min(minChunk, chunk.byteLength);
      maxChunk = Math.max(maxChunk, chunk.byteLength);
    }
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause;
    throw new Error(`${String(error)} | cause: ${String(cause)} | after ${chunks} chunks`);
  }
  const wallMs = performance.now() - started;
  running = false;
  clearInterval(timer);
  clearInterval(heapTimer);
  if (memory) peakHeap = Math.max(peakHeap, memory.usedJSHeapSize);

  return {
    wallMs,
    decodedMs,
    chunks,
    bytes,
    minChunk,
    maxChunk,
    peakJsHeapBytes: memory ? peakHeap : null,
    rafGapsMs: summarize(rafGaps),
    timerGapsMs: summarize(timerGaps),
  };
}

(window as unknown as { runDecode: typeof runDecode }).runDecode = runDecode;
