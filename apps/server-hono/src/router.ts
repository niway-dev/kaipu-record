import { implement } from "@orpc/server";
import { contract } from "./contract";
import { recordingRouter } from "./modules/recording/recording.router";
import { todoRouter } from "./modules/todo/todo.router";

const impl = implement(contract).$context<{ headers: Headers }>();

export const appRouter = impl.router({
  todo: todoRouter,
  recording: recordingRouter,
});

export type AppRouter = typeof appRouter;
