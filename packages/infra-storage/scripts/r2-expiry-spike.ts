// Run: R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=kaipu-private-bucket \
//      bun packages/infra-storage/scripts/r2-expiry-spike.ts
// Question: does R2 enforce a presigned URL's expiry only when a request starts, or also while
// bytes are still flowing? Uses 3 s URLs and deliberately slow 8 MiB transfers (~12 s).
// Writes only under `spike/<uuid>/` and deletes everything it created.
import { AwsClient } from "aws4fetch";
import { createHash } from "node:crypto";
import { request } from "node:https";

const env = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
};

const client = new AwsClient({
  accessKeyId: env("R2_ACCESS_KEY_ID"),
  secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
  region: "auto",
  service: "s3",
});
const endpoint = `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com/${env("R2_BUCKET")}`;
const key = `spike/${crypto.randomUUID()}/slow.bin`;
const url = `${endpoint}/${key}`;
const EXPIRES = 3;
const CHUNKS = 16;
const CHUNK = 512 * 1024; // 16 × 512 KiB = 8 MiB
const DELAY_MS = 750; // ~12 s total, 4× the URL lifetime
const body = Buffer.alloc(CHUNKS * CHUNK, 5);
const sha256 = createHash("sha256").update(body).digest("base64");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: Record<string, string> = {};

async function presign(method: string, headers: Record<string, string> = {}): Promise<string> {
  const u = new URL(url);
  u.searchParams.set("X-Amz-Expires", String(EXPIRES));
  const signed = await client.sign(u.toString(), {
    method,
    headers,
    aws: { signQuery: true, allHeaders: true },
  });
  return signed.url;
}

function slowPut(ticket: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(ticket, { method: "PUT", headers }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    });
    req.on("error", reject);
    void (async () => {
      for (let i = 0; i < CHUNKS; i++) {
        req.write(body.subarray(i * CHUNK, (i + 1) * CHUNK));
        await sleep(DELAY_MS);
      }
      req.end();
    })();
  });
}

const putHeaders = {
  "content-type": "application/octet-stream",
  "content-length": String(body.byteLength),
  "if-none-match": "*",
  "x-amz-checksum-sha256": sha256,
};

// 1. Slow PUT that starts inside the window and finishes ~4× past expiry.
{
  const ticket = await presign("PUT", putHeaders);
  const started = Date.now();
  const status = await slowPut(ticket, putHeaders);
  results["1. slow PUT started in time"] =
    `${status} after ${((Date.now() - started) / 1000).toFixed(1)}s`;
}
// 2. PUT started after expiry (control: must be refused).
{
  const ticket = await presign("PUT", putHeaders);
  await sleep((EXPIRES + 2) * 1000);
  const res = await fetch(ticket, { method: "PUT", headers: putHeaders, body });
  results["2. PUT started after expiry"] = `${res.status}`;
}
// 3. Slow GET of a 128 MiB object that starts in time and keeps reading past expiry. The object
//    is large and the reader slow so bytes cannot all sit in socket buffers before expiry: the
//    evidence is how many bytes arrive AFTER second 8 of a 3 s URL.
{
  const big = `${endpoint}/spike/${crypto.randomUUID()}/big.bin`;
  const size = 128 * 1024 * 1024;
  await client.fetch(big, {
    method: "PUT",
    body: Buffer.alloc(size, 3),
    headers: { "content-type": "application/octet-stream" },
  });
  const u = new URL(big);
  u.searchParams.set("X-Amz-Expires", String(EXPIRES));
  const ticket = (await client.sign(u.toString(), { method: "GET", aws: { signQuery: true } })).url;
  const started = Date.now();
  results["3. slow GET started in time"] = await new Promise<string>((resolve) => {
    request(ticket, (res) => {
      let bytes = 0;
      let late = 0;
      res.on("data", (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (Date.now() - started > 8000) late += chunk.byteLength;
        res.pause();
        setTimeout(() => res.resume(), 40);
      });
      const secs = () => ((Date.now() - started) / 1000).toFixed(1);
      res.on("end", () =>
        resolve(`${res.statusCode} bytes=${bytes}/${size} afterSecond8=${late} in ${secs()}s`),
      );
      res.on("error", (e) => resolve(`error after ${secs()}s bytes=${bytes}: ${e.message}`));
    }).end();
  });
  await client.fetch(big, { method: "DELETE" });
}
// 4. A new Range request on the same, now expired URL (what a player seek does).
{
  const ticket = await presign("GET");
  await sleep((EXPIRES + 2) * 1000);
  const res = await fetch(ticket, { headers: { range: "bytes=0-99" } });
  results["4. Range request after expiry (seek)"] = `${res.status}`;
}
// 5. Cleanup.
{
  const res = await client.fetch(url, { method: "DELETE" });
  results["5. delete"] = `${res.status}`;
}
console.table(results);
