import { Fragment, useEffect, useRef, useState } from "react";
import { matchRanges } from "../../shared/menu-search";
import { tr } from "../lib/i18n";
import { tapFeedback } from "../lib/native";

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

/** How long the page must be still before the button comes back. */
const SETTLE_MS = 450;

/**
 * The floating «بحث / Search» button above the tab bar. It steps out of the
 * way while the menu is moving and comes back once it stops.
 */
export function SearchPill({ onOpen }: { onOpen: () => void }) {
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    let timer: number | undefined;
    const onScroll = () => {
      setMoving(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setMoving(false), SETTLE_MS);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div className="search-pill-row">
      <button
        type="button"
        className={`search-pill ${moving ? "is-away" : ""}`}
        onClick={() => {
          tapFeedback();
          onOpen();
        }}
        tabIndex={moving ? -1 : 0}
      >
        <SearchIcon />
        {tr("بحث", "Search")}
        {/* On a computer, «/» opens the search too. */}
        <kbd className="search-pill__kbd" aria-hidden="true">
          /
        </kbd>
      </button>
    </div>
  );
}

/** Space the on-screen keyboard takes at the bottom (0 when it is closed). */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}

/** Searches to tap instead of typing: this device's recent ones, then the best sellers. */
export interface SearchSuggestions {
  recent: string[];
  popular: string[];
  onClearRecent: () => void;
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

/**
 * The search field: rides just above the keyboard while typing, and above the
 * tab bar once the keyboard is down. The menu filters as you type. Before
 * anything is typed, a row of suggestions sits on top of it.
 */
export function SearchField({
  value,
  onChange,
  onClose,
  onSubmit,
  suggestions,
}: {
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit?: () => void;
  suggestions?: SearchSuggestions;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const keyboard = useKeyboardInset();
  const [dock, setDock] = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
    const el = document.querySelector<HTMLElement>(".shop__dock");
    if (!el) return;
    const measure = () => setDock(el.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    // Esc closes the search, unless it's closing a product opened from the results.
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.documentElement.classList.contains("sheet-open") && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pick = (text: string) => {
    tapFeedback();
    onChange(text);
    inputRef.current?.focus();
  };
  const recent = suggestions?.recent ?? [];
  const popular = (suggestions?.popular ?? []).filter((p) => !recent.includes(p));
  const showChips = value === "" && recent.length + popular.length > 0;

  return (
    <form
      className={`search-bar ${keyboard > 0 ? "is-typing" : ""}`}
      style={{ bottom: keyboard > 0 ? keyboard : dock }}
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.();
        // "Search" on the keyboard: put it away so the results are in view.
        inputRef.current?.blur();
      }}
    >
      {showChips && (
        <div className="search-bar__chips" aria-label={tr("اقتراحات البحث", "Search suggestions")}>
          {recent.map((r) => (
            <button key={`r-${r}`} type="button" className="search-chip" onClick={() => pick(r)}>
              <ClockIcon />
              <bdi>{r}</bdi>
            </button>
          ))}
          {recent.length > 0 && (
            <button
              type="button"
              className="search-chip search-chip--clear"
              onClick={() => {
                suggestions?.onClearRecent();
                inputRef.current?.focus();
              }}
              aria-label={tr("مسح عمليات البحث الأخيرة", "Clear recent searches")}
            >
              {tr("مسح", "Clear")}
            </button>
          )}
          {popular.map((p) => (
            <button key={`p-${p}`} type="button" className="search-chip search-chip--best" onClick={() => pick(p)}>
              <bdi>{p}</bdi>
            </button>
          ))}
        </div>
      )}
      <label className="search-bar__field">
        <SearchIcon />
        <input
          ref={inputRef}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={tr("ابحث في المنيو", "Search the menu")}
          aria-label={tr("ابحث في المنيو", "Search the menu")}
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={60}
        />
        {value && (
          <button
            type="button"
            className="search-bar__clear"
            onClick={() => {
              onChange("");
              inputRef.current?.focus();
            }}
            aria-label={tr("مسح", "Clear")}
          >
            ×
          </button>
        )}
      </label>
      <button type="button" className="search-bar__cancel" onClick={onClose}>
        {tr("إلغاء", "Cancel")}
      </button>
    </form>
  );
}

/** A name with the words that match the search marked. */
export function Highlight({ text, query, nearly = false }: { text: string; query: string; nearly?: boolean }) {
  const ranges = query ? matchRanges(text, query, nearly) : [];
  if (ranges.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach(([start, end], i) => {
    if (start > at) parts.push(<Fragment key={`t${i}`}>{text.slice(at, start)}</Fragment>);
    parts.push(
      <mark key={`m${i}`} className="search-mark">
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  });
  if (at < text.length) parts.push(<Fragment key="end">{text.slice(at)}</Fragment>);
  return <>{parts}</>;
}
