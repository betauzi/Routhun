# Deploy: static showcase now, persistent API later

This repository supports **two separate Vercel modes** selected by `BACKEND_ORIGIN` in `vercel.mjs`. Neither mode is a real banking integration or proof of a real Ethereum transaction.

## A. No backend: static, read-only showcase (recommended for a public demo)

1. Push the updated source to the branch linked to Vercel. In the Vercel project, **do not set `BACKEND_ORIGIN`** (remove any placeholder or empty override). Leave the Build Command override unset so `vercel.mjs` selects `npm run build:demo`; if your Vercel project overrides the command, set it explicitly to `npm run build:demo`. Framework: Vite; output: `dist`.
2. Redeploy the project. At build time, `scripts/generate-static-demo.mjs` creates a **fresh in-memory database seeded only with fictional cases** and exports a static JSON snapshot. It never uses the project's `DB_PATH` or exports password hashes, session cookies or evidence bytes. Vite copies `demo-data.json` into the static site. There is no API server at runtime and no `/api/*` rewrite.
3. Open the site and choose a sample role on the login screen (5 sample accounts for มูลนิธิแสงใหม่; the shared demo password is `RouthunDemo2027!`). Role selection persists **within this browser tab** using `sessionStorage`; it is not a secure login, and all bundled synthetic data is publicly retrievable. A visitor can view role-specific sample screens, 19 foundations, and 57 repeatable sample scenarios.
4. The showcase is deliberately **read-only**: no bank uploads, donor claims/tracking tokens, allocations, approvals, password changes, team management or Ethereum anchoring. The UI labels this limitation and hides write controls. It does not accept real donation details. Never put real people, real bank records, secrets, or private evidence in the synthetic build.

Local check:

```bash
npm install
npm test
npm run build:demo
npx vite preview --host 127.0.0.1 --port 4173
```

To run the browser flow test while preview is running, use `npm run test:demo:e2e` (the test defaults to Microsoft Edge on Windows; set `EDGE_PATH` for another executable). The generated `public/demo-data.json` and `dist/` are ignored by Git. A rebuild regenerates the synthetic snapshot, so its identifiers/timestamps may change.

## B. Later: frontend + separately hosted, persistent Express API

1. Host the Node API on a stable HTTPS origin with persistent `DB_PATH` and an independently backed-up `EVIDENCE_KEY`; do not run multiple SQLite writers. Set `NODE_ENV=production`, `DEMO_MODE=false`, `PUBLIC_ORIGIN=https://your-vercel-site.example`, `EVIDENCE_KEY`, `DB_PATH`, and bootstrap an organization/admin. Restrict direct API access to intended clients. Configure TLS, monitoring, database/evidence backup and restore drills.
2. On Vercel set `BACKEND_ORIGIN=https://your-persistent-api.example` as an Environment Variable for the correct deployment environments. Use a **bare HTTPS origin**, not `/api` or a URL with a path. `vercel.mjs` then selects `npm run build` and an HTTPS rewrite from `/api/*` to that API. Remove any project-level Build Command override that still forces `build:demo`. Set the backend `PUBLIC_ORIGIN` to the exact frontend origin. Preview URLs need an explicit safe origin policy before enabling authenticated actions.
3. Redeploy after any Vercel environment variable change. Check `/api/health` through the frontend domain, log in to an account created on the production backend, then check a donor-tracking flow with test records from a trusted bank importer. **Do not deploy the demo database, demo accounts, test bank transactions, or a local evidence key.**
4. Before real donations: obtain authorized bank/PromptPay statement and slip verification access, create a trusted idempotent import pipeline, and prove ownership of the foundation's bank account. The current production API intentionally refuses manual demo bank imports; without a trusted importer donors cannot claim new transfers. Validate donor ownership beyond possession of a slip reference before showing private information. Tracking tokens currently show only non-personal allocation summaries; they are not identity verification.
5. Have the accountant and foundation approve fund allocation policy and public expense/evidence redaction rules. The view shows aggregate approved expenditure for a matching project purpose, **not individual expense receipts** or proof that a donor's exact cash paid an item. Integrate controlled evidence publication separately before promising public receipts.

`vercel.mjs` provides both build modes. Tests verify its generated rules and a local browser exercise verifies the static showcase. A successful **live Vercel deployment** and cookie behavior on a live domain still require separate verification. No third-party deployment credentials or live banking integration are stored in this repository.
