import { createRecordingUploadSchema, recordingBaseSchema } from "@kaipu/domain/schemas";
import { oc } from "@orpc/contract";
import { z } from "zod";
import { apiResponseSchema } from "./shared.contract";

const uploadTicketSchema = z.object({
  recording: recordingBaseSchema,
  /** Presigned PUT URL — upload the bytes here, then call confirm. */
  uploadUrl: z.string(),
});

const downloadSchema = z.object({
  recording: recordingBaseSchema,
  downloadUrl: z.string(),
});

export const recordingContract = {
  list: oc
    .route({ method: "GET", path: "/recordings" })
    .output(apiResponseSchema(z.array(recordingBaseSchema))),

  createUpload: oc
    .route({ method: "POST", path: "/recordings", successStatus: 201 })
    .input(createRecordingUploadSchema)
    .output(apiResponseSchema(uploadTicketSchema)),

  confirm: oc
    .route({ method: "POST", path: "/recordings/{id}/confirm" })
    .input(z.object({ id: z.string() }))
    .output(apiResponseSchema(recordingBaseSchema)),

  downloadUrl: oc
    .route({ method: "GET", path: "/recordings/{id}/download-url" })
    .input(z.object({ id: z.string() }))
    .output(apiResponseSchema(downloadSchema)),

  delete: oc
    .route({ method: "DELETE", path: "/recordings/{id}" })
    .input(z.object({ id: z.string() }))
    .output(apiResponseSchema(z.object({ success: z.boolean() }))),
};
