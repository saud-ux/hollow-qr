/**
 * Menu search: matches what the customer types against every name an item
 * goes by (Arabic and English, its description, its origins, its category).
 * Arabic is normalized so spelling variants still match: «اثيوبي» finds
 * «إثيوبي», «كركديه» finds «كركدية». Words customers use for the same thing
 * («ايس» / «بارد» / ice, «في ستين» / V60) find each other, and a typo still
 * finds the closest items when nothing matches exactly.
 */
import { CATEGORY_LABELS_AR, CATEGORY_LABELS_EN, isOrderable, type MenuItem } from "./ordering";

export function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "") // harakat, dagger alef, tatweel
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Words customers use for the same thing, in Arabic, English and the ways
// they spell them. A word typed from one group finds items with any of them.
const SYNONYM_GROUPS: string[][] = [
  ["v60", "في ستين", "فيستين", "في60", "مقطره", "مقطر", "drip", "دريب", "فلتر", "filter", "pour over"],
  ["ice", "iced", "ايس", "بارد", "بارده", "cold", "مثلج"],
  ["hot", "حار", "حاره", "هوت", "ساخن"],
  ["coffee", "قهوه", "كوفي"],
  ["matcha", "ماتشا", "متشا", "ماتشه", "ماچا", "macha"],
  ["karkade", "كركديه", "كركدي", "karkadeh", "hibiscus"],
  ["waffle", "وافل", "وفل", "wafle", "وافلز"],
  ["chocolate", "شوكولاته", "شوكولا", "شوكلت", "شوكليت", "تشوكلت", "تشوكو", "شوكو", "choco"],
  ["cheese", "تشيز", "جبن", "تشيزكيك", "cheesecake"],
  ["cake", "كيك", "كيكه"],
  ["pecan", "بيكان", "بيكن"],
  ["date", "dates", "دبس", "تمر", "molasses"],
  ["box", "بوكس", "بكس", "علبه"],
  ["dessert", "desserts", "حلويات", "حلا", "حلى", "حلو", "sweet", "sweets"],
  ["drink", "drinks", "مشروبات", "مشروب"],
].map((group) => group.map(normalizeSearch));

/** Phrases of more than one word become the group's first word, so "في ستين" is one search word. */
function joinPhrases(q: string): string {
  let out = ` ${q} `;
  for (const group of SYNONYM_GROUPS) {
    for (const term of group) if (term.includes(" ")) out = out.replaceAll(` ${term} `, ` ${group[0]} `);
  }
  return out.trim();
}

/** The normalized words of a query (phrases joined). */
function queryWords(query: string): string[] {
  return joinPhrases(normalizeSearch(query)).split(" ").filter(Boolean);
}

/** A typed word, plus every word that means the same (when it is, or starts, one of them). */
function alternatives(word: string): string[] {
  const out = new Set([word]);
  for (const group of SYNONYM_GROUPS) {
    if (group.some((t) => t === word || (word.length >= 3 && t.startsWith(word)))) group.forEach((t) => out.add(t));
  }
  return [...out];
}

interface Indexed {
  text: string;
  /** The text with a space in front, so " word" finds a word's start. */
  padded: string;
  /** The same text without spaces: «تشيزكيك» finds «تشيز كيك». */
  joined: string;
  tokens: string[];
}

function indexText(parts: (string | null | undefined)[]): Indexed {
  const text = normalizeSearch(parts.filter(Boolean).join(" "));
  return { text, padded: ` ${text}`, joined: text.replace(/ /g, ""), tokens: text.split(" ") };
}

/** Everything an item goes by, and its names alone (a match in the name ranks higher). */
const cache = new WeakMap<MenuItem, { all: Indexed; name: Indexed }>();

function indexOf(item: MenuItem): { all: Indexed; name: Indexed } {
  let hit = cache.get(item);
  if (!hit) {
    hit = {
      all: indexText([
        item.nameAr,
        item.nameEn,
        item.descriptionAr,
        item.descriptionEn,
        CATEGORY_LABELS_AR[item.category],
        CATEGORY_LABELS_EN[item.category],
        ...item.options.flatMap((o) => [o.nameAr, o.nameEn, o.noteAr, o.noteEn]),
      ]),
      name: indexText([item.nameAr, item.nameEn]),
    };
    cache.set(item, hit);
  }
  return hit;
}

/** A word that starts `alt` (or «ال» + `alt`): «بارد» finds «البارد» but «ice» doesn't find «juice». */
function startsWord(padded: string, alt: string): boolean {
  return padded.includes(` ${alt}`) || padded.includes(` ال${alt}`);
}

/** The typed word anywhere in the text, or a word that means the same at the start of a word. */
function hasWord(index: Indexed, word: string): boolean {
  if (index.text.includes(word) || index.joined.includes(word)) return true;
  return alternatives(word).some((alt) => startsWord(index.padded, alt));
}

