# Payment-security (PCI) and Ghana privacy checklist

> **Historical draft — not a current release attestation.** This checklist predates the switch from Supabase to Cloudflare D1. Replace Supabase-specific steps with verified D1/Workers staging checks before relying on it; remote database, backups, location, provider contracts and production controls remain unverified.

**Review date:** 2026-10-10 · **Scope:** source/configuration review and local synthetic tests. This is a readiness checklist, not a PCI assessment, legal opinion, DPC registration certificate or proof of compliance.

## A. PCI/payment-security checklist

| Control | Review result | Action before live money |
|---|---|---|
| Full PAN, CVV/CVC, PIN storage | No PAN/CVV/PIN fields were found in POS domain types or the inspected checkout flow. Card authorization is designed to redirect to Paystack-hosted checkout. | Re-scan all schemas, logs, email receipts, browser storage and provider dashboards after each change. Never accept card details in POS text fields or support tickets. |
| Sensitive authentication data | No retention implementation exists. PCI SSC says sensitive authentication data such as card verification codes and PIN/PIN blocks must not be retained after authorization, even encrypted. | Obtain acquirer/Paystack guidance, merchant PCI validation route and applicable SAQ. Do not claim the POS is out of scope based solely on hosted checkout. |
| Payment credentials/API keys | Code uses server-side provider routes; environment examples keep secrets out of `NEXT_PUBLIC_*`. Cloudflare instructions use Worker secrets. | Verify deployed bindings, access, rotation, build logs and backups; no real secret or merchant onboarding was reviewed. |
| TLS and origin security | Local Worker preview used local HTTP inside the sandbox; production host is not deployed. Response headers `nosniff`, referrer policy and a permissions policy were present in the local preview. | Deploy only over HTTPS, verify certificates and allowed origins, review CSP/HSTS/cookie configuration with actual preview requirements, and test from the real host. |
| Access control | Supabase Auth/server-route checks are present in source. Refund limits are per employee; zero means no refunds, and the server rechecks. | Apply migrations `003`/`004`; test cashier/manager/owner accounts against live staging RLS, API endpoints, cross-store IDs, expired sessions and privilege changes. Add MFA and staff lifecycle controls. |
| Webhooks/refund status | Source uses raw-body Paystack HMAC verification, provider reference/amount/currency checks and duplicate event IDs. Refunds remain pending/processing until provider status. | Exercise valid/invalid signatures, duplicate/delayed events, request timeout, wrong amount/currency, failure and reconciliation with Paystack test credentials. No provider request/webhook was sent in this review. |
| Idempotency and audit | Local tests cover client outbox behavior with mocked HTTP; SQL source uses event IDs and stock movement idempotency. | Run actual migration/RPC integration tests in isolated Supabase; test concurrent requests and duplicate event delivery against the database. |
| Data at rest | Supabase documents encryption at rest/in transit by default, but actual project configuration was unavailable. Local IndexedDB is explicitly not app-encrypted at rest. | Require OS full-disk encryption/screen lock on every POS device; confirm Supabase plan, backups, network/TLS and access. Local encryption remains a production gap if device-level protection is insufficient. |
| Logging/monitoring/incident response | No external log review, pen test, SIEM, intrusion alert, key-rotation drill or incident simulation was performed. | Minimize/avoid payment/contact data in logs; define access, retention, alerting, breach and provider escalation. Review Cloudflare/Supabase logs and secrets handling. |
| Vulnerability checks | `npm audit` completed with 0 reported vulnerabilities; ESLint, TypeScript and builds passed. | This is dependency audit only, not SAST/DAST, penetration testing, PCI ASV scanning or architecture validation. Arrange qualified review. |
| PCI scope/attestation | **Not determined.** | Confirm scope with the acquiring bank/payment brand/Paystack or a qualified QSA. Complete the applicable SAQ/AOC and any required ASV scans before launch. |

