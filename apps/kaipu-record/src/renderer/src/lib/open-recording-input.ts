import { ALL_FORMATS, Input, UrlSource } from "mediabunny";

/**
 * Opens a vault recording for demuxing/decoding WITHOUT reading it into memory.
 * `UrlSource` issues `Range` requests against the Range-aware `kaipu-media://` protocol
 * (`main/media-protocol.ts`), so only the container metadata and the packets a decoder
 * asks for are read. The caller owns the returned Input and must `dispose()` it.
 */
export function openRecordingInput(url: string): Input {
  return new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
}
