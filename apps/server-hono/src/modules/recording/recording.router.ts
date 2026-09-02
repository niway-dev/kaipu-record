import { RecordingNotUploadedError, UploadLimitExceededError } from "@kaipu/domain/schemas";
import type { IStorageService } from "@kaipu/domain/services";
import {
  confirmRecording,
  createRecordingUpload,
  deleteRecording,
  getRecordingDownloadUrl,
  listRecordings,
} from "@kaipu/application";
import { createDatabaseClient } from "@kaipu/infra-db/client";
import { RecordingRepository } from "@kaipu/infra-db/repositories";
import { createR2Storage } from "@kaipu/infra-storage";
import { implement, ORPCError } from "@orpc/server";
import { recordingContract } from "../../contract/recording.contract";
import { env } from "../../env";
import { authMiddleware } from "../../middleware/auth";

const db = createDatabaseClient(env.DATABASE_URL);
const repo = new RecordingRepository(db);

// Built lazily so the API still boots when R2 isn't configured — only the
// recording endpoints that touch storage fail, with a clear message.
let storageSingleton: IStorageService | null = null;
function getStorage(): IStorageService {
  if (storageSingleton) return storageSingleton;
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "Cloud storage is not configured",
    });
  }
  storageSingleton = createR2Storage({
    accountId: R2_ACCOUNT_ID,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    bucket: R2_BUCKET,
  });
  return storageSingleton;
}

const impl = implement(recordingContract).$context<{ headers: Headers }>();

export const recordingRouter = impl.router({
  list: impl.list.use(authMiddleware).handler(async ({ context }) => {
    const data = await listRecordings({ repo, userId: context.user.id });
    return { data, error: null };
  }),

  createUpload: impl.createUpload.use(authMiddleware).handler(async ({ input, context }) => {
    try {
      const data = await createRecordingUpload({
        repo,
        storage: getStorage(),
        userId: context.user.id,
        input,
      });
      return { data, error: null };
    } catch (err) {
      if (err instanceof UploadLimitExceededError) {
        throw new ORPCError("BAD_REQUEST", { message: err.message });
      }
      throw err;
    }
  }),

  confirm: impl.confirm.use(authMiddleware).handler(async ({ input, context }) => {
    try {
      const recording = await confirmRecording({
        repo,
        storage: getStorage(),
        userId: context.user.id,
        id: input.id,
      });
      if (!recording) throw new ORPCError("NOT_FOUND", { message: "Recording not found" });
      return { data: recording, error: null };
    } catch (err) {
      if (err instanceof RecordingNotUploadedError) {
        throw new ORPCError("CONFLICT", { message: err.message });
      }
      throw err;
    }
  }),

  downloadUrl: impl.downloadUrl.use(authMiddleware).handler(async ({ input, context }) => {
    const data = await getRecordingDownloadUrl({
      repo,
      storage: getStorage(),
      userId: context.user.id,
      id: input.id,
    });
    if (!data) throw new ORPCError("NOT_FOUND", { message: "Recording not found" });
    return { data, error: null };
  }),

  delete: impl.delete.use(authMiddleware).handler(async ({ input, context }) => {
    const ok = await deleteRecording({
      repo,
      storage: getStorage(),
      userId: context.user.id,
      id: input.id,
    });
    if (!ok) throw new ORPCError("NOT_FOUND", { message: "Recording not found" });
    return { data: { success: true }, error: null };
  }),
});
