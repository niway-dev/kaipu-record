import alchemy from "alchemy";
import { TanStackStart } from "alchemy/cloudflare";
import { CloudflareStateStore } from "alchemy/state";
import { config } from "dotenv";

config({ path: ".env" });

const app = await alchemy("monorepo-template", {
  password: alchemy.env.ALCHEMY_PASSWORD,
  stateStore:
    alchemy.env.ENVIRONMENT === "production"
      ? (scope) =>
          new CloudflareStateStore(scope, {
            stateToken: alchemy.secret(alchemy.env.CLOUDFLARE_API_TOKEN),
            accountId: alchemy.env.CLOUDFLARE_ACCOUNT_ID,
          })
      : undefined,
});

export const web = await TanStackStart("web", {
  bindings: {
    VITE_SERVER_URL: alchemy.env.VITE_SERVER_URL,
  },
});

console.log(`Web    -> ${web.url}`);

await app.finalize();
