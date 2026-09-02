import { z } from "zod";
import { paginationMetaSchema } from "@kaipu/domain/schemas";

/** The `{ data, error }` envelope every oRPC route in this API responds with. */
export const errorSchema = z.object({ message: z.string() });

export const apiResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    data: dataSchema.nullable(),
    error: errorSchema.nullable(),
  });

/** The envelope for a paginated list route: `{ data, error, meta }`. */
export const paginatedApiResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    data: dataSchema.nullable(),
    error: errorSchema.nullable(),
    meta: z
      .object({
        pagination: paginationMetaSchema,
      })
      .optional(),
  });
