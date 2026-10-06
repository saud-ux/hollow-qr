# Online ordering

Customers order from `/menu` and pay when they collect. Staff work the order board at `/staff/orders`.
Admins manage the menu, photos, hours and fees at `/staff/admin/menu`.

## Rules (enforced in Postgres, `20261006000000_online_ordering.sql`)

- **Prices are never trusted from the browser.** `place_order()` prices every line from `menu_items`.
  It rejects sold-out or archived items (`ITEM_UNAVAILABLE`) and computes the subtotal, delivery fee, discount and total.
- **Opening hours**: `shop_settings.weekly_hours` holds 7 entries (index 0 = Sunday), checked in Asia/Riyadh time.
  A close time earlier than the open time runs past midnight.
  `ordering_paused` overrides the hours; staff toggle it from the board during rush hours.
  The shop starts paused, so nothing goes live before the admin reviews the menu and hours.
- **Fulfillment**: pickup, curbside (car required) and delivery (address required, optional GPS pin).
  Each can be switched off. Delivery adds `delivery_fee_halalas` (default 15 SAR) and can require a minimum order.
- **Payment**: on collection only (`payment_method = 'on_pickup'`). No card data touches the system.
  Online payment through Moyasar can be added later as a second method.
- **Free drink**: a customer with 5/5 cups can apply the reward at checkout. It discounts the most expensive drink in the order.
  Only one open order can hold the reward (`REWARD_IN_USE`).
- **Loyalty on completion**: `set_order_status(..., 'completed')` applies loyalty in the same transaction, through `apply_loyalty_action()`, so it lands in the same audit log with `source = 'app_order'`:
  1. If the order used the free drink, `REDEEM_REWARD` runs. If the reward was already used in store, staff see a warning.
  2. Each remaining **drink** adds one cup (desserts do not count), up to the card's capacity.
     Cups never stack past 5/5, the same rule as in store; `loyalty_result.cups_not_added` records any overflow.
  3. The Wallet pass is pushed an update.
- **Status flow**: `new → preparing → ready → (out_for_delivery →) completed`; any open order can be cancelled by staff, with an optional reason shown to the customer.
  A customer can cancel only while the order is `new`, and can tap «وصلت» on curbside orders, which highlights the ticket on the board.
- **Idempotency**: each checkout carries an `idempotencyKey`. A retry returns the same order instead of creating a second one.

## Menu photos

Admins upload from the dashboard. The browser resizes the photo to 1000 px JPEG first.
The Worker checks the type and magic bytes (JPEG, PNG or WebP, at most 2 MB) and stores the file in the public Supabase Storage bucket `menu-images` under a new random path per upload.
The migration creates the bucket where Supabase Storage exists.

## The order board

- Polls every 5 seconds, and rings a chime for every new order, repeating every 15 seconds until someone accepts it.
  iOS needs one tap («اضغط لتشغيل تنبيه الطلبات») before a page may play sound.
- Keeps the screen awake (Screen Wake Lock) while open, and shows the new-order count in the tab title.
- Three columns on iPad (جديدة / قيد التحضير / جاهزة), tabs on phones.

## Deploying

1. Apply `supabase/migrations/20261006000000_online_ordering.sql` to the production database.
   The hosted project's migration history was created with different version numbers, so apply the file directly (SQL editor or the Supabase MCP `apply_migration`) rather than `supabase db push`.
2. `pnpm run deploy`.
3. In `/staff/admin/menu`: set the real opening hours, check the prices, upload photos, then switch off «إيقاف الطلبات مؤقتًا».
