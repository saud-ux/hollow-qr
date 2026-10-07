/** Links from the iOS widget and lock-screen tracker: hollowcoffee://orders/<id>, hollowcoffee://wallet, hollowcoffee://menu. */
export function appLinkPath(url: string): string | null {
  const match = /^hollowcoffee:\/\/(orders\/[0-9a-f-]{36}|wallet|menu)\/?$/i.exec(url.trim());
  return match ? `/${match[1]!.toLowerCase()}` : null;
}
