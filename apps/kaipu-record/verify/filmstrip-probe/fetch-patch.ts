/**
 * Probe only (NIW2-844 layer 2): runs BEFORE the filmstrip worker in the same worker bundle.
 * It reports every `fetch` the worker makes (the Range asked, the status, the bytes granted) and
 * stamps every message the worker posts with the worker's own clock, so the scenario can prove
 * "the worker read this 10 GB file by Range" and measure pacing without the main thread's
 * receive delay. Never shipped: only `verify/filmstrip-worker.verify.ts` builds it.
 */
const realFetch = self.fetch.bind(self);
const realPost = self.postMessage.bind(self) as (
  message: unknown,
  transfer?: Transferable[],
) => void;

self.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const startedAt = performance.now();
  const response = await realFetch(input, init);
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  realPost({
    type: "probe-fetch",
    range: headers.get("range"),
    status: response.status,
    contentLength: Number(response.headers.get("content-length")),
    contentRange: response.headers.get("content-range"),
    ms: performance.now() - startedAt,
    _workerTime: performance.now(),
  });
  return response;
};

(self as unknown as { postMessage: typeof realPost }).postMessage = (message, transfer) =>
  realPost(
    message && typeof message === "object"
      ? { ...(message as object), _workerTime: performance.now() }
      : message,
    transfer,
  );
