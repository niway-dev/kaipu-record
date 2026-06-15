import { webServerEnvSchema } from "@kaipu/infra-env";

export const env = webServerEnvSchema.parse(process.env);
