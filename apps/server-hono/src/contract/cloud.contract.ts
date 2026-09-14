import { cloudAssetSummarySchema, createUploadIntentSchema } from "@kaipu/domain/schemas";
import { oc } from "@orpc/contract";
import { z } from "zod";
import { apiResponseSchema } from "./shared.contract";

const ticketSchema = z.object({
  url: z.string(),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.date(),
  thumbnail: z.object({ url: z.string(), headers: z.record(z.string(), z.string()) }).nullable(),
});

const uploadIntentResultSchema = z.object({
  asset: cloudAssetSummarySchema,
  revisionId: z.string(),
  status: z.enum(["reserved", "ready"]),
  ticket: ticketSchema.nullable(),
});

const revisionParams = z.object({ assetId: z.string().uuid(), revisionId: z.string() });
const assetParams = z.object({ assetId: z.string().uuid() });

export const cloudContract = {
  createUploadIntent: oc
    .route({ method: "POST", path: "/assets/upload-intents", successStatus: 201 })
    .input(createUploadIntentSchema)
    .output(apiResponseSchema(uploadIntentResultSchema)),

  confirmUpload: oc
    .route({ method: "POST", path: "/assets/{assetId}/revisions/{revisionId}/confirm" })
    .input(revisionParams)
    .output(apiResponseSchema(cloudAssetSummarySchema)),

  cancelUpload: oc
    .route({ method: "POST", path: "/assets/{assetId}/revisions/{revisionId}/cancel" })
    .input(revisionParams)
    .output(apiResponseSchema(z.object({ released: z.boolean() }))),

  list: oc
    .route({ method: "GET", path: "/assets" })
    .input(
      z.object({
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      }),
    )
    .output(
      apiResponseSchema(
        z.object({ items: z.array(cloudAssetSummarySchema), nextCursor: z.string().nullable() }),
      ),
    ),

  get: oc
    .route({ method: "GET", path: "/assets/{assetId}" })
    .input(assetParams)
    .output(apiResponseSchema(cloudAssetSummarySchema)),

  downloadUrl: oc
    .route({ method: "GET", path: "/assets/{assetId}/download-url" })
    .input(assetParams)
    .output(
      apiResponseSchema(
        z.object({
          asset: cloudAssetSummarySchema,
          downloadUrl: z.string(),
          expiresAt: z.date(),
        }),
      ),
    ),

  deleteCloudCopy: oc
    .route({ method: "DELETE", path: "/assets/{assetId}/cloud" })
    .input(assetParams)
    .output(apiResponseSchema(z.object({ deleted: z.boolean() }))),

  setAutoUploadExclusion: oc
    .route({ method: "POST", path: "/assets/{assetId}/auto-upload-exclusion" })
    .input(assetParams.extend({ excluded: z.boolean() }))
    .output(apiResponseSchema(cloudAssetSummarySchema)),
};
