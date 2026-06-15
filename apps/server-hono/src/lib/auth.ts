import { baseConfig, getCustomSession } from "@kaipu/infra-auth";
import { betterAuth } from "better-auth";
import { customSession } from "better-auth/plugins";
import { env } from "../env";

export const auth = betterAuth({
  ...baseConfig,
  trustedOrigins: [...env.CORS_ORIGIN],
  plugins: [...(baseConfig.plugins ?? []), customSession(getCustomSession, baseConfig)],
});
