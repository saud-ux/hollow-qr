/**
 * The website as an installed app: added to the iPhone home screen, or
 * installed from Chrome. Opened that way it runs full screen ("standalone"),
 * which is also when iPhones allow website notifications.
 */
import { isNative } from "./native";

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || (typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches);
}

/** iPhone or iPad (iPadOS reports itself as a Mac with touch). */
export function isAppleMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** Safari on an iPhone, not added to the home screen yet: notifications need that first. */
export function needsHomeScreen(): boolean {
  return !isNative && isAppleMobile() && !isStandalone();
}

/** Touch gestures the browser doesn't already do: swipe back and pull to refresh. */
export function ownsGestures(): boolean {
  return isNative || isStandalone();
}

// Chrome (Android, computers) offers its own install prompt; we keep it for the Account button.
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let installPrompt: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

let watching = false;

export function watchInstallPrompt(): void {
  if (watching || isNative || typeof window === "undefined") return;
  watching = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt = e as InstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    listeners.forEach((l) => l());
  });
}

export function canPromptInstall(): boolean {
  return installPrompt !== null;
}

export function onInstallChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Shows Chrome's install dialog. */
export async function promptInstall(): Promise<boolean> {
  const event = installPrompt;
  if (!event) return false;
  installPrompt = null;
  listeners.forEach((l) => l());
  await event.prompt();
  return (await event.userChoice).outcome === "accepted";
}

const HINT_KEY = "hollow.homeScreenHint";

/** The iPhone "add to home screen" card is offered once on its own. */
export function homeScreenHintSeen(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return false;
  }
}

export function markHomeScreenHintSeen(): void {
  try {
    localStorage.setItem(HINT_KEY, "1");
  } catch {
    // storage blocked: it may show again, which is harmless
  }
}
