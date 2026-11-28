# Loyverse POS link

When staff mark an app order **مكتمل** on the order board, the Worker sends it to Loyverse as a sale receipt. Sales reports and the card terminal's settlement then match without anyone typing the order into the till.

## Setup (Loyverse)

1. **Integrations → Access tokens**: create a token (no expiry).
2. **Settings → Payment types**: add a type named **تطبيق** (type "Other").
3. **Items**: give each item the same name it has in the app. Matching ignores diacritics, hamza forms (أ/إ/ا), ة/ه, ى/ي and extra spaces. An item with origins (e.g. إثيوبي) matches a Loyverse variant with that option value, or an item named "<item> <origin>". Otherwise the origin goes in the line note.
4. Add an item named **طلب تطبيق** with a variable price. It carries the delivery fee and any app item without a match, with the real name in the line note. Without it, an order with an unmatched item is **not sent** (logged as `loyverse.unmatched`) rather than sent with a wrong total.

## Setup (Cloudflare)

Workers & Pages → hollow-rewards → Settings → Variables and Secrets → add the **secret** `LOYVERSE_ACCESS_TOKEN`. No redeploy of the code is needed to change it, but the code itself must be deployed first.

Optional vars: `LOYVERSE_STORE_ID` (only with several stores), `LOYVERSE_PAYMENT_TYPE_NAME` (default تطبيق), `LOYVERSE_WALLET_PAYMENT_TYPE_NAME` (puts the in-app balance part on its own payment type), `LOYVERSE_FALLBACK_ITEM_NAME` (default طلب تطبيق).

Then open **المبيعات والإحصاءات → ربط الكاشير → فحص الربط** to see that the payment type is found and which menu items match.

## Behaviour

- Receipt totals equal the app total to the halala. Order-level discounts (free drink, gift cups, coupon) come off the dearest units first, so a free drink shows as one drink at 0. Menu discounts are already in the line prices.
- Receipt `order` is `تطبيق #<number>`, the note has the fulfilment type and customer name, and the date is the completion time.
- Retries: up to 3 tries on 429/5xx. A request with no answer is not retried, to avoid a double receipt. Failures are logged as `loyverse.failed`.
- **Staff must stop entering app orders by hand in the till**, or they are counted twice.
- Not covered yet: refunds or cancellations after completion. Do those in Loyverse directly.
