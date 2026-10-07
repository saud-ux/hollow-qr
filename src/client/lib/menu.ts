import { useCallback, useEffect, useState } from "react";
import type { MenuResponse } from "../../shared/ordering";
import { apiGet, errorText } from "./api";
import { currentLang } from "./i18n";

/** Loads the public menu and refreshes it while the page is visible. */
export function useMenu(refreshMs = 60_000) {
  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    () =>
      apiGet<MenuResponse>("/api/menu")
        .then((m) => {
          setMenu(m);
          setError(null);
        })
        .catch((err: unknown) => setError(errorText(err))),
    [],
  );

  useEffect(() => {
    void reload();
    const timer = setInterval(() => document.visibilityState === "visible" && void reload(), refreshMs);
    const onVisible = () => document.visibilityState === "visible" && void reload();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reload, refreshMs]);

  return { menu, error, reload };
}

/** The Saudi Riyal sign; drawn by the bundled "Saudi Riyal" font (styles.css). */
export const RIYAL = "\u20C1";

export function riyals(halalas: number): string {
  const r = halalas / 100;
  const amount = Number.isInteger(r) ? String(r) : r.toFixed(2);
  // The new riyal sign (U+20C1) goes on the left of the amount in both languages.
  return currentLang() === "en" ? `${RIYAL} ${amount}` : `${amount} ${RIYAL}`;
}
