import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireConsoleAdmin } from "../lib/session.server";

export const listUsers = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      search: z.string().trim().max(200).default(""),
      page: z.number().int().min(1).max(10000).default(1),
    }),
  )
  .handler(async ({ data }) => {
    const access = await requireConsoleAdmin();
    if (access.status !== "authorized") return { ...access, data: null };
    // Load database code only after authorization, never into the browser bundle.
    const { queryUsers } = await import("../lib/users.server");
    return { ...access, data: await queryUsers(data) };
  });
