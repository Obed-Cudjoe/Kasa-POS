# Kasa POS · Cloudflare Workers and D1 staging checklist

**Status:** The `kasa-pos-staging` D1 ID is now recorded in `wrangler.jsonc`, but its remote migrations have not been applied because this workspace has no authenticated Cloudflare session. The public `workers.dev` app remains demo-only until the staging checklist passes. Use synthetic data only.

## 1. Create and bind a D1 database

The user-created `kasa-pos-staging` database ID is already recorded in this checkout’s `wrangler.jsonc`. For that database, verify the binding name/ID and continue at step 3. Only create another database if you intentionally want a separate environment.

1. For a new environment, sign in to the intended Cloudflare account and create a **new D1 database**, for example `kasa-pos-staging`.
2. Copy the database ID Cloudflare returns. In `wrangler.jsonc`, add it to the existing binding:

   ```jsonc
   {
     "binding": "DB",
     "database_name": "kasa-pos-staging",
     "database_id": "<the real Cloudflare-issued ID>",
     "migrations_dir": "migrations"
   }
   ```

   Do not invent a value or commit a placeholder. The local repo currently has no real database ID, so remote D1 migration/deployment cannot be validated from this workspace.
3. Review the migration files. This is a fresh D1 schema and does not migrate any Supabase data:
   - `migrations/0001_initial.sql`
   - `migrations/0002_product_barcodes.sql`
4. Apply to the staging database with Wrangler from a trusted, authenticated terminal:

   ```bash
   npm run d1:migrate:remote
   ```

   Confirm both migration names are marked applied in Cloudflare D1. Never point this command at production while testing.

## 2. Add Worker bindings and secrets

Set the following in **Workers & Pages → kasa-pos → Settings → Variables and Secrets** (exact dashboard labels may vary):

**Secrets**

- `SESSION_SECRET`: a cryptographically random value of at least 32 characters. Use a unique value per environment.
- `RESEND_API_KEY`: the Resend key for the verified sender used by account verification, password resets and staff invitations.

Do **not** configure `PAYSTACK_SECRET_KEY` for the current cash-only setup. The optional Paystack code is retained but dormant.

**Variables**

- `PUBLIC_APP_URL`: exact HTTPS staging URL, such as the existing `workers.dev` URL.
- `RESEND_FROM_EMAIL`: sender address on a verified Resend domain.

The D1 binding must be named `DB`. Keep all secrets out of GitHub, build logs, screenshots and chat. The ignored `.dev.vars` file is only for local Worker preview; `.dev.vars.example` contains no credentials. No Paystack variables, secrets, merchant setup or webhook configuration are needed for cash-only checkout.

## 3. Configure Workers Builds

For a Git-connected Worker, use the repository root and a Node.js version compatible with `.node-version` (`22.23.2`):

```text
Build command:  npm run cf:build
Deploy command: npx opennextjs-cloudflare deploy --keep-vars
```

Set the build-time public variable `NEXT_PUBLIC_DEMO_MODE=true` during initial staging. Only change it to `false` after the D1 binding/migrations, `SESSION_SECRET`, Resend and email-link URL are configured. Build variables prefixed `NEXT_PUBLIC_` are bundled into browser code; they must never contain secrets.

If Cloudflare is not connected to Git, run `npm run cf:build` and deploy from an authenticated Wrangler/OpenNext terminal. This assistant cannot push to GitHub or Cloudflare from the current workspace. Review and push with GitHub Desktop browser sign-in; do not use a token pasted into chat.

## 4. Test in staging before any real users

Use only synthetic accounts, products and transactions. Confirm:

- `GET /api/health` returns JSON and `cloudConfigured: true`; the UI build is not demo mode.
- An owner can register, receive/complete email verification and sign in. Public owner registration must not grant staff or platform-admin roles.
- An owner can invite a synthetic cashier/manager. The recipient can accept a one-time link and choose a password. Password reset, verification resend, sign-out/revocation and role authorization work.
- Data routes reject requests without a same-origin signed-in session. Confirm checkout exposes only cash and records cash sales/refunds as expected; no payment gateway is configured or required. Retained Paystack endpoints are dormant and are outside this staging test.
- Create/edit a product with a barcode, sync it, sign in on a second staging device and scan by barcode into the checkout cart. Try a common USB/Bluetooth scanner in keyboard/HID mode and verify its configured Enter/Tab suffix. No physical scanner is tested by this code build.
- Change the receipt shop name as owner; confirm it syncs and appears in on-screen, PDF, email and thermal receipt headers. Verify exact printer/browser support separately.
- Test outbox retry, inventory conflicts, refunds and deletion/consent workflows with synthetic records only.

The current checkout is cash-only. Paystack code remains unused and no gateway key should be set. If a gateway is considered later, first review merchant onboarding, webhook verification, amount/currency matching, refunds and settlement reconciliation.

## 5. Ghana and operations review

- Current staging D1 selection is US jurisdiction. Review Ghana data-location, cross-border transfer, processor contract, Data Protection Act 2012 (Act 843), DPC registration and data-subject request obligations before putting real user/customer data in D1.
- Replace privacy-notice placeholders and review lawful basis, consent, retention, deletion, access controls, device encryption, backup and incident response with qualified Ghanaian advisers.
- Sample tax values are not legal advice. Confirm GRA rates, legal receipt fields, E-VAT/CIS onboarding and certification. The application makes no certification claim.
- Cloudflare charges/limits and Workers overages, D1 usage, Resend, and domain renewal are separate. Paystack fees only become relevant if a gateway is intentionally added later. A `workers.dev` hostname is a free subdomain, not a registered custom domain; verify current pricing before accepting production traffic.
