import type {
  CreateDownloadUrlOptions,
  CreateUploadUrlOptions,
  IStorageService,
  ObjectMetadata,
  UploadTicket,
  UploadTicketRequest,
} from "@kaipu/domain/services";
import { AwsClient } from "aws4fetch";

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Credentials for R2's S3-compatible API (an R2 API token, not the Worker binding). */
export interface R2StorageConfig {
  /** Cloudflare account id — forms the S3 endpoint host. */
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

const DEFAULT_EXPIRY_SECONDS = 15 * 60;

/**
 * An `IStorageService` backed by Cloudflare R2 over its S3-compatible API.
 *
 * Uploads and downloads are **presigned URLs** (query-string SigV4), so large
 * files stream directly between the client and R2 without passing through the
 * Worker (which has request-size/time limits). Deletes are performed
 * server-side with the same signed client.
 */
export function createR2Storage(config: R2StorageConfig): IStorageService {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    region: "auto",
    service: "s3",
  });

  const endpoint = `https://${config.accountId}.r2.cloudflarestorage.com`;
  const objectUrl = (key: string): string => `${endpoint}/${config.bucket}/${key}`;

  const presign = async (
    key: string,
    method: "PUT" | "GET",
    expiresInSeconds: number,
    contentType?: string,
  ): Promise<string> => {
    const url = new URL(objectUrl(key));
    url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
    // `content-type` is in aws4fetch's UNSIGNABLE_HEADERS by default (S3 SigV4
    // historically excludes it), so binding it to the signature requires
    // `allHeaders: true`. Once signed this way, the actual PUT must send the
    // exact same Content-Type header or R2 rejects the signature.
    const headers = contentType ? { "content-type": contentType } : undefined;
    // signQuery => auth travels in the query string, yielding a presigned URL
    // the client can use with a plain fetch (no Authorization header needed).
    const signed = await client.sign(url.toString(), {
      method,
      headers,
      aws: { signQuery: true, allHeaders: Boolean(contentType) },
    });
    return signed.url;
  };

  return {
    createUploadUrl(key: string, options?: CreateUploadUrlOptions): Promise<string> {
      return presign(
        key,
        "PUT",
        options?.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS,
        options?.contentType,
      );
    },

    createDownloadUrl(key: string, options?: CreateDownloadUrlOptions): Promise<string> {
      return presign(key, "GET", options?.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS);
    },

    async objectExists(key: string): Promise<boolean> {
      const res = await client.fetch(objectUrl(key), { method: "HEAD" });
      if (res.ok) return true;
      if (res.status === 404) return false;
      throw new Error(`R2 head failed for "${key}": ${res.status} ${res.statusText}`);
    },

    async deleteObject(key: string): Promise<void> {
      const res = await client.fetch(objectUrl(key), { method: "DELETE" });
      // R2 replies 204 on delete and 404 when the object is already gone — both fine.
      if (!res.ok && res.status !== 404) {
        throw new Error(`R2 delete failed for "${key}": ${res.status} ${res.statusText}`);
      }
    },

    async createUploadTicket(key: string, request: UploadTicketRequest): Promise<UploadTicket> {
      const headers: Record<string, string> = {
        "content-type": request.contentType,
        "content-length": String(request.contentLength),
        // Refuse to overwrite an object that already exists at this key: a reused or
        // leaked ticket can never replace a ready revision (R2 answers 412).
        "if-none-match": "*",
        // R2 validates the body against this digest on write and stores it.
        "x-amz-checksum-sha256": request.checksumSha256,
      };
      const url = new URL(objectUrl(key));
      url.searchParams.set("X-Amz-Expires", String(request.expiresInSeconds));
      const signed = await client.sign(url.toString(), {
        method: "PUT",
        headers,
        aws: { signQuery: true, allHeaders: true },
      });
      return {
        url: signed.url,
        headers,
        expiresAt: new Date(Date.now() + request.expiresInSeconds * 1000),
      };
    },

    async headObject(key: string): Promise<ObjectMetadata | null> {
      const res = await client.fetch(objectUrl(key), {
        method: "HEAD",
        headers: { "x-amz-checksum-mode": "ENABLED" },
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`R2 head failed for "${key}": ${res.status} ${res.statusText}`);
      const length = Number(res.headers.get("content-length"));
      return {
        sizeBytes: Number.isFinite(length) ? length : 0,
        contentType: res.headers.get("content-type"),
        etag: res.headers.get("etag"),
        checksumSha256: res.headers.get("x-amz-checksum-sha256"),
      };
    },

    async listObjectKeys(prefix: string, cursor?: string) {
      const url = new URL(`${endpoint}/${config.bucket}`);
      url.searchParams.set("list-type", "2");
      url.searchParams.set("prefix", prefix);
      url.searchParams.set("max-keys", "1000");
      if (cursor) url.searchParams.set("continuation-token", cursor);
      const res = await client.fetch(url.toString(), { method: "GET" });
      if (!res.ok)
        throw new Error(`R2 list failed for "${prefix}": ${res.status} ${res.statusText}`);
      const xml = await res.text();
      const keys = [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) => decodeXml(m[1] ?? ""));
      const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
      const token = xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/);
      return { keys, nextCursor: truncated && token ? decodeXml(token[1] ?? "") : null };
    },
  };
}
