import { implement } from "@orpc/server";
import { contract } from "./contract";
import { cloudRouter } from "./modules/cloud/cloud.router";
import { meRouter } from "./modules/me/me.router";
import { recordingRouter } from "./modules/recording/recording.router";

const impl = implement(contract).$context<{ headers: Headers }>();

export const appRouter = impl.router({
  me: meRouter,
  recording: recordingRouter,
  cloud: cloudRouter,
});

export type AppRouter = typeof appRouter;
