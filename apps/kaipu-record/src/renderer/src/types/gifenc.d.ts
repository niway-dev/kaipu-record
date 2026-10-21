/** Minimal typings for `gifenc` 1.0.3 (the package ships none). Only what Kaipu uses. */
declare module "gifenc" {
  export type GifPalette = number[][];
  export type GifColorFormat = "rgb565" | "rgb444" | "rgba4444";

  export interface GifFrameOptions {
    palette?: GifPalette | null;
    delay?: number;
    repeat?: number;
    transparent?: boolean;
    transparentIndex?: number;
    colorDepth?: number;
    dispose?: number;
    first?: boolean;
  }

  export interface GifStream {
    writeByte(byte: number): void;
    writeBytes(bytes: ArrayLike<number>, offset?: number, length?: number): void;
  }

  export interface GifEncoderInstance {
    reset(): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    readonly buffer: ArrayBuffer;
    readonly stream: GifStream;
    writeHeader(): void;
    writeFrame(index: Uint8Array, width: number, height: number, opts?: GifFrameOptions): void;
  }

  export function GIFEncoder(opts?: {
    initialCapacity?: number;
    auto?: boolean;
  }): GifEncoderInstance;

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: { format?: GifColorFormat; oneBitAlpha?: boolean | number; clearAlpha?: boolean },
  ): GifPalette;

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifPalette,
    format?: GifColorFormat,
  ): Uint8Array;

  export default GIFEncoder;
}
