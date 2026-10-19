/**
 * Optional social sign-in providers. Google is registered only when both of its
 * variables are set, so the API boots (and email+password keeps working) without them.
 */
export interface SocialProviderEnv {
  GOOGLE_CLIENT_ID?: string | undefined;
  GOOGLE_CLIENT_SECRET?: string | undefined;
}

export type SocialProviders = {
  google?: { clientId: string; clientSecret: string; prompt: "select_account" };
};

/** Pure: returns `{}` unless both Google values are non-empty. */
export function buildSocialProviders(env: SocialProviderEnv): SocialProviders {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return {};
  return {
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      // People with work and personal Google accounts should pick one consciously.
      prompt: "select_account",
    },
  };
}

let warned = false;

/** Same as buildSocialProviders, plus one warning per isolate when Google is off. */
export function getSocialProviders(env: SocialProviderEnv): SocialProviders {
  const providers = buildSocialProviders(env);
  if (!providers.google && !warned) {
    warned = true;
    console.warn(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not both set; Google sign-in is disabled.",
    );
  }
  return providers;
}

/** Test hook: forget that the warning was already logged. */
export function resetSocialProvidersWarning(): void {
  warned = false;
}
