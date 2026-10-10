# Deploy Kasa POS to Cloudflare Workers from GitHub

**Prepared:** 2026-10-10 · **Target:** the existing `Obed-Cudjoe/Kasa-POS` repository, `main` branch · **Current Worker name:** `kasa-pos`

## Current diagnostic

The public URL is reachable through Cloudflare, but it is serving a placeholder Worker rather than the Next.js/OpenNext application: `GET /`, `GET /api/health` and `GET /api/sync/pull` each returned HTTP 200 with `text/plain` body `Hello world`. The earlier build failed because it deployed without first running an OpenNext build; this was corrected in Workers Builds and the latest log shows `npm run cf:build` completed successfully. The deploy then failed because the command was entered as `npx opennextjs-cloudflare deploy --keep-var` (singular); Wrangler accepts `--keep-vars` (plural), so use exactly `npx opennextjs-cloudflare deploy --keep-vars`. The `allow-scripts` messages for `esbuild` and `workerd` were warnings, not the fatal error. The source Worker name mismatch has been corrected locally, and `.node-version` now pins Node `22.23.2`; these local changes still need to reach GitHub before they affect Cloudflare.

## Before you start

- **Revoke the GitHub personal access token you pasted earlier.** It was exposed in chat. Cloudflare Workers Builds can use its own Cloudflare-generated deployment token; do not paste GitHub, Cloudflare, Supabase or Paystack secrets into chat, GitHub source files, screenshots or build logs.
- This repo is configured for **Next.js → OpenNext → Cloudflare Workers**. Its scripts are `npm run cf:build`, `npm run cf:preview`, `npm run cf:deploy` and `npm run cf:check`; `wrangler.jsonc` sets `name: "kasa-pos"` and `workers_dev: true`. `.node-version` pins Node `22.23.2` (the package requires Node `>=22.12.0`) and npm `>=10` is required.
- In this architecture, **the Cloudflare Worker runs the Next.js app and server API routes; Supabase remains the database and Auth provider**. This does not migrate Supabase to D1.
- Cloudflare’s free `workers.dev` address is an account/Worker subdomain, **not a free custom domain that you own**. The URL will look like `https://kasa-pos.cudjoe-obed-gh.workers.dev`. Cloudflare says `workers.dev` is intended for personal/hobby projects and recommends a Worker route or custom domain rather than `workers.dev` for production/business-critical workloads. Use it for demo/staging or a controlled pilot; use your already-owned domain for general business use when ready. [1](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)

## 1. Confirm the `workers.dev` hostname

