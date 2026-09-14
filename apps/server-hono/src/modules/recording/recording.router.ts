import { RecordingNotUploadedError, UploadLimitExceededError } from "@kaipu/domain/schemas";
import {
  confirmRecording,
  createRecordingUpload,
  deleteRecording,
  getRecordingDownloadUrl,
  listRecordings,
} from "@kaipu/application";
import { createDatabaseClient } from "@kaipu/infra-db/client";
import { RecordingRepository } from "@kaipu/infra-db/repositories";
import { implement, ORPCError } from "@orpc/server";
import { recordingContract } from "../../contract/recording.contract";
import { env } from "../../env";
import { getStorage } from "../../lib/storage";
import { authMiddleware } from "../../middleware/auth";

const db = createDatabaseClient(env.DATABASE_URL);
const repo = new RecordingRepository(db);

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
