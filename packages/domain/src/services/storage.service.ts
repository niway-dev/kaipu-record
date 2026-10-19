/**
 * A cloud object store port (implemented by `@kaipu/infra-storage` over R2).
 * The application layer depends only on this interface, never on R2 directly.
 */

export interface CreateUploadUrlOptions {
  contentType?: string;
  expiresInSeconds?: number;
}

export interface CreateDownloadUrlOptions {
  expiresInSeconds?: number;
}

/**
 * A restricted ticket. The signature covers every header in `headers`; the
 * client must send them byte-for-byte or storage rejects the request. That is
 * what bounds the write to exactly the declared object.
 */
export interface UploadTicketRequest {
  contentType: string;
  contentLength: number;
  /** base64 sha256 of the body; storage validates it on write. */
  checksumSha256: string;
  expiresInSeconds: number;
}

export interface UploadTicket {
  url: string;
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface ObjectMetadata {
  sizeBytes: number;
  contentType: string | null;
  etag: string | null;
  /** base64 sha256 as stored by the checksum header on PUT; null when absent. */
  checksumSha256: string | null;
}

export interface IStorageService {
  /**
   * @deprecated No production caller since NIW2-323 removed the legacy upload routes; the port
   * and the R2 implementation are deleted in cloud-01 Task 12. Use `createUploadTicket`.
   */
  createUploadUrl(key: string, options?: CreateUploadUrlOptions): Promise<string>;
  /** Presigned PUT bound to key + length + type + sha256 + no-overwrite. */
  createUploadTicket(key: string, request: UploadTicketRequest): Promise<UploadTicket>;
  /** A presigned GET URL to download the object. */
  createDownloadUrl(key: string, options?: CreateDownloadUrlOptions): Promise<string>;
  /**
   * @deprecated No production caller since NIW2-323 removed the legacy confirm route; deleted in
   * cloud-01 Task 12. Use `headObject`.
   */
  objectExists(key: string): Promise<boolean>;
  /** Metadata of the stored object, or null when it does not exist. */
  headObject(key: string): Promise<ObjectMetadata | null>;
  /** Remove one object (idempotent: a missing object is success). */
  deleteObject(key: string): Promise<void>;
  /** Keys under a prefix, one page at a time. */
  listObjectKeys(
    prefix: string,
    cursor?: string,
  ): Promise<{ keys: string[]; nextCursor: string | null }>;
}
