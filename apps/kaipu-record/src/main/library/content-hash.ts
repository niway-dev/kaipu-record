import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/**
 * base64 sha256 of a file, streamed (a recording can be a gigabyte). base64 is the
 * encoding R2 stores in `x-amz-checksum-sha256`, so local and cloud compare as
 * plain strings.
 */
export function sha256FileBase64(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("base64")));
  });
}
