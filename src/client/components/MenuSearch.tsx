import { useEffect, useRef, useState } from "react";
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

/**
 * The search field: rides just above the keyboard while typing, and above the
 * tab bar once the keyboard is down. The menu filters as you type.
 */
export function SearchField({ value, onChange, onClose }: { value: string; onChange: (value: string) => void; onClose: () => void }) {
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
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <form
      className={`search-bar ${keyboard > 0 ? "is-typing" : ""}`}
      style={{ bottom: keyboard > 0 ? keyboard : dock }}
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        // "Search" on the keyboard: put it away so the results are in view.
        inputRef.current?.blur();
      }}
    >
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
