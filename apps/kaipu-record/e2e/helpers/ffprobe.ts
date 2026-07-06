import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface StreamSummary {
  video?: { codec: string; durationSec: number };
  audio?: { codec: string; durationSec: number };
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  duration?: string;
}

/** Pure parser (unit-tested): first video + first audio stream, codec + duration. */
export function parseFfprobeStreams(json: string): StreamSummary {
  const streams = (JSON.parse(json) as { streams?: FfprobeStream[] }).streams ?? [];
  const summary: StreamSummary = {};
  for (const s of streams) {
    if (s.codec_type === "video" && !summary.video) {
      summary.video = { codec: s.codec_name ?? "", durationSec: Number(s.duration) };
    } else if (s.codec_type === "audio" && !summary.audio) {
      summary.audio = { codec: s.codec_name ?? "", durationSec: Number(s.duration) };
    }
  }
  return summary;
}

/** True if `ffprobe` is on PATH — lets tests skip the codec assertion when it is not. */
export async function ffprobeAvailable(): Promise<boolean> {
  try {
    await run("ffprobe", ["-version"]);
    return true;
  } catch {
    return false;
  }
}

/** Run ffprobe against a file and return the parsed stream summary. */
export async function probeMedia(filePath: string): Promise<StreamSummary> {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_streams",
    "-of",
    "json",
    filePath,
  ]);
  return parseFfprobeStreams(stdout);
}
