import { defineApp } from "convex/server";
import { v } from "convex/values";
import resend from "@convex-dev/resend/convex.config.js";

const app = defineApp({
  env: {
    VANTA_CONVEX_SITE_URL: v.optional(v.string()),
    FIRECRAWL_API_KEY: v.optional(v.string()),
    GEMINI_API_KEY: v.optional(v.string()),
    VANTA_API_KEY: v.optional(v.string()),
    VANTA_API_BASE_URL: v.optional(v.string()),
    RESEND_API_KEY: v.optional(v.string()),
    RESEND_FROM_EMAIL: v.optional(v.string()),
    REVA_ADMIN_EMAIL: v.optional(v.string()),
    GEMINI_MODEL: v.optional(v.string()),
    GEMINI_BENCHMARK_MODEL: v.optional(v.string()),
    DIT_NOTIFICATION_EMAIL: v.optional(v.string()),
    DIT_ALERT_THRESHOLD_SCORE: v.optional(v.string()),
  },
});
app.use(resend);

export default app;