/** Edit distance between `a` and the start of `b`, or Infinity once it passes `max`. */
function prefixDistance(a: string, b: string, max: number): number {
  let best = Infinity;
  // Compare against the token's start, a letter shorter or longer than the word.
  for (let len = Math.max(1, a.length - 1); len <= Math.min(b.length, a.length + 1); len++) {
    const t = b.slice(0, len);
    let prev = Array.from({ length: t.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      let rowMin = i;
      for (let j = 1; j <= t.length; j++) {
        const v = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === t[j - 1] ? 0 : 1));
        row.push(v);
        rowMin = Math.min(rowMin, v);
      }
      if (rowMin > max) {
        prev = [];
        break;
      }
      prev = row;
    }
    if (prev.length) best = Math.min(best, prev[t.length]!);
  }
  return best <= max ? best : Infinity;
}

/** How many letters a word may be off by and still count: one, or two in longer words. */
function slack(word: string): number {
  if (word.length < 3) return 0;
  return word.length >= 6 ? 2 : 1;
}

/** Words that mean the same as a near miss: «choclate» is a slip of «chocolate», so «choco» counts too. */
function nearAlternatives(word: string): string[] {
  const max = slack(word);
  if (max === 0) return [];
  return SYNONYM_GROUPS.filter((group) => group.some((t) => prefixDistance(word, t, max) !== Infinity)).flat();
}

/** A word typed with a slip still finds the item. */
function nearlyHasWord(index: Indexed, word: string): boolean {
  if (hasWord(index, word)) return true;
  const max = slack(word);
  if (max === 0) return false;
  return (
    index.tokens.some((token) => prefixDistance(word, token, max) !== Infinity) || nearAlternatives(word).some((alt) => startsWord(index.padded, alt))
  );
}

/** Every word typed must appear somewhere in the item's text (in any order). */
export function matchesSearch(item: MenuItem, query: string): boolean {
  const words = queryWords(query);
  if (words.length === 0) return true;
  const { all } = indexOf(item);
  return words.every((w) => hasWord(all, w));
}

function ranked(items: MenuItem[], query: string, keep: (item: MenuItem) => boolean): MenuItem[] {
  const words = queryWords(query);
  const q = words.join(" ");
  const score = (item: MenuItem) => {
    const names = [item.nameAr, item.nameEn ?? ""].map(normalizeSearch);
    if (names.some((n) => n.startsWith(q))) return 0;
    if (names.some((n) => n.includes(q))) return 1;
    const { name } = indexOf(item);
    if (words.every((w) => hasWord(name, w))) return 2;
    return 3;
  };
  return items
    .filter(keep)
    .map((item, index) => ({ item, index, rank: score(item), out: isOrderable(item) ? 0 : 1 }))
    .sort((a, b) => a.out - b.out || a.rank - b.rank || a.index - b.index)
    .map((x) => x.item);
}

/**
 * Items that match, best first: available before sold out, then a name that
 * starts with the query, one that contains it, one with every word, and last
 * the items that match only in their description, origins or category.
 */
export function searchMenu(items: MenuItem[], query: string): MenuItem[] {
  if (queryWords(query).length === 0) return items;
  return ranked(items, query, (item) => matchesSearch(item, query));
}

/**
 * What the menu shows for a query: the exact matches, or, when there are
 * none, the closest ones (a typo or two) with `closest` set.
 */
export function searchMenuForgiving(items: MenuItem[], query: string): { items: MenuItem[]; closest: boolean } {
  const exact = searchMenu(items, query);
  const words = queryWords(query);
  if (exact.length > 0 || words.length === 0) return { items: exact, closest: false };
  const near = ranked(items, query, (item) => {
    const { all } = indexOf(item);
    return words.every((w) => nearlyHasWord(all, w));
  });
  return { items: near, closest: near.length > 0 };
}

/**
 * The words of a name to highlight for a query, as [start, end) ranges in
 * `text`: whole words, since a mark in the middle of an Arabic word would
 * break its joined letters. A word counts when it holds what was typed,
 * starts with a word that means the same, or (with `nearly`) is a letter or
 * two off.
 */
export function matchRanges(text: string, query: string, nearly = false): [number, number][] {
  const words = [...text.matchAll(/[\p{L}\p{N}\p{M}]+/gu)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
    norm: normalizeSearch(m[0]),
  }));
  const marked = new Set<number>();
  for (const typed of queryWords(query)) {
    if (typed.length < 2) continue;
    const alts = nearly ? [...alternatives(typed), ...nearAlternatives(typed)] : alternatives(typed);
    words.forEach((w, i) => {
      if (
        w.norm.includes(typed) ||
        alts.some((alt) => startsWord(` ${w.norm}`, alt)) ||
        (nearly && slack(typed) > 0 && prefixDistance(typed, w.norm, slack(typed)) !== Infinity)
      ) {
        marked.add(i);
      }
      // «تشيزكيك» typed for «تشيز كيك»: both words.
      const next = words[i + 1];
      if (next && !w.norm.includes(typed) && !next.norm.includes(typed) && (w.norm + next.norm).includes(typed)) {
        marked.add(i).add(i + 1);
      }
    });
  }
  const ranges: [number, number][] = [];
  for (const i of [...marked].sort((a, b) => a - b)) {
    const w = words[i]!;
    const last = ranges.at(-1);
    // Neighbouring marked words share one mark, with the space between them.
    if (last && marked.has(i - 1) && /^\s+$/.test(text.slice(last[1], w.start))) last[1] = w.end;
    else ranges.push([w.start, w.end]);
  }
  return ranges;
}
