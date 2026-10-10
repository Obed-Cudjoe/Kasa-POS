# Kasa POS MVP — QA and security review

**Review date:** 2026-10-10 (Accra/Atlantic-Reykjavik local date)
**Build:** Next.js 16.3.8 · OpenNext Cloudflare 1.20.10
**Review type:** Source review, local synthetic-data tests, production-build checks and local Cloudflare Worker HTTP smoke test.
**Decision:** Suitable for continued non-production demo/staging work only. **Not approved for live transactions or production deployment.**

## 1. Executive summary

The current POS source passes **34 automated tests** (31 existing/new operational tests plus 3 demo-seed upgrade tests), TypeScript, ESLint, `npm audit` (0 reported vulnerabilities), Next.js production build and OpenNext Cloudflare build. A local Worker preview returned expected pages/health status, security headers and 401 for five unauthenticated API requests.

These checks used synthetic data, fake IndexedDB and mocked HTTP. The local preview reported `mode:"demo"`, `cloudConfigured:false`, and `paymentsConfigured:false`. No Supabase migration, live provider call, real card/MoMo payment, production deployment, physical-device test, backup/restore or compliance assessment was performed.

The requested **demo** refund ceilings are now set and upgraded for existing seeded demos:

| Demo employee | Refund ceiling per transaction | Meaning |
|---|---:|---|
| Cashier Ama | `0` minor units | No refund authority |
| Manager Kojo | `50_000` minor units | GHS 500.00, because GHS is stored in pesewas |
| Owner Akosua | `Number.MAX_SAFE_INTEGER` minor units | Extremely high finite ceiling, as requested; not `null`/unlimited |

Seed upgrade updates the previous demo defaults (`100_000` for manager and `null` for owner) while preserving non-legacy configured values. This is a **local demo-seed change only**; it does not alter an external Supabase employee row.

## 2. Verification evidence

| Check | Result | Boundary |
|---|---|---|
| Vitest | **34 passed** across 5 files (result after final seed change) | Fake IndexedDB and mocked HTTP; not Supabase/PSP integration |
| TypeScript | Passed (`npm run typecheck`) | Static types only |
| ESLint | Passed (`npm run lint`) | Does not establish security/compliance |
| Dependency audit | `npm audit`: **0 vulnerabilities reported** | Does not cover SAST, DAST, penetration testing or configuration |
| Next production build | Passed (`npm run build`) | No external deploy |
| Cloudflare build | Passed (`npm run cf:build`) | Build/dry-run is not a deployment |
| Local Worker pages | `/`, `/privacy`, `/offline`, `/manifest.webmanifest`, `/api/health`: **200** | Local preview only |
| Local security headers | `nosniff`, strict-origin referrer policy and Permissions-Policy present | No real external HTTPS/origin review |
| Unauthenticated API gate | Consent, employee refund-limit, Paystack initialize, refund submit and refund status POST: **401** | No valid login; positive/role-scoped cases not exercised against cloud |
| Local Worker health | `mode:"demo"`, `cloudConfigured:false`, `paymentsConfigured:false` | Explicitly no cloud/provider configuration |

A first preview launch through the sandbox’s default Node `20.20.2` exited because Wrangler requires Node 22. It was restarted successfully using Node 22. After the final build, the local Worker preview was restarted and the HTTP smoke checks were repeated. The successful checks did not issue any payment request; the refreshed preview remains active in the Arena preview panel.

## 3. Synthetic transaction and tax results

### Completed locally

- **50 labelled synthetic sales:** 17 cash, 17 demo-simulated card and 16 demo-simulated mobile-money sales. All 50 produced a local order/payment with unique order numbers, an arithmetically consistent `total = subtotal + tax`, no sync outbox event in demo mode, and non-negative local inventory.
- Mixed synthetic product tax handling included inclusive/exclusive pricing and standard-rated, zero-rated, exempt and out-of-scope profiles. Component arithmetic and overrides are unit-tested; the seeded Ghana-style composite values are examples, not a current GRA determination.
- Cash simulation covers tendered amount, change, opening float, cash refund drawer adjustment, closing count and zero variance.
- Refund tests cover a full cash return, two partial returns (`0.333 + 0.667` quantity) whose gross/tax add back exactly to the original, saleable restock, zero-limit/over-limit rejection, a cashier refund at an equal configured ceiling, and two concurrent full-refund attempts where exactly one succeeds.
- A synthetic mobile-money refund stays `pending`/`refund_pending` until a provider result exists; no live refund was attempted.
- Digital payment confirmation was called concurrently twice in local storage; one local inventory movement resulted. This is not a gateway or database test.

### Offline and retry simulation

- Ten synthetic offline cash sales and two refunds produced 12 durable local outbox events.
- A mocked network exception left all 12 queued. A mocked replay accepted 11 and returned one explicit conflict; local orders/refunds/stock remained present.
- Re-marking an acknowledged event as pending and replaying it did not change the mock server’s applied-set or local stock. This demonstrates client/outbox behavior under the mock, not real HTTP loss, server idempotency or Supabase transaction isolation.

### Acceptance items not implemented or not verified

