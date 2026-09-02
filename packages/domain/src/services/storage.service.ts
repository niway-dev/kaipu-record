/**
 * A cloud object store port (implemented by `@kaipu/infra-storage` over R2).
 * The application layer depends only on this interface, never on R2 directly.
 */

export interface CreateUploadUrlOptions {
  /** Bind the presigned PUT to a content type, when the client will send one. */
  contentType?: string;
  /** URL lifetime; the implementation supplies a sensible default. */
  expiresInSeconds?: number;
}

export interface CreateDownloadUrlOptions {
  expiresInSeconds?: number;
}

export interface IStorageService {
  /** A presigned PUT URL the client uploads the object to directly (bypasses the Worker). */
  createUploadUrl(key: string, options?: CreateUploadUrlOptions): Promise<string>;
  /** A presigned GET URL to download the object. */
  createDownloadUrl(key: string, options?: CreateDownloadUrlOptions): Promise<string>;
  /** Whether the object has actually landed in storage (used to verify an upload before trusting it). */
  objectExists(key: string): Promise<boolean>;
  /** Remove the object from storage. */
  deleteObject(key: string): Promise<void>;
}
