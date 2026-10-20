/**
 * Menu search: matches what the customer types against every name an item
 * goes by (Arabic and English, its description, its origins, its category).
 * It forgives what people really type:
 * - spelling variants: «اثيوبي» finds «إثيوبي», «كركديه» finds «كركدية»;
 * - «ال» and the letter stuck before it: «القهوة», «بالحليب»;
 * - everyday words for the same thing: «آيس» finds «بارد», «حلا» finds the desserts;
 * - a slip of the finger: «ماتشه» finds «ماتشا», and the search offers the menu's spelling.
 */
import { CATEGORY_LABELS_AR, CATEGORY_LABELS_EN, isOrderable, type MenuItem } from "./ordering";

/** Harakat, the dagger alef and the tatweel: they don't change the word. */
const MARK = /[\u064B-\u065F\u0670\u0640]/;

export function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(new RegExp(MARK.source, "g"), "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** «القهوه» → «قهوه», «بالحليب» → «حليب»: the article (and و ف ب ك before it, or «لل») isn't part of the word. */
const ARTICLE = /^(?:[وفبك]?ال|لل)(?=.{2})/;
export const stripArticle = (word: string) => word.replace(ARTICLE, "");

/** Words that mean the same thing on a café menu: any one finds the others. */
const SYNONYMS: string[][] = [
  ["بارد", "ايس", "مثلج", "ice", "iced", "cold"],
  ["حار", "ساخن", "hot"],
  ["حلويات", "حلا", "حلى", "حلو", "dessert", "desserts", "sweet", "sweets"],
  ["بوكسات", "بوكس", "box", "boxes"],
  ["مشروبات", "مشروب", "drink", "drinks"],
  ["قهوه", "كوفي", "coffee"],
  ["مقطره", "فلتر", "v60", "filter", "drip", "pour"],
  ["عربي", "سعودي"],
  ["شوكولاته", "شوكولا", "شوكلت", "تشوكلت", "chocolate", "choco"],
  ["تمر", "دبس", "date", "dates"],
  ["كركديه", "karkade", "hibiscus"],
  ["كيكه", "كيك", "cake"],
  ["تشيز", "جبن", "cheese"],
  ["حليب", "لبن", "milk"],
  ["شاي", "tea"],
  ["لاتيه", "latte"],
  ["اسبريسو", "اسبرسو", "espresso"],
  ["فانيلا", "vanilla"],
  ["كراميل", "caramel"],
].map((group) => group.map(normalizeSearch));

/** The other words for `form`: it is one of them, the start of one (still typing), or one with an ending (حارة, desserts). */
function synonymsOf(form: string): string[] {
  const found = new Set<string>();
  for (const group of SYNONYMS) {
    const applies = group.some(
      (m) => m === form || (form.length >= 3 && m.startsWith(form)) || (m.length >= 3 && form.startsWith(m) && form.length <= m.length + 2),
    );
    if (applies) for (const m of group) if (m !== form) found.add(m);
  }
  return [...found];
}

/** An item's text, prepared once per menu load. */
interface Indexed {
  /** Its names (Arabic, English), folded, with and without articles. */
  names: string[];
  nameTokens: string[];
  /** Every word it goes by, with and without its article. */
  tokens: string[];
  text: string;
  /** Its names without spaces, for a name typed as one word («تشيزكيك»). */
  compact: string[];
  /** The way the menu writes each word (folded word → as written), names first. */
  written: Map<string, string>;
}

const withArticleless = (words: string[]) => [...new Set(words.flatMap((w) => [w, stripArticle(w)]))];
const words = (text: string) => text.split(" ").filter(Boolean);

const indexCache = new WeakMap<MenuItem, Indexed>();

function indexOf(item: MenuItem): Indexed {
  const cached = indexCache.get(item);
  if (cached) return cached;
  const rawNames = [item.nameAr, item.nameEn].filter((n): n is string => Boolean(n));
  const rawOther = [
    item.descriptionAr,
    item.descriptionEn,
    CATEGORY_LABELS_AR[item.category],
    CATEGORY_LABELS_EN[item.category],
    ...item.options.flatMap((o) => [o.nameAr, o.nameEn, o.noteAr, o.noteEn]),
  ].filter((p): p is string => Boolean(p));
  const names = rawNames.map(normalizeSearch);
  const written = new Map<string, string>();
  for (const raw of [...rawNames, ...rawOther]) {
    for (const piece of raw.split(/\s+/)) {
      const folded = normalizeSearch(piece);
      if (!folded || folded.includes(" ")) continue;
      if (!written.has(folded)) written.set(folded, piece.replace(/[^\p{L}\p{N}\p{M}]+/gu, ""));
      if (!written.has(stripArticle(folded))) written.set(stripArticle(folded), piece.replace(/[^\p{L}\p{N}\p{M}]+/gu, ""));
    }
  }
  const nameTokens = withArticleless(names.flatMap(words));
  const text = normalizeSearch([...rawNames, ...rawOther].join(" "));
  const indexed: Indexed = {
    names: [...new Set([...names, ...names.map((n) => words(n).map(stripArticle).join(" "))])],
    nameTokens,
    tokens: withArticleless(words(text)),
    text,
    compact: names.map((n) => n.replace(/ /g, "")),
    written,
  };
  indexCache.set(item, indexed);
  return indexed;
}

/** A word typed is found at the start of a word, or anywhere once it is 4 letters or more («cake» in «cheesecake»). */
const found = (form: string, tokens: string[], text: string) => tokens.some((t) => t.startsWith(form)) || (form.length >= 4 && text.includes(form));

/**
 * How well one typed word matches an item (lower is better), or null:
 * 0 its name, as typed; 1 its name, through a synonym; 2 elsewhere, as typed; 3 elsewhere, through a synonym.
 */
function matchWord(ix: Indexed, word: string): number | null {
  const forms = [...new Set([word, stripArticle(word)])];
  const others = [...new Set(forms.flatMap(synonymsOf))];
  const nameText = ix.names.join(" ");
  if (forms.some((f) => found(f, ix.nameTokens, nameText))) return 0;
  if (others.some((s) => ix.nameTokens.some((t) => t.startsWith(s)))) return 1;
  if (forms.some((f) => found(f, ix.tokens, ix.text))) return 2;
  if (others.some((s) => ix.tokens.some((t) => t.startsWith(s)))) return 3;
  return null;
}

/** Typing slips (a letter missed, added, swapped or wrong): optimal string alignment distance, giving up past `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2]! + 1);
      row.push(v);
      best = Math.min(best, v);
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = row;
  }
  return prev[b.length]!;
}

/** Slips allowed in a word: none up to 3 letters, one up to 6, two after that. */
const slipsAllowed = (word: string) => (word.length >= 7 ? 2 : word.length >= 4 ? 1 : 0);

type Near = {
  dist: number;
  /** The part of the menu's word it matched (to mark it). */
  slice: string;
  /** The menu's word, as written (to offer it). */
  offer: string;
  inName: boolean;
};

/** The closest word of the item to a word that has a slip in it. */
function nearWord(ix: Indexed, word: string): Near | null {
  const max = slipsAllowed(word);
  if (max === 0) return null;
  let best: Near | null = null;
  const consider = (candidate: string, inName: boolean, offer: string) => {
    for (let len = word.length - 1; len <= word.length + 1; len++) {
      if (len < 1 || len > candidate.length) continue;
      // A shorter slice of a longer word is the customer still typing it.
      if (len < candidate.length && len < word.length) continue;
      const slice = candidate.slice(0, len);
      const dist = editDistance(word, slice, max);
      if (dist > max) continue;
      if (!best || dist < best.dist || (dist === best.dist && inName && !best.inName)) best = { dist, slice, offer, inName };
    }
  };
  for (const t of ix.nameTokens) consider(t, true, ix.written.get(t) ?? t);
  ix.compact.forEach((c, i) => consider(c, true, ix.names[i] ?? c));
  for (const t of ix.tokens) consider(t, false, ix.written.get(t) ?? t);
  return best;
}

export interface MenuSearch {
  /** The items found, best first. */
  items: MenuItem[];
  /**
   * Set when nothing matched as typed and the items are close matches
   * instead: the query in the menu's own spelling, to offer «هل تقصد …؟».
   */
  suggestion: string | null;
  /** The folded words to mark in what's shown (see `highlight`). */
  terms: string[];
}

/**
 * Items that match, best first: what can be ordered before what's sold out,
 * then a name that starts with the query, a name with every word in it, a
 * name through a synonym, then the rest (description, origins, category).
 * When nothing matches, close spellings are tried.
 */
export function findInMenu(items: MenuItem[], query: string): MenuSearch {
  const q = normalizeSearch(query);
  if (!q) return { items, suggestion: null, terms: [] };
  const typed = words(q);
  const qBare = typed.map(stripArticle).join(" ");
  const terms = new Set(typed.flatMap((w) => [w, stripArticle(w), ...synonymsOf(w), ...synonymsOf(stripArticle(w))]));

  const ranked = (list: { item: MenuItem; index: number; tier: number; dist: number }[]) =>
    list
      .sort((a, b) => Number(!isOrderable(a.item)) - Number(!isOrderable(b.item)) || a.tier - b.tier || a.dist - b.dist || a.index - b.index)
      .map((x) => x.item);

  const exact = items.flatMap((item, index) => {
    const ix = indexOf(item);
    const levels = typed.map((w) => matchWord(ix, w));
    if (levels.some((l) => l === null)) return [];
    const worst = Math.max(...(levels as number[]));
    const starts = ix.names.some((n) => n.startsWith(q) || n.startsWith(qBare));
    return [{ item, index, tier: starts ? 0 : worst === 0 ? 1 : worst === 1 ? 2 : 3, dist: 0 }];
  });
  if (exact.length > 0) return { items: ranked(exact), suggestion: null, terms: [...terms] };

  // Nothing as typed: allow a slip in each word that found nothing.
  const offers = new Map<string, Near>();
  const close = items.flatMap((item, index) => {
    const ix = indexOf(item);
    let dist = 0;
    for (const w of typed) {
      if (matchWord(ix, w) !== null) continue;
      const near = nearWord(ix, w);
      if (!near) return [];
      dist += near.dist;
      terms.add(near.slice);
      const known = offers.get(w);
      if (!known || near.dist < known.dist || (near.dist === known.dist && near.inName && !known.inName)) offers.set(w, near);
    }
    return [{ item, index, tier: 4, dist }];
  });
  if (close.length === 0) return { items: [], suggestion: null, terms: [] };
  // The query as the customer wrote it, with the slipped words as the menu writes them.
  const raw = query.trim().split(/\s+/);
  const asTyped = raw.map(normalizeSearch).join(" ") === q ? raw : typed;
  const suggestion = typed.map((w, i) => offers.get(w)?.offer ?? asTyped[i]).join(" ");
  return { items: ranked(close), suggestion: normalizeSearch(suggestion) === q ? null : suggestion, terms: [...terms] };
}

/** The items that match, best first. */
export function searchMenu(items: MenuItem[], query: string): MenuItem[] {
  return findInMenu(items, query).items;
}

export type Highlighted = { text: string; hit: boolean }[];

/**
 * `text` cut into pieces, the ones matching `terms` marked. A term counts at
 * the start of a word (after «ال» too), or anywhere once it is 4 letters or
 * more, like the search itself. An Arabic word is marked whole: cutting it
 * into pieces can break how its letters join.
 */
export function highlight(text: string, terms: string[]): Highlighted {
  const wanted = terms.filter(Boolean);
  if (!text || wanted.length === 0) return [{ text, hit: false }];
  // Fold letter by letter, remembering which letter of `text` each folded one came from.
  let folded = "";
  const from: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const f = normalizeSearch(text.charAt(i));
    if (f) {
      for (const c of f) {
        folded += c;
        from.push(i);
      }
    } else if (!MARK.test(text.charAt(i))) {
      folded += " ";
      from.push(i);
    }
  }
  const hit = new Array<boolean>(text.length).fill(false);
  const isLetter = (i: number) => i >= 0 && i < text.length && (MARK.test(text.charAt(i)) || /[\p{L}\p{N}]/u.test(text.charAt(i)));
  for (const term of wanted) {
    for (let at = folded.indexOf(term); at !== -1; at = folded.indexOf(term, at + 1)) {
      const wordStart = folded.lastIndexOf(" ", at - 1) + 1;
      const before = folded.slice(wordStart, at);
      // Inside a word, a short term counts only right after the article.
      if (before && term.length < 4 && stripArticle(before + term) !== term) continue;
      let start = from[at]!;
      let end = from[at + term.length - 1]! + 1;
      if (/[\u0600-\u06FF]/.test(text.slice(start, end))) {
        while (isLetter(start - 1)) start--;
        while (isLetter(end)) end++;
      }
      while (end < text.length && MARK.test(text.charAt(end))) end++;
      hit.fill(true, start, end);
    }
  }
  const pieces: Highlighted = [];
  hit.forEach((on, i) => {
    const last = pieces[pieces.length - 1];
    if (last && last.hit === on) last.text += text.charAt(i);
    else pieces.push({ text: text.charAt(i), hit: on });
  });
  return pieces;
}
