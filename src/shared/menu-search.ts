/**
 * Menu search: matches what the customer types against every name an item
 * goes by (Arabic and English, its description, its origins, its category).
 * Arabic is normalized so spelling variants still match: «اثيوبي» finds
 * «إثيوبي», «كركديه» finds «كركدية».
 */
import { CATEGORY_LABELS_AR, CATEGORY_LABELS_EN, type MenuItem } from "./ordering";

export function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "") // harakat, dagger alef, tatweel
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function haystack(item: MenuItem): string {
  const parts = [
    item.nameAr,
    item.nameEn,
    item.descriptionAr,
    item.descriptionEn,
    CATEGORY_LABELS_AR[item.category],
    CATEGORY_LABELS_EN[item.category],
    ...item.options.flatMap((o) => [o.nameAr, o.nameEn, o.noteAr, o.noteEn]),
  ];
  return normalizeSearch(parts.filter(Boolean).join(" "));
}

/** Every word typed must appear somewhere in the item's text (in any order). */
export function matchesSearch(item: MenuItem, query: string): boolean {
  const words = normalizeSearch(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const text = haystack(item);
  return words.every((w) => text.includes(w));
}

/** Items that match, best first: a name that starts with the query, then a name that contains it, then the rest. */
export function searchMenu(items: MenuItem[], query: string): MenuItem[] {
  const q = normalizeSearch(query);
  if (!q) return items;
  const score = (item: MenuItem) => {
    const names = [item.nameAr, item.nameEn ?? ""].map(normalizeSearch);
    if (names.some((n) => n.startsWith(q))) return 0;
    if (names.some((n) => n.includes(q))) return 1;
    return 2;
  };
  return items
    .filter((i) => matchesSearch(i, query))
    .map((item, index) => ({ item, index, rank: score(item) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((x) => x.item);
}
