/**
 * Arabic / English for the customer screens. "system" (the default) follows
 * the phone's language: Arabic phones get Arabic, any other language gets
 * English. The customer can pin one on My card. Staff screens stay Arabic.
 */
import { createContext, Fragment, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router";

export type Lang = "ar" | "en";
export type LangChoice = "system" | Lang;

const KEY = "hollow.lang";

export function getLangChoice(): LangChoice {
  try {
    const value = localStorage.getItem(KEY);
    return value === "ar" || value === "en" ? value : "system";
  } catch {
    return "system";
  }
}

function systemLang(): Lang {
  const langs = typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
  return (langs[0] ?? "ar").toLowerCase().startsWith("ar") ? "ar" : "en";
}

export function resolveLang(choice: LangChoice): Lang {
  return choice === "system" ? systemLang() : choice;
}

/** The saved choice, cached; changed only by setChoice (an event handler). */
let choiceCache: LangChoice = getLangChoice();

/** The language in use, for code outside React (error messages, prices, dates). */
export function currentLang(): Lang {
  if (typeof location !== "undefined" && isStaffPath(location.pathname)) return "ar";
  return resolveLang(choiceCache);
}

/** Picks the Arabic or English text for the language in use. */
export function tr(ar: string, en: string): string {
  return currentLang() === "en" ? en : ar;
}

/** Staff screens are Arabic whatever the customer chose. */
export function isStaffPath(pathname: string): boolean {
  return pathname.startsWith("/staff");
}

function applyToDocument(lang: Lang) {
  const root = document.documentElement;
  root.lang = lang;
  root.dir = lang === "ar" ? "rtl" : "ltr";
}

/** Runs before the first render so the page never flashes the wrong direction. */
export function initLang(): void {
  applyToDocument(currentLang());
}

interface LangState {
  lang: Lang;
  choice: LangChoice;
  setChoice: (choice: LangChoice) => void;
  /** Arabic or English text for the language in use. */
  t: (ar: string, en: string) => string;
}

const LangContext = createContext<LangState>({ lang: "ar", choice: "system", setChoice: () => undefined, t: (ar) => ar });

/** Lives inside the router: staff pages are always Arabic. */
export function LangProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [choice, setChoiceState] = useState<LangChoice>(getLangChoice);
  const lang: Lang = isStaffPath(pathname) ? "ar" : resolveLang(choice);

  useLayoutEffect(() => applyToDocument(lang), [lang]);

  const setChoice = useCallback((next: LangChoice) => {
    try {
      if (next === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      // storage blocked: the choice lasts until the app closes
    }
    choiceCache = next;
    setChoiceState(next);
  }, []);

  const value = useMemo<LangState>(() => ({ lang, choice, setChoice, t: (ar, en) => (lang === "en" ? en : ar) }), [lang, choice, setChoice]);
  // Keyed by language: every screen re-renders with the new text and direction at once.
  return (
    <LangContext.Provider value={value}>
      <Fragment key={lang}>{children}</Fragment>
    </LangContext.Provider>
  );
}

export function useLang(): LangState {
  return useContext(LangContext);
}
