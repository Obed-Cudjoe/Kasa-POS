# Kasa POS · Offline-first retail MVP

A tablet-first POS MVP starter for a small independent retailer. It uses Next.js App Router, TypeScript, Supabase PostgreSQL/Auth, Dexie/IndexedDB, a PWA service worker and Next.js Route Handlers. The UI is designed for tablet landscape, with a collapsed phone layout.

> **Important delivery boundary:** this workspace contains a runnable local project, Cloudflare Workers/OpenNext configuration, and starter migrations. It has **not** been published to GitHub, deployed to Cloudflare Workers, connected to a live Supabase project, or tested with a real payment merchant account. No Cloudflare account access, production credentials, domain configuration, or merchant onboarding were supplied. Demo payment buttons are simulations only. Do not use demo tax figures or receipts for live trade.

## What works in the local demo

- Installable PWA experience after a production build; cached app shell/offline fallback.
- Dexie-backed products, tax profiles, inventory, orders, payments, refunds, employee profiles, shifts and an outbox.
- Seeded demo store with 24 products, inclusive/exclusive prices, standard/zero-rated/exempt demo profiles, inventory, transactions, refunds and open/closed shifts.
- Catalog search/category filters, add/remove quantities, per-line tax detail and cart tax totals.
- Checkout within three taps from a ready cart: open checkout → choose tender → record/request. Cash change is calculated automatically.
- Offline cash sale recording. Offline digital-payment attempts remain **pending**, with no stock deduction and no claim of payment success. Production cloud profiles require a device-local 6–8 digit PIN to unlock cached access offline.
- Clearly labelled simulated card/MoMo demo transactions. They do not contact a PSP or move money.
- Transaction history and full/partial refund UI. Refunds enforce the employee’s configured per-transaction GHS limit (zero disables refunds; only an owner can change limits; only an owner profile may be uncapped). Accepted saleable items are restocked; digital reversals remain pending until provider confirmation.
- Product, tax, inventory count, team-role/refund-limit, shift open/close and drawer reconciliation screens.
- Versioned privacy-notice template at `/privacy`, explicit customer-agreement checkboxes for payment contact and managed receipt email, and a minimized cloud consent audit that stores no email address or phone number.
- Local sales/tax dashboard based on saved transaction-time tax snapshots.
- GHS is the sale/reporting base. A user-entered USD/EUR/KES reference rate can be displayed, but is never used as settlement currency.
- PDF export, browser print, native share/mail fallback, and optional server-side receipt email.
- ESC/POS Bluetooth/USB transport hooks with browser/device limitations and PDF fallback.
- Supabase sync route skeleton with authenticated role checks, UUID event idempotency, an append-only inventory movement ledger, additive stock projection updates and stale physical-count conflicts.
- Paystack adapter for Ghana card and mobile-money requests, HMAC-verified webhooks, server-side transaction verification, timeouts and provider refund status handling.

## Not included / not certified

- No live PSP charge, webhook, refund, Cloudflare Worker deployment, Supabase migration execution, GitHub publication or merchant settlement has been verified from this workspace.
- Paystack is the implemented Ghana adapter. Flutterwave is not wired in this project; use an adapter for it if merchant onboarding/market coverage requires it. Provider channel support must be checked against the specific merchant account.
- Demo “Confirm” records are intentionally stored as `demo_simulated`; they are not provider-confirmed sales.
- Demo Ghana tax components are illustrative and **unverified**. They are not legal advice and do not establish VAT registration, correct effective rates, GRA E-VAT/CIS certification or a certified fiscal receipt.
- The local team screen saves employee/role records but does not send Auth invitations. Production staff need a Supabase Auth account linked to an employee row. Refund limits require the reviewed migration `004_employee_refund_limits.sql`; existing staff default to zero and an owner must configure them before live refunds.
- The privacy page is a template with controller-contact placeholders. The consent audit requires migration `003_privacy_controls.sql`; data-subject requests use a documented manual manager procedure, not a self-service deletion tool. Neither the template nor checklist proves Act 843 compliance or DPC registration.
- The device-local demo role chooser is not an authentication control. Production uses Supabase Auth for online access; offline unlock is limited to the last cached employee and a 6–8 digit device PIN (salted PBKDF2 hash). This PIN is not cloud authentication, IndexedDB business data is not encrypted at rest, and signing out clears the cached profile/PIN. Protect shared devices with OS full-disk encryption and a strong screen lock.
- Discounts, split tender, loyalty, multi-location, barcode scanning, kitchen display, table management, online ordering and franchise workflows remain out of the MVP scope.

