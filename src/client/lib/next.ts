/** Where to go after signing in: only same-site paths, never "//evil.example". */
export function safeNext(search: URLSearchParams, fallback = "/wallet"): string {
  const next = search.get("next");
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : fallback;
}

export function withNext(path: string, next: string): string {
  return `${path}?next=${encodeURIComponent(next)}`;
}