| Requirement | Result |
|---|---|
| Split tenders/payments | Not implemented; not tested |
| Discounts/promotions | Not implemented; not tested |
| Sale voids | Not implemented; not tested |
| Actual Paystack card checkout, Ghana mobile-money provider response, webhooks or financial reversals | Not tested; no merchant credentials/onboarding |
| Actual cloud retry/idempotency and SQL concurrency | Not tested; outbox replay used mocked HTTP only |
| 2–3 real cashiers on separate devices, cloud inventory contention and conflict-resolution UX | Not tested |
| GRA-approved tax rate/category treatment, electronic fiscalization or E-VAT/CIS reporting | Not verified |
| Physical receipt printer, scanner, drawer, USB/Bluetooth or OS print | Not tested |
| Supabase migration/RLS execution, backup or restore | Not performed |
| Accessibility, screen-reader, touch-target and target-device browser testing | Not performed |

## 4. High-priority issues before live trading

1. **Run SQL integration and multi-device inventory tests.** The offline event RPC path records negative-stock outcomes as conflicts, but the separate `confirm_paystack_payment` SQL function directly applies stock deltas when a digital payment succeeds. The source inspected does not reserve stock while a digital order is pending or persist a comparable inventory-review flag when a successful payment drives stock negative. Two pending digital orders could therefore be paid against the same last unit and oversell. Decide reservation/backorder policy; then add durable, owner-visible conflict handling and test concurrent confirmations in isolated Supabase before live use.
2. **Apply and validate migrations `001`–`004`.** Migrations `003` (privacy-consent audit) and `004` (employee refund ceiling, owner-only `NULL`) are pending/unverified. Cloud refund-limit behavior is not ready until the schema is deployed and tested with real staging roles.
3. **Complete merchant privacy details and Act 843 operations.** The privacy notice still contains placeholders. Controller identity, DPC registration, retention, processor/transfer terms and a data-subject request log/workflow are not verified. IndexedDB has no app-layer at-rest encryption.
4. **Complete PCI/payment acceptance.** Hosted checkout/source review and `npm audit` are not PCI validation. Determine PCI scope and applicable SAQ with the acquirer/Paystack/QSA. Do not claim PCI compliance or payment readiness.
5. **Test financial and inventory reconciliation with provider test credentials.** Exercise duplicate/delayed webhooks, amount/currency/reference mismatches, timeouts, charge/refund failure, provider reconciliation and staff role limits in a non-production merchant account.
6. **Do an authorized device and restore pilot.** No physical Android/iOS/printer or backup restore has been tested. Use `DEVICE_COMPATIBILITY_REPORT.md` and `BACKUP_RECOVERY_PROCEDURE.md` and record actual models, results and recovery timings.
7. **Close missing product acceptance criteria** for split tender, discounts and voids, or explicitly remove these from the release scope.

## 5. Security and privacy posture (not a certification)

### Positive controls found/added

- Server routes authenticate and constrain records by the actor’s store; a local unauthenticated test returned 401 for five sensitive POST routes, including refund-status reconciliation.
- Refund authorization is checked in client operations and server push/provider paths through the shared per-transaction limit helper. `undefined` fails closed as zero; `0` denies; `null` is the no-cap sentinel but is allowed only for owner profiles in the owner endpoint and the employee schema check.
- Demo role defaults now have the requested exact values; legacy seed migration test covers old defaults and preservation of custom limits.
- Payment routes are designed to keep provider API requests server-side and use hosted/tokenized Paystack checkout for card entry. No raw card number, CVV or PIN field was identified in the inspected POS model/flow; this is not a full-card-data scan.
- Verified webhook code uses raw-body signature verification and event idempotency; provider amount/currency/reference are checked before finalization.
- Consent is checked before contact data is forwarded to payment or email endpoints; the consent log intentionally excludes email/phone. This is cashier-attested consent, not independent verification of customer identity/free choice.
- Added response hardening headers and fail-closed cryptographic UUID generation.

### Limits and unverified controls

- Actual RLS and SQL permissions, Supabase project configuration/region, secret bindings, backups, retention, MFA, provider account, allowed origins, DNS/TLS and log retention were not available for inspection.
- IndexedDB is not encrypted by the app. Physical device full-disk encryption, MDM, lock-screen policy and device revocation are not enforced by this build.
- There is no penetration test, SAST/DAST, ASV scan, external code review, incident drill or accessibility audit.
- No cloud migration was applied, so consent and refund-limit database guarantees remain conditional on applying and validating migrations.
- Ghana tax examples are synthetic and require current GRA/accountant review.

Detailed controls and owner actions are in `PCI_AND_GHANA_PRIVACY_CHECKLIST.md`.

## 6. Artifacts

- `reports/BUG_FIX_LOG.md` — issue-by-issue code changes, checks and residual risks.
- `reports/PCI_AND_GHANA_PRIVACY_CHECKLIST.md` — PCI/payment-security and Ghana Act 843 readiness checklist.
- `reports/BACKUP_RECOVERY_PROCEDURE.md` — cloud/device backup, restore and reconciliation runbook; procedure only, no restore test.
- `reports/DEVICE_COMPATIBILITY_REPORT.md` — device/printer status, browser API limits and pilot checklist.
- `reports/QA_SECURITY_REVIEW_2026-10-10.md` — this summary.

## 7. Release statement

This project remains a **non-production MVP/demo**. Hosting configuration targets Cloudflare Workers while retaining Supabase; Vercel has not been used for this local preview. No external publication, production deployment, actual hosting-cost validation, real-money test or live payment readiness is claimed. The US$5/month hosting target still depends on the chosen Supabase plan, Worker traffic/overages and separate custom-domain renewal. The requested demo limits are implemented and unit-tested; cloud limits still require migrations and staging verification. Continue only with synthetic data until the high-priority gates above are closed and approved by the merchant, accountant/tax adviser, privacy/legal adviser, acquirer and technical owner as applicable.
