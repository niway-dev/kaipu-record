import { describe, it, expect } from "vitest";
import { parseFfprobeStreams } from "./ffprobe";

describe("parseFfprobeStreams", () => {
  it("extracts the first video and audio stream with codec + duration", () => {
    const json = JSON.stringify({
      streams: [
        { codec_type: "video", codec_name: "h264", duration: "3.000000" },
        { codec_type: "audio", codec_name: "aac", duration: "3.026667" },
      ],
    });
    expect(parseFfprobeStreams(json)).toEqual({
      video: { codec: "h264", durationSec: 3 },
      audio: { codec: "aac", durationSec: 3.026667 },
    });
  });

  it("omits a track that is absent", () => {
    const json = JSON.stringify({
      streams: [{ codec_type: "video", codec_name: "h264", duration: "3.0" }],
    });
    expect(parseFfprobeStreams(json)).toEqual({ video: { codec: "h264", durationSec: 3 } });
  });
});
