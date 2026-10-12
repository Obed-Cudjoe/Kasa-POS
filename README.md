# Kasa POS · Cloudflare Workers + D1

Kasa POS is an offline-first retail POS for tablets and phones. The current implementation combines Next.js App Router, Cloudflare Workers/OpenNext, relational Cloudflare D1, custom cookie-based accounts, bcrypt-compatible password hashing (`bcryptjs`), and Dexie/IndexedDB for offline device work.

> **Deployment boundary:** The public `workers.dev` site is still in demo mode until the D1 database is created, its ID is added to `wrangler.jsonc`, the migrations and Worker secrets are configured, and a non-production account is tested. The application build alone does not connect a database. Checkout is intentionally cash-only; no payment gateway is configured. Use synthetic data only for staging; the configured D1 jurisdiction is US and Ghana data-location/privacy implications still need review.

## Features

- **Owner onboarding and staff access:** vendor owners can register a store; staff accounts are owner-invited only. Platform-admin access is privately provisioned, never selected on a public form. Passwords are bcrypt-hashed, sessions use `HttpOnly` same-site cookies, and account endpoints validate inputs and rate-limit requests.
- **Protected store APIs:** operational APIs require an authenticated store session and enforce role checks. Auth registration, verification, invitation and reset endpoints are intentionally public but validated and throttled. Paystack code is retained but dormant; it is not part of the cash-only checkout configuration.
- **Offline-first POS:** products, inventory, sales, refunds, shifts and an idempotent sync outbox are stored locally until sync is possible.
- **Barcode product setup:** owners/managers can scan or type a UPC/EAN/barcode into the product editor. Codes are unique within a store; SKU is optional.
- **Barcode checkout:** focus the **Scan barcode here** field and scan. Common USB/Bluetooth readers that operate as a keyboard/HID device enter the barcode as text; their Enter or Tab suffix adds one matching product to the cart. Search also matches barcode and SKU. No scanner-specific cloud service or camera permission is required. Verify the particular reader’s keyboard mode and suffix on the target tablet before buying or using it for live sales.
- **Receipt branding:** an owner can edit **Settings → Shop name on receipts**. The name appears on the receipt preview, PDF/share output, managed email PDF and thermal print header. In live mode it is stored in D1 and synchronized to signed-in devices.
- **Receipts and printers:** PDF, browser print, native share/mail, and optional ESC/POS Bluetooth/USB are available. Bluetooth/USB support depends on HTTPS, browser, OS and the exact printer model.
- **Cash-only checkout:** cash is the only enabled tender; card and mobile-money options are hidden, and cash sales can be recorded offline. No gateway account, webhook, or payment API key is required. Optional Paystack routes remain dormant for possible future use.
- **Ghana readiness:** tax values are not legal advice. The app does not claim GRA E-VAT/CIS certification. Confirm tax treatment, receipt duties, privacy and Ghana Data Protection Act 2012 (Act 843) obligations before real customer data or live trading.

## Run locally

Requires Node.js **22.12+** and npm 10+.

```bash
npm ci
npm run dev
```

The default `NEXT_PUBLIC_DEMO_MODE=true` selects local demo data. In Checkout, click the scan field and type a known barcode followed by Enter to try the scan flow without a physical reader. Switch to the demo Owner profile and open Settings to change the demo receipt name; demo changes stay in this browser.

## D1 and Worker setup

This project starts from a **fresh D1 database**; there is no Supabase/live-data import. Keep all real/staging secrets out of source control.

1. Create a D1 database from the Cloudflare dashboard or run `npm run d1:create` using an authenticated Wrangler session.
2. Copy the returned D1 database ID into the `database_id` property of the `DB` binding in `wrangler.jsonc`. Do not invent or commit a fake ID.
3. Apply the local schema for development with `npm run d1:migrate:local`. For the real staging database, review and then apply with `npm run d1:migrate:remote`. Migrations currently include `0001_initial.sql` and `0002_product_barcodes.sql`.
4. Configure Worker **Secrets** in Cloudflare (or locally in the ignored `.dev.vars` file):
   - `SESSION_SECRET`: a randomly generated secret of at least 32 characters.
   - `RESEND_API_KEY`: Resend API key for verification, staff invites and password resets.
