import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { findInMenu, highlight, normalizeSearch } from "../../shared/menu-search";
import { isOrderable, type MenuItem, type MenuResponse } from "../../shared/ordering";
import { tr } from "../lib/i18n";
import { itemName, itemSubName, subNameDir } from "../lib/menuText";
import { growSearch } from "../lib/motion";
import { tapFeedback } from "../lib/native";
import { AddControl } from "./AddControl";
import { choosesOrigin, OriginSheet } from "./OriginSheet";
import { ProductSheet } from "./ProductSheet";
import { SalePrice } from "./SalePrice";
import { ItemImage } from "./Shop";

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

/** How long the page must be still before the button comes back. */
const SETTLE_MS = 450;

/**
 * The floating «بحث / Search» button above the tab bar. It steps out of the
 * way while the menu is moving and comes back once it stops. The search page
 * grows out of it.
 */
export function SearchPill({ onOpen }: { onOpen: (from: DOMRect) => void }) {
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
        onClick={(e) => {
          tapFeedback();
          onOpen(e.currentTarget.getBoundingClientRect());
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

const RECENT_KEY = "hollow.search.recent";
const RECENT_MAX = 5;

function readRecent(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function writeRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // storage blocked: recent searches just aren't kept
  }
}

/** Ideas for an empty search: the words people search with, then what sells most. Each one finds something. */
function searchIdeas(items: MenuItem[]): string[] {
  const words = [tr("بارد", "Iced"), tr("حار", "Hot"), tr("حلويات", "Desserts")];
  const names = [...items.filter((i) => i.isBestSeller), ...items.filter((i) => !i.isBestSeller)].filter(isOrderable).map(itemName);
  const ideas = words.filter((w) => findInMenu(items, w).items.length > 0);
  for (const name of names) if (ideas.length < 6 && !ideas.includes(name)) ideas.push(name);
  return ideas;
}

/** Text with the matched words marked. */
function Marked({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {highlight(text, terms).map((piece, i) =>
        piece.hit ? (
          <mark key={i} className="search-mark">
            {piece.text}
          </mark>
        ) : (
          <Fragment key={i}>{piece.text}</Fragment>
        ),
      )}
    </>
  );
}

/**
 * Search as a page of its own, over the menu (the cart bar and tabs out of
 * sight): the field at the top, ideas and recent searches until you type,
 * then the results as a list. Typos, everyday words and «ال» are forgiven
 * (shared/menu-search.ts). It grows out of the «بحث» button and folds back
 * into it.
 */
export function SearchScreen({ menu, from, onClose }: { menu: MenuResponse; from: DOMRect | null; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const q = query.trim();
  const found = useMemo(() => (q ? findInMenu(menu.items, q) : null), [menu.items, q]);
  const ideas = useMemo(() => searchIdeas(menu.items), [menu.items]);
  const [recent, setRecent] = useState(readRecent);
  const screenRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const keyboard = useKeyboardInset();
  const closing = useRef(false);

  useLayoutEffect(() => {
    const html = document.documentElement;
    html.classList.add("search-open");
    // Focused in the tap that opened it, so iOS brings the keyboard up.
    inputRef.current?.focus({ preventScroll: true });
    void growSearch(screenRef.current, bodyRef.current, from, true);
    return () => html.classList.remove("search-open");
    // Opens once; `from` is where the tap was.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // New results start from the top.
  useLayoutEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [q]);

  const remember = useCallback((text: string) => {
    const t = text.trim();
    if (!t) return;
    setRecent((list) => {
      const next = [t, ...list.filter((x) => normalizeSearch(x) !== normalizeSearch(t))].slice(0, RECENT_MAX);
      writeRecent(next);
      return next;
    });
  }, []);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    inputRef.current?.blur();
    // Folds back into the button where it is now.
    const button = document.querySelector(".search-pill")?.getBoundingClientRect() ?? from;
    void growSearch(screenRef.current, bodyRef.current, button, false).then(onClose);
  }, [from, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A product sheet open over the results closes first.
      if (e.key === "Escape" && !document.documentElement.classList.contains("sheet-open")) close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  const choose = (text: string) => {
    tapFeedback();
    setQuery(text);
  };

  return createPortal(
    <div ref={screenRef} className="search-screen" role="dialog" aria-modal="true" aria-label={tr("البحث في المنيو", "Search the menu")}>
      <form
        className="search-screen__top"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (found && found.items.length > 0) remember(q);
          // "Search" on the keyboard: put it away so the results are in view.
          inputRef.current?.blur();
        }}
      >
        <label className="search-bar__field">
          <SearchIcon />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr("ابحث في المنيو", "Search the menu")}
            aria-label={tr("ابحث في المنيو", "Search the menu")}
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={60}
          />
          {query && (
            <button
              type="button"
              className="search-bar__clear"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              aria-label={tr("مسح", "Clear")}
            >
              ×
            </button>
          )}
        </label>
        <button type="button" className="search-bar__cancel" onClick={close}>
          {tr("إلغاء", "Cancel")}
        </button>
      </form>
      <div
        ref={bodyRef}
        className="search-screen__body"
        style={keyboard > 0 ? { paddingBottom: keyboard + 24 } : undefined}
        // Dragging the list puts the keyboard away, as in iOS.
        onTouchMove={() => inputRef.current?.blur()}
      >
        {found && (
          <section className="search-found" aria-live="polite">
            {found.suggestion && (
              <p className="search-found__mean">
                {tr("هل تقصد ", "Did you mean ")}
                <button type="button" onClick={() => choose(found.suggestion ?? "")}>
                  {found.suggestion}
                </button>
                {tr("؟", "?")}
              </p>
            )}
            <p className="search-found__count">
              {found.items.length === 0
                ? tr(`لا نتائج لـ «${q}»`, `No results for “${q}”`)
                : found.items.length === 1
                  ? tr("نتيجة واحدة", "1 result")
                  : tr(`${found.items.length} نتائج`, `${found.items.length} results`)}
            </p>
            {found.items.length > 0 && (
              <ul className="search-list">
                {found.items.map((item) => (
                  <SearchRow key={item.id} item={item} terms={found.terms} canOrder={menu.shop.isOpen} onPick={() => remember(q)} />
                ))}
              </ul>
            )}
          </section>
        )}
        {(!found || found.items.length === 0) && (
          <div className="search-ideas">
            {ideas.length > 0 && (
              <section>
                <h2 className="search-screen__label">{found ? tr("جرّب بدلها", "Try instead") : tr("جرّب", "Try")}</h2>
                <div className="search-ideas__chips">
                  {ideas.map((idea) => (
                    <button key={idea} type="button" className="menu-chip" onClick={() => choose(idea)}>
                      {idea}
                    </button>
                  ))}
                </div>
              </section>
            )}
            {!found && recent.length > 0 && (
              <section>
                <div className="search-screen__label-row">
                  <h2 className="search-screen__label">{tr("آخر بحث", "Recent")}</h2>
                  <button
                    type="button"
                    className="search-recent__clear"
                    onClick={() => {
                      setRecent([]);
                      writeRecent([]);
                    }}
                  >
                    {tr("مسح", "Clear")}
                  </button>
                </div>
                <ul className="search-recent">
                  {recent.map((text) => (
                    <li key={text}>
                      <button type="button" onClick={() => choose(text)}>
                        <ClockIcon />
                        <bdi>{text}</bdi>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** One result: tap it for the item's sheet, or add it right here. */
function SearchRow({ item, terms, canOrder, onPick }: { item: MenuItem; terms: string[]; canOrder: boolean; onPick: () => void }) {
  const rowRef = useRef<HTMLLIElement>(null);
  const [open, setOpen] = useState(false);
  // The row the sheet grows out of (and folds back into).
  const [origin, setOrigin] = useState<HTMLElement | null>(null);
  const [choosing, setChoosing] = useState(false);
  const sub = itemSubName(item);
  const show = () => {
    // V60 and the like: the small origin sheet, as from the +.
    if (choosesOrigin(item, canOrder)) {
      setChoosing(true);
      return;
    }
    onPick();
    setOrigin(rowRef.current);
    setOpen(true);
  };
  return (
    <li ref={rowRef} className={`search-row ${isOrderable(item) ? "" : "search-row--soldout"}`}>
      <button type="button" className="search-row__main" onClick={show}>
        <span className="search-row__photo">
          <ItemImage item={item} className="search-row__img" />
        </span>
        <span className="search-row__text">
          <span className="search-row__name">
            <Marked text={itemName(item)} terms={terms} />
          </span>
          {sub && (
            <span className="pass-label search-row__sub" dir={subNameDir()}>
              <Marked text={sub} terms={terms} />
            </span>
          )}
          <span className="search-row__price">
            <SalePrice item={item} />
          </span>
        </span>
      </button>
      <AddControl item={item} canOrder={canOrder} onAdd={onPick} />
      {open && <ProductSheet item={item} canOrder={canOrder} origin={origin} onClose={() => setOpen(false)} />}
      {choosing && <OriginSheet item={item} onClose={() => setChoosing(false)} onAdded={onPick} />}
    </li>
  );
}