1. The account subdomain already in use is `cudjoe-obed-gh.workers.dev`; the Kasa Worker hostname is `https://kasa-pos.cudjoe-obed-gh.workers.dev`.
2. In Cloudflare **Workers & Pages**, confirm the `kasa-pos` service has `workers.dev` enabled and this exact hostname assigned.
3. The source `wrangler.jsonc` sets both the Worker name and self-service binding to `kasa-pos` to match this hostname. Keep the dashboard Worker name and `wrangler.jsonc` synchronized. Worker names used on `workers.dev` must be DNS-label compatible and at most 63 characters. [1](https://developers.cloudflare.com/workers/wrangler/configuration/)


## 2. Prepare a non-production Supabase project first

Do this before setting `NEXT_PUBLIC_DEMO_MODE=false` or exposing real staff logins.

1. Create a **separate staging Supabase project** for the first deployment. Keep Supabase; do not create a D1 database for this current app.
2. In that project’s SQL Editor, review and apply the repo migrations **in order**, one file at a time:
   1. `supabase/migrations/001_pos_schema.sql`
   2. `supabase/migrations/002_pos_sync_and_payment_functions.sql`
   3. `supabase/migrations/003_privacy_controls.sql`
   4. `supabase/migrations/004_employee_refund_limits.sql`
3. Verify tables, RLS policies and the service-role-only RPC grants. Migrations `003` and `004` are required by the current consent/refund-limit features; they have not yet been applied or verified on a Supabase project.
4. Create an owner account in **Supabase → Authentication → Users**. Create the store and owner employee row using a reviewed onboarding process and link `employees.auth_user_id` to the Auth user UUID. The POS Team screen **does not send invitations or create Auth accounts**; additional staff accounts must also be created in Auth and linked to employee rows.
5. Set `POS_STORE_ID` to the UUID of the store created in that project. The optional `scripts/seed-store.sql` is only an example: it has UUID placeholders and illustrative, unverified Ghana tax rates. Do not run it as-is or use those tax rates for live sales. Have an accountant/GRA adviser confirm the actual categories, rates, registrations and receipt obligations.
6. Set the owner’s and staff members’ refund limits in the production/staging employee records. The demo defaults are not cloud production defaults; migration `004` gives existing/new rows a zero ceiling unless configured.

Supabase Auth’s **Site URL** controls default redirects used for confirmations and password recovery. Set it to the final Worker URL and allow only the exact production redirect URLs needed by your app. [1](https://supabase.com/docs/guides/auth/redirect-urls)

## 3. Connect the GitHub repository using Workers Builds

Cloudflare’s Git-connected build configuration is under **Worker → Settings → Build**; builds run a build command and then a deploy command on pushes to the selected branch. Build variables/secrets are **build-time only**; runtime values belong under **Settings → Variables & Secrets**. [1](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)

1. If no Worker has been created yet, open **Workers & Pages → Create application → Workers → Connect to Git** (wording can vary slightly by dashboard). Select the connected GitHub account and `Obed-Cudjoe/Kasa-POS`.
2. If a Worker already exists, open it and choose **Settings → Build → Connect to Git**.
3. Choose production branch **`main`**. Root directory is the repository root (leave the root-directory field empty or `/`). Do not choose Pages for this project; it is a server-rendered Worker app.
4. In **Settings → Build**, set the build image’s Node version to **`22.23.2`** (build variable `NODE_VERSION=22.23.2`; `22` is also acceptable if the dashboard expects a major version). The Workers Builds image documents Node 22.23.2 as preinstalled and supports selecting the version via `NODE_VERSION`, `.nvmrc` or `.node-version`. [1](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)
5. Set commands exactly as follows:

   ```text
   Build command:  npm run cf:build
   Deploy command: npx opennextjs-cloudflare deploy --keep-vars
   ```

   This separates the OpenNext build from its Cloudflare deploy. Do **not** set `npm run cf:deploy` as the deploy command while also using `npm run cf:build` as the build command: the repo’s `cf:deploy` script builds again. Do not rely on the generic Next.js `npm run build` alone; it is not the Cloudflare OpenNext bundle.
6. For the first staging release, disable branch/PR preview deployments unless you have separately configured preview Supabase resources and preview secrets. Preview URLs can otherwise expose test data publicly.
7. Save the build settings. After the first deploy, Workers Builds will rebuild/deploy when a new commit reaches `main`. Do not add secrets to the GitHub repository. Cloudflare can automatically provision its own token for Workers Builds. [1](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)

## 4. Configure build-time public values and runtime settings

Use the full `workers.dev` URL from Step 1. Set these **before the build that should switch the UI out of demo mode**.

### Workers Builds → Build variables

These are required by the browser bundle and must be available when Next.js builds:

```text
NODE_VERSION=22.23.2
NEXT_PUBLIC_DEMO_MODE=false
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<Supabase publishable/anon key>
NEXT_PUBLIC_APP_URL=https://kasa-pos.cudjoe-obed-gh.workers.dev
```

`NEXT_PUBLIC_SUPABASE_ANON_KEY` is intentionally public, but only safe when the database’s RLS and authorization are correctly configured. Do not put the service-role key in a `NEXT_PUBLIC_` variable. If the staging project/user setup is not ready, keep `NEXT_PUBLIC_DEMO_MODE=true` and use the deployment only as a demo.

### Worker → Settings → Variables & Secrets (runtime)

Add non-secret **Variables**:

```text
NEXT_PUBLIC_DEMO_MODE=false
NEXT_PUBLIC_APP_URL=https://kasa-pos.cudjoe-obed-gh.workers.dev
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<same publishable/anon key>
POS_STORE_ID=<store UUID from the staging project>
```

Add these as **Secrets** only when needed:

```text
SUPABASE_SERVICE_ROLE_KEY=<server-only Supabase service role key>
```

Optional managed receipt-email secret/config (only if configured and tested): `RESEND_API_KEY` as a Secret and `RECEIPT_FROM_EMAIL` as a Variable.

**Payment warning:** do not add a live `PAYSTACK_SECRET_KEY` yet. After merchant onboarding, add a **test** Paystack key as a Worker Secret for authorized staging tests. Add live keys only after the payment/inventory, webhook, tax, privacy and merchant acceptance gates below are closed. Never expose `SUPABASE_SERVICE_ROLE_KEY`, `PAYSTACK_SECRET_KEY` or `RESEND_API_KEY` to browser code or GitHub. Cloudflare’s docs distinguish build-only values from runtime secrets and advise using Secrets rather than plaintext variables for sensitive values. [1](https://developers.cloudflare.com/workers/configuration/secrets/) [2](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)

## 5. Configure Supabase Auth URLs

In **Supabase → Authentication → URL Configuration**:

- Set **Site URL** to `https://kasa-pos.cudjoe-obed-gh.workers.dev`.
- Add the exact production URL/path(s) used by your sign-in/confirmation/reset flow to the redirect allow list. Prefer exact URLs over broad wildcards for production.
- When moving from `workers.dev` to your existing custom domain, update the Site URL, redirect allow list, `NEXT_PUBLIC_APP_URL` and Worker build value, then rebuild/redeploy.

The current app uses Supabase password sign-in. Supabase documents that Site URL is the default destination for confirmation/recovery flows and that production redirect URLs should be exact. [1](https://supabase.com/docs/guides/auth/redirect-urls)

## 6. Deploy and verify staging

1. Save Cloudflare Build settings and ensure staging build/runtime values are in place.
2. Trigger the first deploy from the Workers Builds page, or push a reviewed commit to `main`. Watch **Worker → Builds** until both build and deploy succeed.
3. Open the `workers.dev` URL shown in the deployment summary. With the app out of demo mode, open:

   ```text
   https://kasa-pos.cudjoe-obed-gh.workers.dev/
   https://kasa-pos.cudjoe-obed-gh.workers.dev/api/health
   ```

4. Run the repository smoke check after deployment:

   ```text
   npm run cf:check -- https://kasa-pos.cudjoe-obed-gh.workers.dev
   ```

   It fails if the homepage is still a generic Worker, `/api/health` is not JSON, or the app is in demo/missing-cloud-config mode. For the health response, require at least:

   ```json
   {"ok":true,"mode":"configured","cloudConfigured":true,"paymentsConfigured":false}
   ```

   `paymentsConfigured:false` is expected before a test Paystack Secret is configured. If `mode` is `demo` or `cloudConfigured` is `false`, **do not onboard staff**; correct the build/runtime settings first. Health is a configuration check, not a security or payment-readiness certification.
5. Sign in as the staging owner and verify the employee identity/role, product and tax data, refund limit, sync, cash flow and audit behavior using synthetic transactions. Test on the target tablet/phone and with a second device before a real-store pilot. Watch **Workers → Observability/Logs** and Supabase logs; do not log customer contacts or payment secrets.
6. If using Paystack in staging, test only with a merchant-approved test account/key. Configure its webhook as:

   ```text
   https://kasa-pos.cudjoe-obed-gh.workers.dev/api/webhooks/paystack
   ```

   Validate signed webhooks, duplicate delivery, delayed/failing refunds and provider reconciliation. Never treat a redirect, screenshot or customer claim as proof of payment.

## 7. What must be fixed before real sales

A successful deployment only makes the app reachable. **This repository is not yet approved for real-money POS use.** Before onboarding live merchants/customers:

- Apply and test Supabase migrations `001`–`004` with real staging Auth roles, RLS and refund limits.
- Complete merchant-specific Ghana tax, receipt/fiscalization, privacy/Act 843, DPC, data-retention, processor-transfer and consent work. The privacy page still has placeholders; the demo tax rates are unverified.
- Provision and link every real employee to Supabase Auth. The Team UI does not issue invitations.
- Fix and test the high-priority inventory issue: the inspected `confirm_paystack_payment` SQL applies stock deltas for confirmed digital sales but does not reserve inventory while a digital payment is pending or persist the same stock-review conflict as the offline sync path. Concurrent paid digital orders may oversell. Do not enable live card/MoMo payments until this is resolved and tested against isolated PostgreSQL/Supabase.
- Perform actual Paystack test-key transaction/refund/webhook tests and a provider reconciliation exercise; obtain merchant onboarding before any live key.
- Complete separate-device/offline sync, printer/device, backup/restore, access-revocation and incident-response tests. Browser IndexedDB is not encrypted at the application layer; require suitable device encryption and screen-lock controls.

## 8. Free-tier and domain expectations

Cloudflare Workers Free currently includes **100,000 requests/day** and **10 ms CPU per invocation**. The Worker’s network waiting time does not count as CPU, but Next.js server rendering/API code does; monitor real traffic and Worker CPU before a pilot. The Workers Paid plan has a **$5/month account minimum** and includes 10 million requests/month plus 30 million CPU-ms; usage beyond included amounts is billed. Supabase, email-provider charges and custom-domain renewal are separate, so a $5 total-hosting ceiling is not guaranteed by deploying to Cloudflare. [1](https://developers.cloudflare.com/workers/platform/pricing/) [2](https://developers.cloudflare.com/workers/platform/limits/)

The `workers.dev` address itself needs no custom-domain purchase or DNS zone, but Cloudflare describes it as a free-site route for non-business-critical projects. Since a POS can be business-critical, use it for staging/controlled pilot and plan to attach your already-owned domain before general production use. Domain registration/renewal remains separate.

## Source links

- Cloudflare Workers Builds settings and commands: [1](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- Cloudflare Workers Builds Node version: [1](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)
- Cloudflare Workers secrets: [1](https://developers.cloudflare.com/workers/configuration/secrets/)
- Cloudflare `workers.dev` routing and production guidance: [1](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
- Cloudflare pricing and limits: [1](https://developers.cloudflare.com/workers/platform/pricing/) [2](https://developers.cloudflare.com/workers/platform/limits/)
- Cloudflare’s current Next.js guidance (vinext is recommended for new setups; existing OpenNext path is still documented): [1](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)
- Supabase Auth redirect URLs: [1](https://supabase.com/docs/guides/auth/redirect-urls)
- Supabase production checklist: [1](https://supabase.com/docs/guides/platform/going-into-prod)