References: [PCI SSC Data Storage Do’s and Don’ts](https://listings.pcisecuritystandards.org/pdfs/pci_fs_data_storage.pdf) and [PCI DSS v4.0.1 SAQ D Merchant](https://docs-prv.pcisecuritystandards.org/SAQ%20(Assessment)/SAQ/PCI-DSS-v4-0-1-SAQ-D-Merchant.pdf). The merchant’s actual SAQ applicability has not been determined.

## B. Ghana Data Protection Act, 2012 (Act 843) readiness

The Act and Ghana DPC requirements are in scope. The DPC registration page states data controllers must register under section 27; whether this particular store is registered or exempt is unknown. The Act’s sections 17–24 address data protection principles, purpose/minimality/consent and notice; section 33 addresses certain correction/deletion requests and data no longer authorized to be retained. See the [official Act 843 PDF](https://dataprotection.org.gh/wp-content/uploads/2025/05/data-protection-act-2012-act-843.pdf) and [DPC registration guidance](https://dataprotection.org.gh/registration/).

| Act 843 / operational item | Current position | Owner action |
|---|---|---|
| Controller identity and registration | `/privacy` has placeholders; no merchant legal name, address, DPC registration number or registration status is configured. | Determine controller/processor roles and registration obligation; complete the DPC process before processing live customer/staff data. |
| Fair, lawful and transparent processing | Versioned template and purpose text added. It is not legal-reviewed, merchant-specific, or a complete lawful-basis determination. | Identify lawful basis per purpose, make the notice accurate and accessible, explain recipients/transfers, and train cashiers to use it. |
| Data minimization and purpose limitation | Payment email/phone are request-time inputs and are not fields in the local order. Separate consent checkboxes distinguish payment-contact sharing from receipt email; no marketing consent is implied. | Confirm provider-side retention and prevent proxy/server logs, analytics and support tooling from recording contact or payment data unnecessarily. |
| Consent evidence | Consent checkbox added. A minimized `privacy_consent_events` table/API records order/staff IDs, purpose, time and notice version, but not email/phone. Migration `003` is required. | Apply migration; test the cloud insert, duplicate request, refusal path, notice update and data subject transparency. A cashier checkbox is an attestation, not independent proof of a customer’s identity or freely given consent. |
| Customer contact/security at rest | No customer email/phone is intended to persist in IndexedDB order records. Supabase at-rest encryption is default per vendor documentation; actual project not inspected. Local IndexedDB is unencrypted at application layer. | Verify provider settings and contracts; protect POS hardware with OS full-disk encryption and screen lock. Do not use shared/public devices. |
| Staff personal data | Staff display names, role, IDs, auth linkage and refund limits may be stored. | Set retention/access roles, provide staff privacy notice, limit exports and promptly disable leavers. |
| Data-subject access/correction/deletion | The privacy page describes contacting the store and a manager review. There is no self-service portal, privacy-request database or automated deletion workflow. | Establish a secure request log, identity verification, acknowledgement/decision deadlines and owner review. Correct/remove data where required; preserve records only where a lawful retention duty applies. Test the process. |
| Retention and secure disposal | No configurable retention schedule, purge job, deletion log or backup-expiry policy was verified. Financial records may need separate retention from unnecessary customer identifiers. | Approve retention periods by data category; document legal holds, archival, backup expiry and secure disposal. Apply deletion/correction changes after restore if an old backup reintroduces them. |
| Processors and transfers | Supabase, Paystack and Resend may process data; no merchant contracts, subprocessor list, Ghana transfer analysis or DPA was reviewed. | Review contracts, locations, safeguards, breach notification, data-subject support and transfer lawfulness; update privacy notice. |
| Security safeguards and breach response | Server-side role checks, refund limits, minimized consent log and security headers added. No incident-response drill or external review was run. | Complete risk assessment, access/backup controls, staff training and an incident/breach playbook, including DPC/customer notification duties where applicable. |
| DPC status / compliance conclusion | **Unknown / not established.** | Obtain local privacy counsel/DPC guidance. This checklist is not a certification. |

## C. Migration and go-live gate

- [ ] Review/apply Supabase migrations `001`–`004` in non-production and inspect RLS/schema.
- [ ] Configure and independently verify per-employee refund limits; test zero, below, equal and above ceiling using real Auth roles in staging.
- [ ] Verify `privacy_consent_events` writes and ensure payment/email APIs fail closed without current consent.
- [ ] Complete `/privacy` controller contacts, purposes, lawful bases, retention, provider disclosures and request contact.
- [ ] Confirm DPC registration and processor/data-transfer obligations.
- [ ] Confirm local-device encryption/MDM policy and backup/restore controls.
- [ ] Complete PCI scope/SAQ and merchant/provider/acquirer approval.
- [ ] Run actual PSP test-key charges/refunds/webhooks only after authorization; never use live money for QA.
- [ ] Obtain final legal, tax, security, product and owner approval.

## D. Sources for technical shared responsibility

- [Supabase shared responsibility model](https://supabase.com/docs/guides/deployment/shared-responsibility-model): Supabase handles certain platform controls; customer remains responsible for data, access and application security. No specific project was inspected.
- [Supabase encryption/pgsodium documentation](https://supabase.com/docs/guides/database/extensions/pgsodium): vendor documentation; actual project and plan remain unverified.
- [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/): use encrypted secret bindings, not plaintext Worker variables, for runtime secrets.
