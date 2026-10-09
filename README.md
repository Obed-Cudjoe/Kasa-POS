# Kasa POS · Offline-first retail MVP

A tablet-first POS MVP starter for a small independent retailer. It uses Next.js App Router, TypeScript, Supabase PostgreSQL/Auth, Dexie/IndexedDB, a PWA service worker and Next.js Route Handlers. The UI is designed for tablet landscape, with a collapsed phone layout.

> **Important delivery boundary:** this workspace contains a runnable local project and starter migrations. It has **not** been published to GitHub, deployed to Vercel, connected to a live Supabase project, or tested with a real payment merchant account. No credentials or merchant onboarding were supplied. Demo payment buttons are simulations only. Do not use demo tax figures or receipts for live trade.

## What works in the local demo

- Installable PWA experience after a production build; cached app shell/offline fallback.
- Dexie-backed products, tax profiles, inventory, orders, payments, refunds, employee profiles, shifts and an outbox.
- Seeded demo store with 24 products, inclusive/exclusive prices, standard/zero-rated/exempt demo profiles, inventory, transactions, refunds and open/closed shifts.
- Catalog search/category filters, add/remove quantities, per-line tax detail and cart tax totals.
- Checkout within three taps from a ready cart: open checkout → choose tender → record/request. Cash change is calculated automatically.
- Offline cash sale recording. Offline digital-payment attempts remain **pending**, with no stock deduction and no claim of payment success. Production cloud profiles require a device-local 6–8 digit PIN to unlock cached access offline.
- Clearly labelled simulated card/MoMo demo transactions. They do not contact a PSP or move money.
- Transaction history and manager/owner full/partial refund UI. Accepted saleable items are restocked; digital reversals remain pending until provider confirmation.
- Product, tax, inventory count, team-role, shift open/close and drawer reconciliation screens.
- Local sales/tax dashboard based on saved transaction-time tax snapshots.
- GHS is the sale/reporting base. A user-entered USD/EUR/KES reference rate can be displayed, but is never used as settlement currency.
- PDF export, browser print, native share/mail fallback, and optional server-side receipt email.
- ESC/POS Bluetooth/USB transport hooks with browser/device limitations and PDF fallback.
- Supabase sync route skeleton with authenticated role checks, UUID event idempotency, an append-only inventory movement ledger, additive stock projection updates and stale physical-count conflicts.
- Paystack adapter for Ghana card and mobile-money requests, HMAC-verified webhooks, server-side transaction verification, timeouts and provider refund status handling.

## Not included / not certified

- No live PSP charge, webhook, refund, Vercel deployment, Supabase migration execution, GitHub publication or merchant settlement has been verified from this workspace.
- Paystack is the implemented Ghana adapter. Flutterwave is not wired in this project; use an adapter for it if merchant onboarding/market coverage requires it. Provider channel support must be checked against the specific merchant account.
- Demo “Confirm” records are intentionally stored as `demo_simulated`; they are not provider-confirmed sales.
- Demo Ghana tax components are illustrative and **unverified**. They are not legal advice and do not establish VAT registration, correct effective rates, GRA E-VAT/CIS certification or a certified fiscal receipt.
- The local team screen saves employee/role records but does not send Auth invitations. Production staff need a Supabase Auth account linked to an employee row.
- The device-local demo role chooser is not an authentication control. Production uses Supabase Auth for online access; offline unlock is limited to the last cached employee and a 6–8 digit device PIN (salted PBKDF2 hash). This PIN is not cloud authentication, IndexedDB business data is not encrypted at rest, and signing out clears the cached profile/PIN. Protect shared devices with the operating-system screen lock.
- Discounts, split tender, loyalty, multi-location, barcode scanning, kitchen display, table management, online ordering and franchise workflows remain out of the MVP scope.

## Requirements

- Node.js **20.9+** (Next.js 16 requirement); this project pins a Supabase client release that supports Node 20.
- npm 10+ recommended.
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
```

Run commands serially if the production build is regenerating `.next/types` while TypeScript runs. A generated service worker is written to `public/sw.js` during production build and is ignored by Git; it is regenerated from `src/app/sw.ts`.

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
src/app/sw.ts                    Serwist shell/static caching and offline fallback
supabase/migrations/001_pos_schema.sql  Supabase tables, RLS and indexes
supabase/migrations/002_pos_sync_and_payment_functions.sql  Idempotent sync/stock/payment RPCs
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

## Supabase setup for a real store

1. Create a Supabase project and an Auth user for the owner.
2. Apply migrations in order (`supabase/migrations/001_...sql`, then `002_...sql`) using Supabase CLI or the SQL editor after review. The starter schema has **not** been run against a live Supabase instance here.
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

6. Never expose or commit `SUPABASE_SERVICE_ROLE_KEY`. Configure the owner’s Auth `auth_user_id` to match the seeded employee. For each staff member, create/invite a Supabase Auth user and link that `auth_user_id` to their employee row; the UI does not yet send invitations.
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

## Deployment to Vercel

Vercel deployment is **not done from this workspace** because there is no Vercel account/project access or environment secrets here. To deploy yourself:

1. Publish this folder to a Git remote you control (or import the supplied source archive).
2. Import the repository into Vercel and set the environment variables above in the correct environments.
3. Deploy a preview first; apply the reviewed Supabase migrations and seed a non-production store.
4. Test over HTTPS on the target tablet/phone and exact printer/payment hardware. Enable Vercel/Supabase backups and alerts, then deploy production only after all gates pass.
5. Keep secrets in Vercel/Supabase server settings. Never paste a live key into client code, issue trackers or demo screenshots.

No live GitHub repository or Vercel URL is claimed by this deliverable. The complete source is in this project folder; the Agent can provide a source ZIP for download.

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
