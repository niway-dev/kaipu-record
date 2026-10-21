import { parseEnv, webServerEnvSchema } from "@kaipu/infra-env";

export const env = parseEnv(webServerEnvSchema, process.env);
