# 90-day growth plan — first 10 paying shops

**Target niche:** independent grocery and convenience shops in Accra/Ghana (assumption based on Kasa POS’s current catalogue).  
**Goal:** 10 paying businesses by Day 90 **if** product-readiness gates are met. This is a target, not a guarantee. No paid onboarding or live-money pilot should start before the safety gates below close.

## Preconditions (Days 1–14; do not skip)

- Assign a product/technical owner and a merchant-operations owner.
- Close staging requirements: migrations `001`–`004`; real Auth/store provisioning; cross-store/API/RLS test; fix digital-payment inventory oversell; tax/accountant review; Ghana privacy/consent notice; backup/restore; payment provider test; device/receipt checks.
- Create a verified WhatsApp Business line and support mailbox; staff the support hours in `support-and-feedback.md`.
- Interview **20 owners/managers** across at least three shop clusters (e.g., neighborhood grocery/convenience retailers, mini-marts, provision shops). Ask about checkout time, stock errors, closing cash, payment methods, current monthly costs, phone/tablet access and willingness to trial. Do not pitch unverified tax/payment claims.
- Prepare a short synthetic-data demo, one-page flyer/QR code, onboarding worksheet and clear draft pricing.

**Gate:** if payments, tax, store isolation, backup or support are not ready, continue discovery and staging only; do not take live transactions or subscription money.

## Funnel target

A working target for the first 90 days:

```text
100 qualified shop leads → 45 owner conversations → 30 demos → 18 supervised pilots → 10 paying shops
```

Track source, next step, consent to follow up, trial start, activation time, first week activity, conversion and reason lost. Keep outreach permission-based; do not bulk-spam WhatsApp groups.

## Weeks 1–2 (Days 1–14): customer discovery and readiness

- Complete the 20 discovery interviews and tag repeated pain points.
- Recruit 5 design partners willing to test on synthetic/staging data first.
- Test whether a 20–30 product setup can be completed in 30 minutes with pre-provisioned accounts.
- Validate the GHS 79 Shop price hypothesis and free-tier limits; ask owners to compare with real alternatives they use.
- Publish neither a launch date nor an unsupported compliance/payment claim.

**Targets:** 20 interviews; 5 design-partner expressions of interest; top 5 workflow fixes documented.

## Weeks 3–4 (Days 15–30): supervised pilot preparation

- Run scripted onboarding with 3 shops in a separate staging/test store; use only synthetic transactions until release gates pass.
- Observe cashier checkout, shift close, inventory count, offline sync and refund training. Ask the cashier—not just owner—what causes errors.
- Log issues in the feedback intake template; triage weekly; fix data-loss/security/payment blockers before polish.
- Re-run onboarding timing. Produce a consent-based case study only after a merchant approves every quote/photo and no customer data is visible.

**Targets:** 3 complete rehearsals; median setup below 30 minutes excluding provisioning; zero unresolved P0/P1 defects before live pilot.

## Weeks 5–8 (Days 31–60): controlled paid pilot

Only after owner, accountant, privacy and technical sign-off:

- Start with up to 5 shops in a controlled pilot. Agree written scope, support hours, data handling, subscription trial period and exit/export process.
- If provider integrations remain unapproved, launch cash-only only if cloud sync, inventory, tax/receipt and recovery are individually cleared; keep card/MoMo hidden/disabled.
- Visit each shop during its first shift. Check opening/closing cash, pending/conflicted sync events, returns, device and printer fallback.
- Offer a clear **14-day trial** of the proposed Shop plan; disclose the proposed **GHS 79/month** price before trial starts. Do not auto-charge without informed consent.
- Ask each active owner for one referral only after a successful week; do not pay unapproved commissions or collect unnecessary customer data.

**Targets:** 5 activated pilots; at least 3 weekly active; first 2–4 conversions by Day 60; setup completion >80%; response commitments met >90%.

## Weeks 9–13 (Days 61–90): repeatable acquisition

- Use referrals, in-person demos near the first customers, and introductions from wholesalers/accountants/merchant associations. Keep short WhatsApp follow-ups opt-in.
- Run two small group demos per week, each on synthetic data. Invite owners to bring their actual product worksheets, but do not upload real customer data during demos.
- Convert successful pilots to month-to-month Shop subscriptions; show cancellation and plan limits before payment.
- Interview every churned/non-converting pilot. Fix one high-frequency blocker per weekly release cycle rather than adding low-demand features.
- Publish one factual, consent-approved merchant story only after stable usage and owner approval.

**Targets:** 10 paying shops by Day 90; 5 owner-approved referrals; 80% of paid shops active weekly; no unresolved severe money/data incidents. If the readiness gates slip, move the revenue target rather than lowering the safety bar.

## Weekly scorecard

| Metric | Target / action |
|---|---|
| Qualified owner conversations | 8–10 per week during acquisition weeks |
| Demo-to-pilot conversion | Target ≥50%; interview losses if lower |
| Onboarding time | <30 minutes after provisioning; track provisioning separately |
| Pilot weekly activity | ≥80% of active pilots use checkout/reporting weekly |
| Support response | Meet published acknowledgment targets; report misses |
| Sync conflicts/payment discrepancies | Investigate every one; no silent loss accepted |
| Trial-to-paid conversion | Target ≥50%; test price/value, do not pressure owners |
| Churn / refund / complaints | Review weekly and fix causes before buying ads |

## Low-cost channels

- Founder-led shop visits and referrals; ask before leaving flyers.
- WhatsApp Business one-to-one conversations only with permission; use short helpful demos, not bulk unsolicited campaigns.
- Local wholesalers/distributors, bookkeeping/accounting practices, trader associations and business-owner groups; offer education/demo sessions, not claims of official endorsement.
- Small print flyer/QR to the landing page after the support contact and privacy details are real.
- Delay paid social/search ads until activation, support load, pricing and retention are understood.
