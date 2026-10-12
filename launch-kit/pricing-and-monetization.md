# Kasa POS pricing and monetization — launch hypothesis

**Target:** price-sensitive independent grocery and convenience shops in Ghana.  
**Status:** proposed prices for customer interviews, **not implemented in the app and not yet committed for sale**. All values are GHS, per shop/month, before any applicable tax that an accountant confirms.

## Recommended simple tiers

| Plan | Draft price | Included | Deliberately excluded |
|---|---:|---|---|
| **Starter** | **GHS 0/month** | One shop/location; one registered device; up to 50 active products; up to 100 completed sales/month; basic checkout, local offline cash queue, basic day/shift totals; self-serve help material. | Advanced exports/analytics, multi-device cloud sync, multi-location consolidation and direct priority support. |
| **Shop** | **GHS 79/month per shop** | One location; unlimited products and completed sales; up to 3 devices and 5 staff profiles; cloud sync; role/refund controls; advanced sales, tax and stock movement reports; WhatsApp support during published hours. | Consolidated multi-location dashboard, transfers between branches and organization-level staff access. |
| **Multi-shop** | **GHS 199/month for up to 3 locations**, then a proposed **GHS 40/month per additional location** | Planned consolidated reporting, central product catalogue, location-level staff and stock visibility, and up to 10 devices initially. | **Not available to sell yet.** Multi-location tenant selection, shared-user policy, inventory transfer and reporting need implementation and security tests first. |

The pricing should be tested in 15–20 owner interviews before publication. Ask about current monthly POS spend, number of tills, product count, cloud-sync value and what a failed sale costs—not only whether the owner “likes” the price. Compare a GHS 59–99 Shop range and a GHS 149–249 multi-location range; do not claim the draft price is a market-tested benchmark.

## Freemium and payment-processing policy

- Make the free plan useful, not a crippled demo: one shop, one device, a small active catalogue and a transparent monthly transaction allowance.
- **Do not block a cashier mid-sale** when an offline device reaches the transaction allowance. The subscription system should count cloud-acknowledged sales, show a warning, preserve/retry offline records and prompt the owner to upgrade after sync; it must never delete a sale or lose an outbox event.
- Start with subscription revenue, not a Kasa percentage of every tender. Let the merchant pay the gateway’s disclosed processing charges under their own merchant agreement. Do not add a payment surcharge or hidden markup without legal/acquirer/provider review and clear customer disclosure.
- Do not use processing fees to monetize a cash sale or penalize offline behavior. If gateway referral revenue is later considered, disclose the relationship and keep the merchant’s PSP contract independent.
- Offer month-to-month billing initially. A small optional annual discount can be tested after retention is understood. Publish cancellation, export and downgrade rules before taking subscription payments; preserve business records on cancellation.

## Implementation and launch gates

None of these limits are currently enforced by billing code. Before accepting subscriptions, implement a server-side plan ledger (shop ID, plan, billing period, usage counters, grace/overage policy), protect counters from offline/double-sync inflation, and test plan changes/refunds. Add a clear read-only grace period rather than disabling checkout abruptly for a shop that is reconciling its till.

Do not charge for **Multi-shop** until multi-tenant isolation, organization access, stock transfer and cross-location reporting work in staging. Remote D1 migrations/auth staging, store isolation, tax/privacy review, backups and payment/inventory risks remain pre-launch gates.
