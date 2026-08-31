import type {
  CreateDownloadUrlOptions,
  CreateUploadUrlOptions,
  IStorageService,
} from "@kaipu/domain/services";
import { AwsClient } from "aws4fetch";

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
  ): Promise<string> => {
    const url = new URL(objectUrl(key));
    url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
    // signQuery => auth travels in the query string, yielding a presigned URL
    // the client can use with a plain fetch (no Authorization header needed).
    const signed = await client.sign(url.toString(), {
      method,
      aws: { signQuery: true },
    });
    return signed.url;
  };

  return {
    createUploadUrl(key: string, options?: CreateUploadUrlOptions): Promise<string> {
      return presign(key, "PUT", options?.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS);
    },

    createDownloadUrl(key: string, options?: CreateDownloadUrlOptions): Promise<string> {
      return presign(key, "GET", options?.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS);
    },

    async deleteObject(key: string): Promise<void> {
      const res = await client.fetch(objectUrl(key), { method: "DELETE" });
      // R2 replies 204 on delete and 404 when the object is already gone — both fine.
      if (!res.ok && res.status !== 404) {
        throw new Error(`R2 delete failed for "${key}": ${res.status} ${res.statusText}`);
      }
    },
  };
}
