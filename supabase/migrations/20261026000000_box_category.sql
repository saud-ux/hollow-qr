-- =============================================================================
-- A third menu section, «البوكسات»: boxes to share, like the waffle box.
-- Boxes are not drinks, so like desserts they earn no loyalty cup and can't
-- take the free drink or gift cups (those SQL checks look for 'drink' only).
--
-- Only adds the value: Postgres won't use a new enum value in the same
-- transaction, so items are moved into the section afterwards.
-- =============================================================================

alter type public.menu_category add value if not exists 'box';
