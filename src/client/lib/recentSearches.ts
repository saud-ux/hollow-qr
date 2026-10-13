/**
 * The last few menu searches on this device, offered again when the search
 * opens. Kept only in this browser; nothing is sent anywhere.
 */
import { normalizeSearch } from "../../shared/menu-search";

const KEY = "hollow.search.recent";
const MAX = 6;

export function recentSearches(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

/** Newest first; typing the same thing again (in any spelling) moves it to the front. */
export function rememberSearch(query: string): string[] {
  const q = query.trim();
  if (!normalizeSearch(q)) return recentSearches();
  const next = [q, ...recentSearches().filter((r) => normalizeSearch(r) !== normalizeSearch(q))].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage blocked: the list just isn't kept
  }
  return next;
}

export function clearRecentSearches(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}
