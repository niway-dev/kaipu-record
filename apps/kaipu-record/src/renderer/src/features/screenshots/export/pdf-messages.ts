/** Main -> worker. `png` is transferred. */
export interface PdfRequest {
  png: ArrayBuffer;
  width: number;
  height: number;
}

/** Worker -> main. `pdf` is transferred. */
export type PdfResponse = { type: "done"; pdf: ArrayBuffer } | { type: "error"; message: string };
