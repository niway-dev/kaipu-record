import { recordingBaseSchema } from "@kaipu/domain/schemas";
import { oc } from "@orpc/contract";
import { z } from "zod";
import { apiResponseSchema } from "./shared.contract";

const downloadSchema = z.object({
  recording: recordingBaseSchema,
  downloadUrl: z.string(),
});

export const recordingContract = {
  list: oc
    .route({ method: "GET", path: "/recordings" })
    .output(apiResponseSchema(z.array(recordingBaseSchema))),

  downloadUrl: oc
    .route({ method: "GET", path: "/recordings/{id}/download-url" })
    .input(z.object({ id: z.string() }))
    .output(apiResponseSchema(downloadSchema)),

  delete: oc
    .route({ method: "DELETE", path: "/recordings/{id}" })
    .input(z.object({ id: z.string() }))
    .output(apiResponseSchema(z.object({ success: z.boolean() }))),
};
