-- =============================================================================
-- English for the customer screens
--   * menu_items.description_en / option_label_en; options carry name_en and
--     note_en in their jsonb. Empty English text falls back to the Arabic.
--   * push_devices.lang: order notifications in the app's language.
-- =============================================================================

alter table public.menu_items
  add column description_en text
    constraint menu_items_description_en_length check (description_en is null or char_length(btrim(description_en)) between 1 and 300),
  add column option_label_en text
    constraint menu_items_option_label_en_length check (option_label_en is null or char_length(btrim(option_label_en)) between 1 and 40);

alter table public.push_devices
  add column lang text not null default 'ar'
    constraint push_devices_lang check (lang in ('ar', 'en'));
