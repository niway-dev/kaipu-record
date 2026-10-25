/**
 * PDF worker — pdf-lib's PNG decode, alpha split and deflate are synchronous JS
 * that froze the renderer for seconds on a 5K shot (SHOT-A2). No DOM here.
 */
import { buildPdf } from "./build-pdf";
import type { PdfRequest, PdfResponse } from "./pdf-messages";

type WorkerSelf = typeof self & {
  onmessage: ((event: MessageEvent<PdfRequest>) => void) | null;
  postMessage(message: PdfResponse, transfer?: Transferable[]): void;
};

const workerSelf = self as unknown as WorkerSelf;

workerSelf.onmessage = (event) => {
  const { png, width, height } = event.data;
  buildPdf(png, width, height).then(
    (pdf) => workerSelf.postMessage({ type: "done", pdf }, [pdf]),
    (error: unknown) =>
      workerSelf.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      }),
  );
};
