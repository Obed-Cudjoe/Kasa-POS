# Cashier training video script — checkout and refunds

**Length:** about 2 minutes 45 seconds  
**Audience:** cashiers at Ghanaian grocery/convenience shops  
**Record using:** staging/demo tenant and synthetic products/orders only. Blur email, phone, names, store IDs and provider references. No customer card information or live payment credentials on screen.

| Time | Screen / shot | Narration |
|---|---|---|
| 0:00–0:12 | Title card: “Kasa POS: checkout and returns” | “Welcome. This quick guide covers a cash sale, what to check before handing over goods, and how to ask a manager to process a return.” |
| 0:12–0:28 | Sign in; show cashier name/role and **Shifts & cash** | “Sign in with your own account. Check that the right shop and your name are shown. Open your shift and enter the counted opening float. Never share your login.” |
| 0:28–0:58 | **Checkout**; tap two synthetic products; show quantities, price and tax total | “Tap each product once, then adjust quantity carefully. Check the name, quantity and total. Confirm the displayed tax profile matches the shop’s approved setup. If a price or tax looks wrong, stop and ask the manager—don’t guess.” |
| 0:58–1:20 | Select **Cash**; enter tender; show change; record sale; show synthetic receipt | “For cash, count the money, enter the amount received and check the change. Confirm the cash sale only after you have received the correct amount. Offer the receipt using the shop’s approved print or share method.” |
| 1:20–1:38 | Briefly show Card/Mobile Money screens in staging with a “TEST ONLY” overlay | “Card and mobile money are only available when the merchant account is configured. A screenshot, redirect or timeout is not proof of payment. Wait for the POS to show verified confirmation before handing over goods as paid. Never enter a card number or CVV into the POS.” |
| 1:38–1:52 | **Transactions**; search for a synthetic sale; open it | “For a return, find the original transaction first. Confirm the receipt, item and quantity with the customer and follow the shop’s return policy.” |
| 1:52–2:18 | Show refund selection on staging; choose quantity; discuss restock condition; show authorization message | “Select only the items actually returned. Mark an item for restock only if it is saleable and physically returned to stock. The POS checks your refund authority. If you see a limit message, stop and ask the manager—do not use someone else’s login.” |
| 2:18–2:35 | Show cash refund recorded; then show synthetic digital refund as pending | “A cash refund is recorded against the till. A digital refund can remain pending until the payment provider confirms it. Do not promise a digital refund is complete until its provider status is verified, and never submit it again while the first request is unresolved.” |
| 2:35–2:45 | Shift close reminder; final card with placeholder help channel | “At shift end, count the drawer and close the shift. For an error or unresolved payment, contact your manager through the shop’s approved support channel. Thank you.” |

## Production notes

- Add a clearly visible `STAGING / SYNTHETIC DATA` watermark while recording.
- Use a test account and dummy receipts. Do not show a real customer name, phone/email, authentication screen, secret, Paystack dashboard credential or Cloudflare URL or secret.
- The current app has no sale-void flow; do not demonstrate a “cancel/void sale” button. If a sale is wrong, follow the shop’s supervisor escalation/reconciliation procedure.
- Include a brief disclaimer at the end: “Tax treatment follows your shop’s adviser-approved configuration. This software is not a GRA/E-VAT certification.”
- The WhatsApp/email support detail is still a placeholder and must be replaced with the approved contact before publishing the video.
