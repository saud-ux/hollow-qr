/**
 * The order board as its own installed app (Android / Chrome). Chrome lets
 * an installed app play sound without a tap, so the new-order chime is on as
 * soon as the board opens. Staff pages point the page at a separate manifest
 * that opens straight on the board and allows landscape.
 */
import { useEffect, useSyncExternalStore } from "react";

const STAFF_MANIFEST = "/staff.webmanifest";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

// Chrome offers the install once the page qualifies; keep it for our own button.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

/** True when the page runs as an installed app (home-screen icon). */
export function isInstalledApp(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches === true;
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** Whether Chrome can install the orders app right now (it has offered it). */
export function useCanInstall(): boolean {
  return useSyncExternalStore(subscribe, () => deferred !== null, () => false);
}

/** Shows Chrome's install sheet. Resolves true if the user installed it. */
export async function installStaffApp(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  deferred = null;
  notify();
  await event.prompt();
  return (await event.userChoice).outcome === "accepted";
}

/** While a staff page is shown, the page installs as the orders app. */
export function useStaffManifest(): void {
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!link) return;
    const before = link.getAttribute("href");
    link.setAttribute("href", STAFF_MANIFEST);
    return () => {
      if (before) link.setAttribute("href", before);
    };
  }, []);
}
