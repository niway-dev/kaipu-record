import { env as cfEnv } from "cloudflare:workers";
import { parseEnv, serverEnvSchema } from "@kaipu/infra-env";

export const env = parseEnv(serverEnvSchema, cfEnv);
