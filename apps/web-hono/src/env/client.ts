import { webClientEnvSchema } from "@kaipu/infra-env";

export const env = webClientEnvSchema.parse(import.meta.env);
