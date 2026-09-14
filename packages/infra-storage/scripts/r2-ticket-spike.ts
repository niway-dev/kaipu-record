// packages/infra-storage/scripts/r2-ticket-spike.ts
// Run: R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=kaipu-private-bucket \
//      bun packages/infra-storage/scripts/r2-ticket-spike.ts
// Writes only under `spike/<uuid>/` and deletes everything it created.
import { AwsClient } from "aws4fetch";
import { createHash } from "node:crypto";

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
const key = `spike/${crypto.randomUUID()}/object.bin`;
const url = `${endpoint}/${key}`;

const body = Buffer.alloc(1024 * 1024, 7); // 1 MiB
const sha256 = createHash("sha256").update(body).digest("base64");

async function presign(headers: Record<string, string>): Promise<string> {
  const u = new URL(url);
  u.searchParams.set("X-Amz-Expires", "600");
  const signed = await client.sign(u.toString(), {
    method: "PUT",
    headers,
    aws: { signQuery: true, allHeaders: true },
  });
  return signed.url;
}

const ticketHeaders = {
  "content-type": "application/octet-stream",
  "content-length": String(body.byteLength),
  "if-none-match": "*",
  "x-amz-checksum-sha256": sha256,
};

const results: Record<string, string> = {};

// (a) wrong length must be rejected (signature covers content-length)
{
  const ticket = await presign(ticketHeaders);
  const res = await fetch(ticket, {
    method: "PUT",
    headers: { ...ticketHeaders, "content-length": String(body.byteLength * 2) },
    body: Buffer.concat([body, body]),
  });
  results["a. wrong length rejected"] = `${res.status} ${res.status >= 400 ? "OK" : "FAIL"}`;
}
// (c) wrong checksum must be rejected
{
  const ticket = await presign(ticketHeaders);
  const wrong = Buffer.alloc(body.byteLength, 9);
  const res = await fetch(ticket, { method: "PUT", headers: ticketHeaders, body: wrong });
  results["c. wrong sha256 rejected"] = `${res.status} ${res.status >= 400 ? "OK" : "FAIL"}`;
}
// happy path
{
  const ticket = await presign(ticketHeaders);
  const res = await fetch(ticket, { method: "PUT", headers: ticketHeaders, body });
  results["happy path"] = `${res.status} ${res.ok ? "OK" : "FAIL"}`;
}
// (b) second PUT through a fresh ticket for the same key must be refused (If-None-Match: *)
{
  const ticket = await presign(ticketHeaders);
  const res = await fetch(ticket, { method: "PUT", headers: ticketHeaders, body });
  results["b. overwrite refused (expect 412)"] =
    `${res.status} ${res.status === 412 ? "OK" : "FAIL"}`;
}
// (d) HEAD exposes length, type and the stored checksum
{
  const res = await client.fetch(url, {
    method: "HEAD",
    headers: { "x-amz-checksum-mode": "ENABLED" },
  });
  results["d. head"] =
    `${res.status} len=${res.headers.get("content-length")} type=${res.headers.get("content-type")} ` +
    `sha256=${res.headers.get("x-amz-checksum-sha256")} etag=${res.headers.get("etag")}`;
}
// (e) Range GET works (player seeking)
{
  const get = await client.sign(url, { method: "GET", aws: { signQuery: true } });
  const res = await fetch(get.url, { headers: { range: "bytes=10-19" } });
  results["e. range get (expect 206, 10 bytes)"] =
    `${res.status} len=${(await res.arrayBuffer()).byteLength}`;
}
// (f) cleanup
{
  const res = await client.fetch(url, { method: "DELETE" });
  results["f. delete"] = `${res.status}`;
}

console.table(results);
