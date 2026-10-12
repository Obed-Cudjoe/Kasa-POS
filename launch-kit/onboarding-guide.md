# Kasa POS owner setup guide · staging first

**For:** independent grocery and convenience shops in Ghana. This is a staging checklist, not authorization to process real customer data or live payments.

## Before onboarding

A technical operator must first create a non-production Cloudflare D1 database, add its real ID to the Worker binding, apply the reviewed D1 migrations, configure a unique `SESSION_SECRET`, set `PUBLIC_APP_URL`, and configure a verified Resend sender/API key. Keep `NEXT_PUBLIC_DEMO_MODE=true` until these checks pass. The current D1 staging jurisdiction is US; review Ghana Data Protection Act 2012 (Act 843), cross-border/data-location obligations and DPC requirements before any real data.

Prepare synthetic products, tax categories approved by a qualified adviser, a test owner email, and a tablet/phone with HTTPS access and a screen lock. Do not use real customer/card data or production passwords in training.

## Owner setup

1. Open the staging URL and select **Create a store account**.
2. Enter the synthetic shop name, owner name, email and a strong password (12+ characters); complete the Resend email verification link and sign in.
3. Open **Settings → Shop name on receipts** and set the staging receipt name. Live changes are stored in D1; demo-mode changes stay local.
4. Open **Tax setup** and create the adviser-approved test tax categories. Never copy sample Ghana tax rates as legal advice or assume this app is GRA E-VAT/CIS certified.
5. Open **Products → Add product**. Enter name, optional SKU, price, category, opening quantity and tax profile. Click **Barcode / UPC / EAN** and scan with a reader in keyboard/HID mode, or type the barcode. Codes preserve leading zeroes and are unique within a store. There is no bulk CSV import yet.
6. In **Team → Invite employee**, send a synthetic cashier/manager invitation to an email you control. The recipient uses the one-time email link to set their own password. Public registration must not grant staff or platform-admin roles; platform-admin provisioning remains private.
7. Sign in as the test cashier on the till device and open a shift with a synthetic float.

## Scanner practice

In Checkout, click the **Scan barcode here** field, then scan a product already in the catalogue. Common portable USB/Bluetooth readers configured as a keyboard/HID device type the code into the field. The reader’s Enter or Tab suffix adds the matching product to the cart. Verify the actual reader model, connection mode and suffix on the target tablet; the application has not been tested with an AliExpress scanner.

## Staging practice

- Use only synthetic sales, names, and contact data.
- Test cash checkout, tax snapshots, offline queue/sync, barcode retries, duplicate barcode rejection, receipt branding, and manager/owner permissions.
- Checkout is cash-only; do not configure Paystack keys or webhooks. If a gateway is considered later, treat it as a separate scoped change and test with merchant-approved credentials only.
- Print/sample receipts on the intended printer and review legal content separately. Browser Bluetooth/USB support varies by OS and browser.
- Review pending sync/conflicts before resetting browser data.

## Launch gates still required

The D1 remote resource and migration status must be verified. Test security boundaries, invitation/reset email delivery, multi-device sync, refunds, signed webhooks, backup/restore, account revocation, device loss, receipt/tax obligations, Ghana privacy and data-location review, and the real scanner/printer. Merchant onboarding and settlement checks are required before live payment keys or sales. Do not describe this starter as production-ready until those independent checks pass.
