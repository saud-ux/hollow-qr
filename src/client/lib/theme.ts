/**
 * Light / dark appearance for the iOS app. "system" (the default) follows the
 * iPhone's setting; the customer can also pin light or dark on My card.
 * The website keeps its light look.
 */
import { isNative } from "./native";

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

function apply() {
  const theme = resolved(getThemeChoice());
  document.documentElement.dataset.theme = theme;
  syncStatusBar(theme);
}

export function setThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // storage blocked: the choice lasts until the app closes
  }
  if (isNative) apply();
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
