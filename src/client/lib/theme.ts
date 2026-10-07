/**
 * Light / dark appearance for the iOS app. "system" (the default) follows the
 * iPhone's setting; the customer can also pin light or dark on My card.
 * The website keeps its light look.
 */
import { isNative, tapFeedback } from "./native";

export type ThemeChoice = "system" | "light" | "dark";
type Resolved = "light" | "dark";

const KEY = "hollow.theme";
const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;

export function getThemeChoice(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function resolved(choice: ThemeChoice): Resolved {
  if (choice !== "system") return choice;
  return media?.matches ? "dark" : "light";
}

function syncStatusBar(theme: Resolved) {
  void import("@capacitor/status-bar")
    // Style.Dark = light text (for the dark theme), Style.Light = dark text.
    .then(({ StatusBar, Style }) => StatusBar.setStyle({ style: theme === "dark" ? Style.Dark : Style.Light }))
    .catch(() => undefined);
}

const listeners = new Set<(theme: Resolved) => void>();

function apply() {
  const theme = resolved(getThemeChoice());
  document.documentElement.dataset.theme = theme;
  syncStatusBar(theme);
  listeners.forEach((listener) => listener(theme));
}

export function currentTheme(): Resolved {
  return resolved(getThemeChoice());
}

export function onThemeChange(listener: (theme: Resolved) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Where the tap was, so the new theme can spread out from the button. */
export interface RevealOrigin {
  x: number;
  y: number;
}

export function revealOrigin(el: Element): RevealOrigin {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function save(choice: ThemeChoice) {
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // storage blocked: the choice lasts until the app closes
  }
  if (isNative) apply();
}

export function setThemeChoice(choice: ThemeChoice, origin?: RevealOrigin): void {
  const root = document.documentElement;
  const motion = root.classList.contains("motion");
  // The new theme opens as a soft circle from the button (iOS 18+); older
  // iPhones cross-fade the colors instead. Reduce Motion: it simply switches.
  if (motion && origin && typeof document.startViewTransition === "function" && resolved(choice) !== currentTheme()) {
    tapFeedback();
    const transition = document.startViewTransition(async () => {
      save(choice);
      // Let React swap the sun / moon before the new look is captured.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const { x, y } = origin;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    transition.ready
      .then(() => {
        root.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: 650, easing: "cubic-bezier(.2,.8,.2,1)", pseudoElement: "::view-transition-new(root)" },
        );
      })
      .catch(() => undefined);
    return;
  }
  if (motion) {
    root.classList.add("theme-fade");
    setTimeout(() => root.classList.remove("theme-fade"), 450);
  }
  save(choice);
}

/** Runs before the first render so the app never flashes the wrong theme. */
export function initTheme(): void {
  if (!isNative) return;
  document.documentElement.classList.add("native");
  apply();
  media?.addEventListener("change", () => {
    if (getThemeChoice() === "system") apply();
  });
}

/** The header button: flips between light and dark from whatever is showing now. */
export function toggleTheme(origin?: RevealOrigin): void {
  setThemeChoice(currentTheme() === "dark" ? "light" : "dark", origin);
}
