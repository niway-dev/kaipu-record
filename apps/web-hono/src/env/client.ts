import { parseEnv, webClientEnvSchema } from "@kaipu/infra-env";

export const env = parseEnv(webClientEnvSchema, import.meta.env);
