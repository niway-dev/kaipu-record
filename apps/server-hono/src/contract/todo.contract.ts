import { z } from "zod";
import { oc } from "@orpc/contract";
import {
  todoBaseSchema,
  createTodoSchema,
  updateTodoSchema,
  paginationQuerySchema,
} from "@kaipu/domain/schemas";
import { apiResponseSchema, paginatedApiResponseSchema } from "./shared.contract";

export const todoContract = {
  list: oc
    .route({ method: "GET", path: "/todos" })
    .input(paginationQuerySchema)
    .output(paginatedApiResponseSchema(z.array(todoBaseSchema))),

  get: oc
    .route({ method: "GET", path: "/todos/{id}" })
    .input(z.object({ id: z.string() }))
    .output(apiResponseSchema(todoBaseSchema)),

  create: oc
    .route({ method: "POST", path: "/todos", successStatus: 201 })
    .input(createTodoSchema)
    .output(apiResponseSchema(todoBaseSchema)),

  update: oc
    .route({ method: "PUT", path: "/todos/{id}" })
    .input(updateTodoSchema.extend({ id: z.string() }))
    .output(apiResponseSchema(todoBaseSchema)),

  delete: oc
    .route({ method: "DELETE", path: "/todos/{id}" })
    .input(z.object({ id: z.string() }))
    .output(apiResponseSchema(z.object({ success: z.boolean() }))),
};