5. Configure Worker **Variables**: `PUBLIC_APP_URL` (HTTPS staging/production URL) and `RESEND_FROM_EMAIL` (verified sender). The D1 binding is `DB`. Do not configure Paystack keys/webhooks for the current cash-only setup.
6. Build for Cloudflare with `npm run cf:build`; use `npm run cf:preview` for a local Worker-runtime preview. Configure the Cloudflare Git-connected build to use the OpenNext build/deploy commands documented in `reports/CLOUDFLARE_WORKERS_DEPLOYMENT_GUIDE.md` after reviewing it.
7. Keep `NEXT_PUBLIC_DEMO_MODE=true` during setup. Switch it to `false` only in the Cloudflare **build environment** after D1 migrations and secrets are ready. Then test owner registration, email verification, staff invitation, login, recovery, role boundaries and sync using synthetic data.

The `DB` binding in `wrangler.jsonc` now points to the Cloudflare-created `kasa-pos-staging` database. Its remote migrations still need to be applied, and Worker secrets/variables still need to be configured before remote auth can work. If you use another environment, replace the database ID with that environment’s Cloudflare-issued ID. Public email links require a valid `PUBLIC_APP_URL`; Resend sender-domain verification is also required.

## Quality checks

```bash
npm run typecheck
npm test
npm run build
npm run cf:build
```

These checks do not verify a remote Cloudflare database, real Resend email delivery, a physical scanner/printer, or Ghana compliance. Cash-only checkout is the current payment scope; dormant Paystack code is not configured or tested. Use synthetic data for staging. D1 staging is currently in the US jurisdiction; review applicable data-location and privacy implications before real users.

## Barcode reader notes

The POS uses the reader’s keyboard/HID mode rather than a proprietary scanner SDK. During checkout, the scan field must have focus. During catalog setup, scan into the **Barcode / UPC / EAN** field. Configure the reader to send Enter or Tab after each code. Leading zeroes are preserved, and duplicate barcodes are rejected locally and by D1. A product must still have a name, price, category and tax profile before saving.

## Receipt name notes

The D1 store profile name is the receipt brand name. Owners can edit it under Settings; managers can view it. Update it to the business name customers should see and separately verify any required legal name, tax number, receipt fields and local tax certification. Reprinting an older transaction uses the current shop name; the name is not yet snapshotted on each historical order.

## Security and launch limits

- Never hardcode or paste credentials into this repository. Use Cloudflare Worker Secrets/Variables and an ignored local `.dev.vars` file.
- Cash-only checkout is enabled. No card/mobile-money gateway is configured. If adding one later, use hosted/tokenized payment handling—never collect raw card numbers, CVV/CVC or PINs—and complete merchant onboarding, signed webhook, amount/currency, refund and settlement tests first.
- IndexedDB is not encrypted at the application layer. Use a dedicated OS-encrypted device, strong screen lock, staff access controls and a reviewed backup/recovery plan.
- Review Ghana Act 843/DPC obligations, lawful basis/consent, data retention/deletion, processor terms and US D1 data location before live customer or employee records.
- Ghana tax figures are sample/demo values only and are not legal advice. No GRA E-VAT/CIS certification is claimed.
- Cloudflare Workers usage limits/overages, D1 usage, email-provider fees and the already-owned domain’s renewal are separate costs. A `workers.dev` hostname is a free Worker subdomain, not a registered custom domain; do not assume total hosting will remain under a particular monthly amount without checking current pricing and usage.

## GitHub

The workspace has no authenticated GitHub remote/push capability in this session. Do not paste a GitHub token here; use GitHub Desktop browser sign-in to review, commit and push these local changes to the linked repository.
