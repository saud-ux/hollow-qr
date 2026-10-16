-- ---------------------------------------------------------------------------
-- Deleting a menu item from the dashboard.
--
-- An item that was never ordered is deleted for good. One that past orders
-- point at can't be (order_items restricts it), so it is kept for those
-- orders and marked deleted: it leaves the menu and the dashboard's lists,
-- including the hidden ones, while receipts and the sales report still show
-- it. Deleted items are archived too, so ordering already refuses them.
-- ---------------------------------------------------------------------------

alter table public.menu_items add column if not exists deleted_at timestamptz;
