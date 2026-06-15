import { env as cfEnv } from "cloudflare:workers";
import { serverEnvSchema } from "@kaipu/infra-env";

export const env = serverEnvSchema.parse(cfEnv);
