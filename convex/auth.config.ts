import type { AuthConfig } from "convex/server";
import { env } from "./_generated/server";

const providers: AuthConfig["providers"] = [
  {
    domain: env.CONVEX_SITE_URL,
    applicationID: "convex",
  },
];

if (env.VANTA_CONVEX_SITE_URL) {
  providers.push({
    domain: env.VANTA_CONVEX_SITE_URL,
    applicationID: "convex",
  });
}

export default { providers } satisfies AuthConfig;
