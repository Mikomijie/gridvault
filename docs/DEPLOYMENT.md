# Free public demo deployment

Use Vercel Hobby for the frontend and two Render Free web services for the API
and witness. No paid plan, persistent disk, paid database, or custom domain is
needed. The root render.yaml now also specifies Free for both services.

Render Free services sleep after 15 minutes without incoming traffic and can take
about a minute to wake. Local SQLite data and witness receipts disappear on
spin-down, restart or redeploy. The API recreates fictional patients when its
database is empty. Visitor edits and sessions are temporary.

The steps below create services manually; do not also create a Blueprint.

## 1. Push your changes to GitHub

From the project terminal:

```sh
git status
git add .env.example .gitignore README.md backend frontend witness docs scripts/copy-runtime-assets.mjs render.yaml test
git commit -m "Prepare free public demo deployment"
git push origin main
```

The configured repository is https://github.com/Mikomijie/gridvault.
Do not commit secret values or .env files.

## 2. Generate your secrets

Run this locally. Save the output privately for the Render environment forms:

```sh
node -e "const c=require('node:crypto'); console.log(JSON.stringify({GRIDVAULT_MASTER_KEY:c.randomBytes(32).toString('base64'),JWT_SECRET:c.randomBytes(48).toString('hex'),WITNESS_API_KEY:c.randomBytes(32).toString('hex'),NODE_SIGNING_KEY:c.generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64')},null,2))"
```

Never put these values in Vercel or any VITE_* variable.

## 3. Create the witness on Render

Render dashboard -> New -> Web Service -> connect Mikomijie/gridvault.

| Setting | Value |
| --- | --- |
| Name | gridvault-demo-witness |
| Branch | main |
| Region | Frankfurt |
| Language/runtime | Node |
| Root Directory | Leave empty |
| Build Command | npm ci --include=dev && npm run build --workspace=witness |
| Start Command | npm run start --workspace=witness |
| Instance Type | Free |
| Health Check Path | /health |

Add environment variables:

```dotenv
NODE_VERSION=22
NODE_ENV=production
WITNESS_DATA_PATH=/tmp/gridvault-demo-anchors.jsonl
WITNESS_API_KEY=<generated WITNESS_API_KEY>
```

Do not add a disk or database. Deploy, then copy the actual HTTPS URL from Render.
Open its /health URL and wait until it returns JSON. Although the health response
calls the file-backed store "durable", its /tmp filesystem on Free is temporary.

## 4. Create the API on Render

New -> Web Service -> the same repository.

| Setting | Value |
| --- | --- |
| Name | gridvault-demo-api |
| Branch | main |
| Region | Frankfurt |
| Language/runtime | Node |
| Root Directory | Leave empty |
| Build Command | npm ci --include=dev && npm run build --workspace=backend |
| Start Command | npm run start --workspace=backend |
| Instance Type | Free |
| Health Check Path | /api/health/ready |

Add environment variables, replacing angle-bracket placeholders:

```dotenv
NODE_VERSION=22
NODE_ENV=production
PUBLIC_DEMO=true
DEMO_MODE=true
ALLOW_INSECURE_HTTP=true
DATABASE_PATH=/tmp/gridvault-demo.db
GRIDVAULT_MASTER_KEY=<generated GRIDVAULT_MASTER_KEY>
JWT_SECRET=<generated JWT_SECRET>
NODE_SIGNING_KEY=<generated NODE_SIGNING_KEY>
WITNESS_API_KEY=<same generated WITNESS_API_KEY as the witness>
WITNESS_URL=<actual witness HTTPS URL, no trailing path>
```

Render supplies PORT automatically. Leave CORS_ALLOWED_ORIGINS unset for now.
ALLOW_INSECURE_HTTP acknowledges the internal HTTP listener; Render provides
HTTPS for public requests.

Deploy, then open the API's /api/health/ready URL and wait for HTTP 200.
First startup creates the fictional patients and shared staff accounts.
Demo-only duty extensions allow evaluation at any hour without freezing clocks.

## 5. Put the API URL in the frontend and push again

Open frontend/vercel.json. Replace only:

```text
https://REPLACE-WITH-YOUR-API.onrender.com/api/:path*
```

with your actual API URL, keeping /api/:path* at the end. Then:

```sh
git add frontend/vercel.json
git commit -m "Connect frontend to hosted demo API"
git push origin main
```

Both Render services may redeploy after this push; wait for readiness again.

## 6. Deploy on Vercel

Use a personal Vercel account on the Hobby plan for this non-commercial demo.

Add New -> Project -> import Mikomijie/gridvault.

| Setting | Value |
| --- | --- |
| Framework Preset | Vite |
| Root Directory | frontend |
| Build Command | npm run build |
| Output Directory | dist |
| Node.js Version | 22.x |

Keep the detected npm install command. Enable access to files outside the Root
Directory if Vercel shows that option; this project uses the root workspace lockfile.

Add one frontend environment variable:

```dotenv
VITE_PUBLIC_DEMO=true
```

Do not add VITE_API_BASE_URL. If it already exists, remove it. The frontend must
call /api on its own origin through the Vercel rewrite so refresh cookies work.

Deploy and copy the final https://...vercel.app URL. The default domain is sufficient.

## 7. Finish the connection

In Render -> API service -> Environment, add:

```dotenv
CORS_ALLOWED_ORIGINS=https://YOUR-PROJECT.vercel.app
```

Use the exact Vercel origin with no trailing slash. Save and redeploy.

Before demonstrating, open the witness /health and API /api/health/ready URLs to
wake them. Then open the Vercel site, go to /login, select a demo account and sign
in. PINs are shown beside the accounts. Reload an authenticated page to check
session restoration. Never enter real personal or medical data.

## Free-plan behavior and limits

- The two Render services share 750 free instance hours per workspace per month.
  If both ran continuously, they would exhaust that allowance before month-end.
  Let idle services sleep; do not install keep-alive pingers.
- Select Free for each service and Hobby for each personal workspace/account.
  Avoid adding payment methods to Render for this demo: without one, included
  usage exhaustion suspends services or builds instead of billing overages.
  If Render requires payment verification for your account, pause and review
  that requirement; these instructions do not authorize paid resources.
- Vercel Hobby is for personal, non-commercial use and has usage limits.
- Free storage is temporary. The witness and API may reset independently; audit
  anchoring can therefore report missing/stale receipts. It is not durable audit
  custody. If a demo reset leaves the pair inconsistent, redeploy both services
  and verify their health before demonstrating again.
- Offline queue replay after a server reset is not guaranteed to work against
  newly seeded records. Clear the demo site's local browser data if needed, then
  sign in again; doing so discards any locally queued demo observations.
- External SMS/email delivery, automatic backups, and scheduled anchoring are
  not enabled. Offline reload cannot restore an authenticated session.
- No paid persistent storage is required or configured.

## Verification status

Production and demo frontend builds, typechecking and lint passed locally
(lint has warnings). Fifteen focused configuration, service-worker isolation
and witness tests passed. Full API runtime and hosted browser checks remain
unverified because the local SQLite/Node installation was blocked. The local
dependencies were installed with lifecycle scripts skipped; complete npm ci
under Node 22 before running the API or full suite locally.

Official references: [Render Free](https://render.com/docs/free),
[Vercel Hobby](https://vercel.com/docs/plans/hobby),
[Vercel Vite](https://vercel.com/docs/frameworks/frontend/vite).
