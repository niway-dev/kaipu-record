import { ALL_FORMATS, Input, UrlSource } from "mediabunny";

/** Same body as the app's `lib/open-recording-input.ts`; the build aliases the app import to this file. */
export function openRecordingInput(url: string): Input {
  return new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
}