## Requirements

- Node.js **22.12+** and npm **10+** for the Cloudflare OpenNext/Wrangler toolchain. (Next.js itself supports Node 20.9+, but this project's Cloudflare commands require Node 22.)
- For printer testing: HTTPS or localhost, a supported Chromium browser, and a tested ESC/POS printer/device combination.

## Run the demo

```bash
cd pos-mvp
npm ci
npm run dev
```

Open the printed local URL. Choose a demo employee:

- **Ama Mensah · Cashier** — checkout, history and shift tasks.
- **Kojo Owusu · Manager** — product, inventory, refund and reporting controls.
- **Akosua Boateng · Owner** — all demo screens.

Try a sale: **Checkout → tap products → Checkout → Cash → Record cash sale**. Enter more than the total to see the change calculation. Switch to the Manager demo profile to open a sale in **Transactions** and try a partial return.

The local demo seeds in IndexedDB (Dexie). Reset it from **Settings → Reset demo workspace**. Clearing browser/site data deletes local demo transactions; do not clear storage for a real offline store before syncing/backing up.

### PWA and offline test

The service worker is disabled in development to avoid caching stale development bundles. Build and run production locally to test PWA installation and service-worker behavior:

```bash
npm run build
npm start
```

Then open the site, wait for the service worker to install, use the browser’s **Install app / Add to Home Screen** control, and test from the installed app. Use browser DevTools Network → Offline after the first online load. Catalogue/checkout pages use the local database; record a cash sale and confirm it appears locally. A digital tender must remain pending while offline.

The service worker caches the app shell/static assets and an offline navigation fallback. Authenticated business API responses are not placed in a shared service-worker cache. Product/transaction records are stored separately in IndexedDB.

## Quality commands

```bash
npm test
npm run typecheck
npm run lint
npm audit
npm run build
npm run cf:build
npm run cf:preview
```

Run commands serially if a production build is regenerating `.next/types` while TypeScript runs. The Vitest suite uses `fake-indexeddb` and mocked HTTP; passing results are local simulations, not live Supabase, PSP, offline-browser, multiple-device or hardware verification. A generated service worker is written to `public/sw.js` during production build and is ignored by Git; it is regenerated from `src/app/sw.ts`. Cloudflare scripts require Node 22.12+.

## Architecture and important files

```text
src/app/                         App Router UI, PWA manifest and Route Handlers
src/components/pos-app.tsx       Tablet/phone POS UI and local demo/login flows
src/lib/types.ts                 Shared offline-first domain types
src/lib/tax.ts                   Inclusive/exclusive and component tax calculation
src/lib/local-db.ts              Dexie/IndexedDB tables and migrations
src/lib/offline-pin.ts           Device-local PBKDF2 PIN hashes for cached offline unlock
src/lib/pos-ops.ts               Atomic local sale/refund/stock/shift operations
src/lib/sync-client.ts           Outbox push and cloud snapshot pull
src/lib/receipt.ts               PDF, native share and ESC/POS transports
src/lib/cloud.ts                 Server-side auth/role checks and service client
src/lib/privacy.ts               Consent-purpose and privacy-notice version
src/app/privacy/page.tsx         Merchant-specific privacy notice template
src/app/sw.ts                    Serwist shell/static caching and offline fallback
supabase/migrations/001_pos_schema.sql  Supabase tables, RLS and indexes
supabase/migrations/002_pos_sync_and_payment_functions.sql  Idempotent sync/stock/payment RPCs
supabase/migrations/003_privacy_controls.sql  Minimal consent audit (no contact address/phone)
supabase/migrations/004_employee_refund_limits.sql  Per-employee per-transaction refund limit
scripts/seed-store.sql           Optional small-cloud-store onboarding seed example
```

### Offline sync and inventory

- A local order/stock/shift/refund write is committed to IndexedDB before any cloud request.
- UUID outbox events are pushed through an authenticated Route Handler; the database `sync_events` key makes retries idempotent. The signed-in app drains the queue when connectivity/session returns and polls every 20 seconds while open. If the browser/PWA is fully closed, sync waits until the next open; no authenticated Service Worker background job is claimed.
- Cloud PostgreSQL is the only cloud database. Dexie is the on-device offline store.
- Sale, return, receiving and damage movements are signed deltas; the cloud stock projection adds deltas under row locks, avoiding last-write-wins loss.
- Physical counts carry a `base_inventory_version`. If stock changed since the count started, the server rejects that count for review instead of overwriting newer sales/returns. A negative projected balance from concurrent/offline sales is retained and flagged for review.
- Supabase Realtime notifications are invalidation hints; the client pulls the latest scoped snapshot.

### Tax and receipts

Products can use inclusive or exclusive prices and a tax category with same-base or compound components. Each transaction line stores its rate/tax breakdown snapshot. Old sales are not recalculated when a rate changes. The app’s application-level tax calculation is not a substitute for accountant/GRA review or official fiscal-device/E-VAT certification.

The receipt screen can download a PDF, use the browser print dialog, invoke the device share sheet (including mail where supported), or try ESC/POS Bluetooth/USB. Bluetooth and USB access is browser/device-specific, requires a secure context and a user gesture, and may not be available in Safari/iOS or some Android browser builds. Use browser print/PDF if pairing or printing fails. Managed email requires `RESEND_API_KEY` and a verified `RECEIPT_FROM_EMAIL`; otherwise the app falls back to native share/PDF and does not claim managed delivery.

### Privacy, consent and refunds

The app requires an explicit staff attestation that the customer agrees to the payment-contact purpose before sending an email/phone to the payment provider. Managed email also requires confirmation that the customer requested the receipt. The cloud consent audit stores only order/staff IDs, purpose, notice version and time; the entered contact address is not included in that audit or local order. The relevant server routes also check for the consent record before forwarding contact details.

The owner sets each employee’s per-transaction refund ceiling in GHS. `0` means no refund authority; a positive number is a finite maximum; blank/no cap is permitted only for an owner profile. The client checks the amount, and cloud sync/provider refund-submission routes re-check against the employee record. Status-only refund reconciliation remains available to authorized store users so a later limit change cannot strand a pending provider refund. Until migration `004` is installed, cloud refund-limit authorization is not ready. A new cloud store starts with a zero limit, so the owner must configure limits before use. The local demo seed uses cashier `0`, manager `50,000` pesewas (GHS 500.00), and owner `Number.MAX_SAFE_INTEGER` pesewas; the seed upgrade migrates the previous demo-only defaults while preserving non-legacy custom values.

The privacy notice at `/privacy` is a template. Replace every controller contact placeholder, set the lawful basis and retention schedule, review third-party terms/data transfers, and confirm DPC registration and other legal obligations before production. Data-subject requests are handled by a documented manager process; there is no in-app deletion workflow. The local IndexedDB remains unencrypted at the application layer.

## Supabase setup for a real store

1. Create a Supabase project and an Auth user for the owner.
2. Apply migrations in order (`001_pos_schema.sql`, `002_pos_sync_and_payment_functions.sql`, `003_privacy_controls.sql`, `004_employee_refund_limits.sql`) using Supabase CLI or the SQL editor after review. The starter schema has **not** been run against a live Supabase instance here. The consent and refund-limit routes require migrations `003` and `004` respectively.
3. Copy `scripts/seed-store.sql`, replace the store UUID and owner Auth user UUID, review the sample tax profile, then run it. It creates a small demo catalogue, not a legal tax setup.
4. Link the same store UUID in `POS_STORE_ID`. For multiple stores, use separate deployments or extend the employee/store selector; the current MVP assumes one configured store per deployment.
5. Copy `.env.example` to `.env.local` and set:

```dotenv
NEXT_PUBLIC_DEMO_MODE=false
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY
POS_STORE_ID=YOUR_STORE_UUID
NEXT_PUBLIC_APP_URL=https://YOUR_DEPLOYMENT_HOST
```

6. Never expose or commit `SUPABASE_SERVICE_ROLE_KEY`. Configure the owner’s Auth `auth_user_id` to match the seeded employee. For each staff member, create/invite a Supabase Auth user and link that `auth_user_id` to their employee row; the UI does not yet send invitations. Then sign in as owner, configure each refund limit, and verify the limit appears in the Team screen. Cloud defaults are zero; blank/no cap is owner-only.
7. Test RLS, role boundaries, device enrollment, first shift open, offline replay, stock conflicts, backup/restore and privacy retention using a non-production store before launch.

## Paystack setup (Ghana-specific adapter)

1. Complete Paystack merchant onboarding for the merchant’s country and channels. This starter uses Paystack for Ghana; MTN (`mtn`), ATMoney/Airtel Money (`atl`) and Telecel (`vod`) are the UI provider codes. Do not assume a network is enabled for every merchant. M-Pesa is not presented as a Ghana network in this project.
2. Start with a **test** secret key in `PAYSTACK_SECRET_KEY`. Never place it in a `NEXT_PUBLIC_` variable.
3. Configure the provider webhook URL as `https://YOUR_HOST/api/webhooks/paystack` and enable the required transaction/refund event delivery.
4. Deploy the endpoint over HTTPS. The handler verifies the `x-paystack-signature` HMAC-SHA512 over the exact raw body. The callback route also calls Paystack’s transaction verification endpoint and matches reference, amount, currency and metadata before finalizing a sale.
5. Card authorization uses Paystack’s hosted checkout. Mobile money uses a provider charge request and stays pending until a signed event/server verification confirms it. Browser redirects, customer screenshots and timeouts never prove payment.
6. Digital refunds are tied to the original provider payment. The UI submits the refund, stores the provider refund ID, and waits for a signed refund event or an authenticated server-side Paystack status check. Provider refund timing can be several business days. If refund webhooks are not enabled for the account, use the status check and reconcile in the provider dashboard.
7. Test duplicate webhooks, invalid signatures, incorrect amounts/currency, timeout after request, delayed MoMo authorization, failed/partial refunds and retry/idempotency behavior with provider test credentials before a pilot.

Do **not** accept live money until merchant onboarding, webhook delivery, refund behavior, tax treatment, receipt compliance, device/printer tests and recovery procedures are verified.

## Cloudflare Workers setup (replacing Vercel)

Cloudflare's OpenNext adapter and Wrangler configuration are installed in this project. **No Worker is deployed yet**: the Cloudflare account, production credentials and domain zone were not available from this workspace. Keep Supabase as the database/auth provider; Cloudflare only replaces the application host.

### Local Worker preview

Use Node.js 22.12+ and npm 10+:

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run cf:preview
```

Leave the preview process running and open Wrangler's local URL (this project's script binds port `8787`). The preview runs the built app in Cloudflare's local Worker runtime. It uses the demo store unless you add a non-production configuration. For local Worker secrets/config, use ignored Next.js env files such as `.env.development.local`; `.dev.vars` here only selects `NEXTJS_ENV=development`. Check `http://localhost:8787/api/health`; the demo response should show `ok: true`, `mode: "demo"`, and `cloudConfigured: false` until Supabase runtime variables are supplied.

### Versions and free-plan fit

- Next.js is pinned to **16.3.8** for the Worker build. Next.js 16.4.0 currently emits `.next/server/preview-props.json`, which OpenNext Cloudflare 1.20.10 does not inline; this causes every request to fail at runtime even though the build succeeds. The current upstream status is tracked in [OpenNext issue #1355](https://github.com/opennextjs/opennextjs-cloudflare/issues/1355) and [fix PR #1428](https://github.com/opennextjs/opennextjs-cloudflare/pull/1428). Revisit this pin only after a released adapter fix and a successful Worker preview.
- `npm audit` reports **0 vulnerabilities** with the scoped `glob@10.5.0` override for OpenNext's minifier dependency. Keep `package-lock.json` in sync when changing dependencies.
- A Wrangler dry run measured this build at **7,553 KiB total / 1,670 KiB gzip** (about 1.63 MiB compressed), within OpenNext's documented **3 MiB Workers Free** bundle limit. Recheck after dependency/app changes with `npx wrangler deploy --dry-run`.
- Workers Free is **$0** and currently allows 100,000 Worker requests/day and 10 ms CPU per invocation. Static asset requests are free, but Next.js server rendering and API routes consume Worker requests/CPU; a local smoke test does not establish production CPU headroom. If the workload exceeds Free limits, Workers Paid starts at **$5/month** and includes 10 million Worker requests plus 30 million CPU-ms/month; additional usage is billed (currently $0.30 per million requests and $0.02 per million CPU-ms). Monitor usage so the total stays within the US$5 target. There is no Workers egress/bandwidth charge. See [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [limits](https://developers.cloudflare.com/workers/platform/limits/) for current terms. The custom domain's renewal cost is separate.

### Manual production deployment

1. Publish this project to a Git remote you control (or use the updated source archive). Create/sign in to a Cloudflare account and authorize Wrangler:

   ```bash
   npx wrangler login
   npx wrangler whoami
   ```

2. Finish the Supabase setup above first. For a manual build/deploy, create an ignored `.env.production.local` containing the **build-time** browser config (replace all placeholders):

   ```dotenv
   NEXT_PUBLIC_DEMO_MODE=false
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
   NEXT_PUBLIC_APP_URL=https://YOUR_FINAL_HOST
   ```

   `NEXT_PUBLIC_*` values are bundled during `next build`; rebuild/redeploy when changing them. Do not commit this file. If using Cloudflare Workers Builds instead of local deployment, add the same build values to that build environment.

3. In the Cloudflare dashboard, open **Workers & Pages → `kasa-pos-pwa` → Settings → Variables and Secrets**. Add runtime variables for `NEXT_PUBLIC_DEMO_MODE=false`, `NEXT_PUBLIC_APP_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `POS_STORE_ID`. Add server-only secrets using the Secret type: `SUPABASE_SERVICE_ROLE_KEY`; add `PAYSTACK_SECRET_KEY` only when using an onboarded merchant's test/live account, and optionally `RESEND_API_KEY`. Optional runtime values are `PAYSTACK_DEFAULT_EMAIL`, `PAYMENT_RECEIPT_EMAIL`, and `RECEIPT_FROM_EMAIL`. Never use `NEXT_PUBLIC_` for a server-only secret. Deploy preserves dashboard variables with Wrangler's `--keep-vars` option.

4. Deploy first to the generated `workers.dev` address:

   ```bash
   npm ci
   npm run cf:deploy
   ```

   The account-specific URL is printed by Wrangler/dashboard; it is not known from this workspace. Verify `/`, `/offline`, `/manifest.webmanifest`, `/sw.js`, and `/api/health`. Health should report `mode: "configured"` and `cloudConfigured: true` only after the required Supabase variables are correct. Use test keys and a non-production store for all payment checks.

5. Attach the custom hostname only after the Worker works at `workers.dev`. The domain must be an **active Cloudflare DNS zone**. If the domain is registered elsewhere, its registration can stay there; point its nameservers to Cloudflare if necessary to activate the zone. In **Workers & Pages → `kasa-pos-pwa` → Settings → Domains & Routes → Add → Custom Domain**, enter the chosen hostname (for example `pos.example.com`). Cloudflare provisions the DNS record and certificate. See [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/). No custom domain has been added by this project setup.

6. Set `NEXT_PUBLIC_APP_URL` to the final HTTPS hostname and redeploy. Update Supabase Auth redirect/allowed URLs and Paystack's webhook URL to `https://YOUR_FINAL_HOST/api/webhooks/paystack`. Confirm HTTPS, sign-in, role boundaries, sync, refunds, webhook verification, offline replay, and the exact target devices/printers before a pilot.

Never accept live payments until merchant onboarding, webhook delivery, refund behavior, tax treatment, receipt compliance, hardware tests, backup/restore and recovery procedures are verified. Keep all secrets in Cloudflare/Supabase server-side settings; never paste them into client code, Git, issue trackers or screenshots.

No live GitHub repository, Cloudflare deployment or custom-domain URL is claimed. The project folder is the current source of truth; regenerate the downloadable archive after any later edits.

## Release checklist

- [ ] Correct store country, currency, effective tax rates and inclusive/exclusive price rules approved by accountant/GRA.
- [ ] E-VAT/CIS applicability and certified receipt/device requirements confirmed; this ordinary PWA receipt is not certified by default.
- [ ] Supabase Auth/RLS and owner/manager/cashier permissions tested.
- [ ] Data-protection notice, lawful basis, retention, backups, access/deletion and incident process reviewed under Ghana’s Data Protection Act obligations.
- [ ] Paystack merchant onboarding and provider channels confirmed; signed webhook and server verification tested with test keys.
- [ ] Full/partial card and MoMo refunds, pending/failed statuses, restock and provider reconciliation tested.
- [ ] Full-day transaction simulation with offline periods completed; no digital sale marked paid without provider proof.
- [ ] 2–3 cashiers on separate devices tested for simultaneous sales, stock counts, returns, duplicate sync and negative-stock conflicts.
- [ ] Exact tablet, phone, browser, Bluetooth/USB printer and PDF/email behavior certified for the pilot.
- [ ] Backup/restore, local device loss, clear-site-data, account recovery, logs and support procedures rehearsed.
