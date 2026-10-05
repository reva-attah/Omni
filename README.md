# Omni

Omni is Trium's venture intelligence workspace for benchmarking initiatives and scouting public market signals. Convex provides authentication, persistence, scheduled scout runs, and email audit history.

## Modules

- **Benchmarking:** accepts text and PDF, DOCX, PPTX, TXT, or Markdown briefs. It has separate precedent-benchmark and gap-driven idea flows. Gemini Search-cited peers and scores are saved only after a successful research response; the report labels source claims for verification. PDF bytes are sent to Gemini for document extraction, while supported office/text formats are extracted in the browser.
- **Continuous Scout:** scheduled jobs run the emerging-market and Nigerian policy scouts daily; an authorized operator can run both from one button. New articles receive Gemini summaries, sector and industry labels, and any grounded opportunity is screened in Omni.
- **Omni screening:** scout opportunities are scored against the seven Trium criteria. A candidate passes at 66/100 or above and Medium/High Nigeria viability. Vanta is not the screening engine.
- **Vanta duplicate checks:** Omni reads the configured Vanta portfolio and reports matching names, descriptions, counts, and similarity. If Vanta is unavailable, the result is explicitly unverified; screening can still proceed and the duplicate state is recorded as not checked. Omni does not write ideas back to Vanta.
- **DIT notifications:** passing scout candidates are queued through Resend when the DIT mailbox and sender are configured. Delivery state is recorded in the email log; a passing score alone is not proof of delivery.
- **Source Registry:** sources can be added manually or imported from Excel/CSV. The stored categories are Emerging Market, Nigerian Regulatory, Legal and Policy Environment, and Global Fallback. Omni admin approval controls activation; the legacy Vanta approval field mirrors that state.
- **Automations:** platform-managed scout and screening pipelines are listed with their triggers and actions. Custom schedules can run both scouts, the emerging-market scout, or the Nigerian policy scout from hourly to monthly intervals; schedules can be paused and resumed.

AI-generated research and assessments are preliminary. Review source citations, assumptions, and scores before investment or operating decisions.

## Local development

Requirements: Node.js 20 or newer, your own Convex account for Omni's database, and a Vanta Production account for sign-in.

```bash
npm ci
npx convex dev
```

Sign in to Convex with your own account when `npx convex dev` prompts you, then create a new Omni project/deployment. Keep that command running. In a second terminal, run:

```bash
npx @convex-dev/auth
npx convex env set REVA_ADMIN_EMAIL your-work-email@trium.ng
npx convex env set VANTA_CONVEX_SITE_URL https://precious-cheetah-613.convex.site
npm run convex:seed-sources
npm run dev
```

Set `VITE_VANTA_CONVEX_URL=https://precious-cheetah-613.convex.cloud` in your local `.env.local`; it is the public Vanta Convex endpoint used by the sign-in screen. Omni validates Vanta-issued tokens and stores app data in your own Omni Convex deployment. Set Gemini, optional Vanta portfolio API, Resend, DIT, and source-admin values server-side with `npx convex env set`; never put provider secrets in Vite variables or browser code. The Vite app runs at `http://localhost:5173` by default.

`npm run convex:seed-sources` imports the repository's curated emerging-market, global, and Nigerian regulatory source lists into the current development deployment and activates them. Plain RSS/HTML fetching works without a third-party key; Firecrawl is the authenticated fallback for JavaScript-heavy or blocked pages.

For Firecrawl, Gemini, and Resend credentials, create the keys in your own provider accounts and add them to the current Omni development deployment with `npx convex env set KEY VALUE`. Do this before running the matching features. Resend also needs a verified sender address (`RESEND_FROM_EMAIL`) and the notification destination (`DIT_NOTIFICATION_EMAIL`).

Omni sign-in uses Vanta Production email/password credentials and accepts `@trium.ng` identities. Account enrollment and password recovery remain managed by Vanta.

Use `npm run typecheck` and `npm run build` for the frontend/Convex TypeScript check and production build. Never commit `.env.local`, API keys, or deployment secrets.

## Convex environment variables

- `VANTA_API_BASE_URL` and read-scoped `VANTA_API_KEY`: live Vanta portfolio duplicate checks.
- `VANTA_CONVEX_SITE_URL`: Vanta Production issuer used to validate Omni login tokens.
- `FIRECRAWL_API_KEY`: JavaScript-rendered/blocked-page scraping fallback.
- `GEMINI_API_KEY` and optional `GEMINI_MODEL`: document extraction, cited benchmark research, scout classification, and Omni screening.
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `DIT_NOTIFICATION_EMAIL`: screening-alert delivery.
- `REVA_ADMIN_EMAIL`: source activation administrator. Use your own `@trium.ng` address.

See `.env.example` for the frontend URL variables and server-side configuration placeholders.

## Scout flow

1. The configured Omni administrator registers and activates sources.
2. Scheduled daily runs or an authorized operator crawl the active sources.
3. Gemini classifies each newly captured article and derives opportunity candidates only when supported by the article.
4. Omni scores candidates using its seven criteria; Vanta duplicate matching runs separately when configured.
5. Passing candidates are queued to DIT when email configuration is complete; the email log records delivery outcomes.
