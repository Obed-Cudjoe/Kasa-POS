# Early-customer support and product update plan

**Target:** direct, human support for small shop owners; WhatsApp Business first, email as a backup.  
**Status:** proposed operations plan. No verified phone number, WhatsApp Business account or support mailbox has been provided or created.

## 1. Set up the channels before publishing

1. Obtain owner approval for a **dedicated business phone number**; do not use a cashier’s personal number without explicit consent and a handover plan.
2. Register WhatsApp Business on that number; add Kasa POS name, logo, support hours, short description, privacy notice link and a greeting/away message. Enable two-step verification and restrict linked devices.
3. Create a monitored mailbox on the business domain, e.g. `support@<approved-domain>`; verify sender/DNS and restrict access to named support staff. Do not invent or publish an address before it exists.
4. Publish the same contact and support hours in the app/landing page/training material. Remove the `ADD VERIFIED WHATSAPP/EMAIL` placeholders only after testing inbound/outbound messages.
5. Create a private support register (access-limited spreadsheet or ticket list) with case ID, shop ID, opened/updated time, severity, category, redacted summary, owner and disposition. Do not store secrets, full customer contact records, card details, CVV, PIN, OTPs or unnecessary screenshots.

## 2. Proposed response commitments

These are **acknowledgement targets**, not guaranteed resolution times. Publish them only when a person is scheduled to meet them.

- **Support hours:** Monday–Saturday, 08:00–20:00 Ghana time (GMT). Sunday/public-holiday coverage: next support window, except a separately agreed incident rota.
- **Urgent — till down, suspected duplicate payment/refund, data exposure, or multiple shops unable to trade:** acknowledge within **1 business hour** during support hours; provide a safe workaround/next update within **4 business hours**. Never instruct a cashier to retry an unresolved card/MoMo charge or refund.
- **High — one shop blocked from checkout/sync, inventory conflict:** acknowledge within **4 business hours**; target a diagnosis or next action by end of the next business day.
- **Normal — setup/how-to/report question:** acknowledge within **1 business day**; target an answer within **2 business days**.
- If the inbox is unattended, the WhatsApp away message should state the next staffed window and tell the cashier to contact the shop manager for till/payment reconciliation.

## 3. Triage and safe handling

1. Ask for the shop name/ID, device/browser, approximate time, exact non-sensitive error text, whether the device is online, and what action has already been taken.
2. Ask the user to stop duplicate provider actions while a digital payment/refund is pending. Escalate money movement to the owner/provider reconciliation process.
3. Severity: **P0** possible data/security/payment incident; **P1** shop unable to trade or data conflict; **P2** broken workflow with workaround; **P3** feature request/cosmetic issue.
4. Never ask for a password, service-role key, GitHub/Cloudflare token, full card number, CVV, PIN, OTP, or customer payment screenshot. Do not request raw exports containing customer data over WhatsApp.
5. For a suspected privacy/security incident, restrict access, preserve relevant timestamps/IDs without copying unnecessary personal data, notify the owner immediately and use the approved incident/legal process. Do not promise deletion or regulatory compliance in chat.

## 4. Feedback and release cadence

- Acknowledge every feature request and assign a case ID. Capture shop type, role, task, frequency, impact, current workaround and expected outcome. Ask permission before storing a contact detail for follow-up.
- Review new cases weekly with the product/technical owner. Cluster repeated requests, separate defects from feature ideas, and record “accepted / researching / planned / declined” with a short reason.
- Review Ghana tax and receipt requirements at least monthly with an accountant/GRA source or sooner after an official notice. Never silently overwrite a tax profile; preserve historical snapshots and communicate effective dates.
- Review payment methods/provider availability and refund behavior monthly with the merchant/provider. Run sandbox tests before enabling a new channel; no screenshots or redirects count as proof of settlement.
- Review inventory conflicts/negative stock weekly in the pilot; distinguish software defects from physical-count errors and protect the audit trail.
- Target a monthly release only after staging tests: checkout/tax/refund/shift, offline outbox replay, tenant isolation, backup restore smoke check, device compatibility and release notes. Use an urgent hotfix path for security/data-loss defects.
- Send users a short WhatsApp/email release note with date, changes, known issues and rollback/support contact. Let owners schedule non-urgent updates around trading hours.

## 5. Feedback intake form

Use `feedback-intake-template.md` as the initial WhatsApp/email prompt or copy it into a secure form tool. The form is a process template only; no Google Form, CRM or external channel has been created.
