-- Items the owner marks as best sellers: shown together at the top of the
-- menu, and badged where they appear in their own category.
alter table public.menu_items add column is_best_seller boolean not null default false;
