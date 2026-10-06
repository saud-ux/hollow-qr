import { useCallback, useEffect, useState } from "react";
import type { MenuResponse } from "../../shared/ordering";
import { apiGet, errorText } from "./api";

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

export function riyals(halalas: number): string {
  const r = halalas / 100;
  return `${Number.isInteger(r) ? r : r.toFixed(2)} ريال`;
}
