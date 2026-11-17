# Deploy: Vercel frontend + persistent API

Vercel hosts the React/Vite frontend in `dist/`. The existing Express API **must not** run with its local SQLite DB on ephemeral Vercel Functions: sessions, donor tracking codes, allocations and encrypted evidence require persistent storage. `vercel.mjs` configures an HTTPS reverse rewrite from `/api/*` to a separately hosted, persistent Express API and a SPA deep-link fallback. This is deployment preparation, not a live deployment.

## Before exposing a real domain

1. Host the Node API on a stable HTTPS origin with persistent `DB_PATH` and an independently backed-up `EVIDENCE_KEY`; do not run multiple SQLite writers. Set `NODE_ENV=production`, `DEMO_MODE=false`, `PUBLIC_ORIGIN=https://your-vercel-site.example`, `EVIDENCE_KEY`, `DB_PATH`, and bootstrap a new organization/admin. Restrict direct API access to intended clients. Configure TLS, monitoring, database/evidence backup and restore drills.
2. On Vercel, import this repository as a **Vite** project, with `npm install`, build command `npm run build`, and output directory `dist`. Set `BACKEND_ORIGIN=https://your-persistent-api.example` (bare HTTPS origin, no path or trailing segment) as a Vercel environment variable before deploying. `vercel.mjs` refuses a Vercel deployment with the variable missing. Set the backend `PUBLIC_ORIGIN` to the exact frontend origin. If previews have varying URLs, do not enable authenticated actions on preview deployments without an explicit safe origin policy.
3. Check `/api/health` through the frontend domain, log in to an account **created on the production backend**, then check a donor tracking flow with test records from a trusted bank importer. Never deploy the demo database, demo accounts, test bank transactions or local evidence key.
4. Before actual donations: obtain bank/PromptPay statement and slip verification access, create a trusted idempotent import pipeline, and prove the foundation's authorized bank account ownership. The current production API intentionally refuses the manual demo bank import; without a bank importer donors cannot claim new transfers. Validate donor ownership beyond possession of a slip reference before showing any private information. Tracking tokens currently only show non-personal allocation summaries; they are not donor identity verification.
5. Have the accountant and foundation approve the fund allocation policy and any public expense/evidence redaction rules. The current view shows aggregate approved expenditure for a matching project purpose, **not individual expense receipts** or proof that a donor's exact cash paid an item. Integrate controlled evidence publication separately before promising public receipts.

## Local verification

```bash
npm test
npm run build
npm run test:e2e
```

`vercel.mjs` is a programmatic Vercel configuration based on the official project configuration and rewrite guides. Tests verify its generated rules, but deployment itself and cookie behavior on a real Vercel domain must still be tested there. No third-party deployment credentials or live banking integration are stored in this repository.
