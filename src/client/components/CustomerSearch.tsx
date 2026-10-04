import { useEffect, useId, useState } from "react";
import { Link } from "react-router";
import type { CustomerSearchItem, Paginated } from "../../shared/types";
import { apiGet, errorText } from "../lib/api";
import { useDebouncedValue } from "../lib/hooks";
import { Alert } from "./Field";

const PAGE_SIZE = 10;

/** Debounced, paginated server-side search (never loads all customers). */
export function CustomerSearch({ placeholder }: { placeholder: string }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebouncedValue(query.trim(), 350);
  const [result, setResult] = useState<Paginated<CustomerSearchItem> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = debounced.length >= 2;

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const params = new URLSearchParams({ q: debounced, page: String(page), pageSize: String(PAGE_SIZE) });
    apiGet<Paginated<CustomerSearchItem>>(`/api/staff/customers?${params.toString()}`)
      .then((r) => {
        if (alive) {
          setResult(r);
          setError(null);
        }
      })
      .catch((err: unknown) => alive && setError(errorText(err)));
    return () => {
      alive = false;
    };
  }, [active, debounced, page]);

  const pages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;
  return (
    <div className="search">
      <label htmlFor={id} className="visually-hidden">
        بحث عن عميل
      </label>
      <input
        id={id}
        type="search"
        className="search__input"
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setPage(1);
        }}
        autoComplete="off"
        enterKeyHint="search"
      />
      {error && <Alert tone="error">{error}</Alert>}
      {active && result && (
        <>
          {result.items.length === 0 ? (
            <p className="muted">لا توجد نتائج</p>
          ) : (
            <ul className="search__results">
              {result.items.map((c) => (
                <li key={c.accountId}>
                  <Link to={`/staff/customers/${c.accountId}`} className="search__row">
                    <span className="search__name">{c.displayName}</span>
                    <span dir="ltr" className="search__id">
                      {c.memberId}
                    </span>
                    <span dir="ltr" className="search__email">
                      {c.email}
                    </span>
                    <span className="search__progress" dir="ltr">
                      {c.stampCount} / 5
                    </span>
                    {c.rewardAvailable && <span className="badge badge--gold">مشروب مجاني</span>}
                    {c.membershipStatus === "cancelled" && <span className="badge badge--danger">ملغاة</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {pages > 1 && (
            <div className="pager">
              <button type="button" className="btn btn--small btn--ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                السابق
              </button>
              <span>
                {page} / {pages}
              </span>
              <button type="button" className="btn btn--small btn--ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                التالي
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
