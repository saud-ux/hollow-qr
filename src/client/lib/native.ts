/**
 * The iOS app (Capacitor) runs this same React build from capacitor://localhost.
 * Everything here is a no-op on the website.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";

export const isNative = Capacitor.isNativePlatform();

/** The Worker the app talks to. The website uses relative /api paths. */
const NATIVE_API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || "https://hollow-rewards.hollowzulfi.workers.dev";

export function apiUrl(path: string): string {
  return isNative && path.startsWith("/") ? `${NATIVE_API_BASE.replace(/\/$/, "")}${path}` : path;
}

/** Native Wallet plugin (ios/App/App/SceneDelegate.swift). */
interface HollowWalletPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  addPass(options: { url: string }): Promise<{ added: boolean; alreadyInWallet?: boolean }>;
}
const HollowWallet = registerPlugin<HollowWalletPlugin>("HollowWallet");

/** Shows Apple's "Add to Wallet" sheet for a signed pass URL. */
export async function addPassNatively(url: string): Promise<{ added: boolean; alreadyInWallet: boolean }> {
  const result = await HollowWallet.addPass({ url });
  return { added: result.added, alreadyInWallet: Boolean(result.alreadyInWallet) };
}

export function tapFeedback(): void {
  if (!isNative) return;
  void import("@capacitor/haptics")
    .then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Light }))
    .catch(() => undefined);
}

export function successFeedback(): void {
  if (!isNative) return;
  void import("@capacitor/haptics")
    .then(({ Haptics, NotificationType }) => Haptics.notification({ type: NotificationType.Success }))
    .catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Push notifications (order status)
// ---------------------------------------------------------------------------

const PUSH_TOKEN_KEY = "hollow.push.token";

function storedPushToken(): string | null {
  try {
    return localStorage.getItem(PUSH_TOKEN_KEY);
  } catch {
    return null;
  }
}

type TokenHandler = (token: string) => void;
let onToken: TokenHandler | null = null;

/**
 * Installs the push listeners once at startup. `register` sends a new token
 * to the server; `open` handles a tapped notification.
 */
export async function initNativePush(handlers: { register: TokenHandler; open: (orderId: string) => void }): Promise<void> {
  if (!isNative) return;
  onToken = handlers.register;
  const { PushNotifications } = await import("@capacitor/push-notifications");
  await PushNotifications.removeAllListeners();
  await PushNotifications.addListener("registration", ({ value }) => {
    try {
      localStorage.setItem(PUSH_TOKEN_KEY, value);
    } catch {
      // storage blocked: the token is still sent below
    }
    onToken?.(value);
  });
  await PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => {
    const orderId = (notification.data as { orderId?: unknown } | undefined)?.orderId;
    if (typeof orderId === "string" && /^[0-9a-f-]{36}$/i.test(orderId)) handlers.open(orderId);
  });
}

/** Asks for permission (iOS shows the prompt only once) and registers. */
export async function enablePush(): Promise<boolean> {
  if (!isNative) return false;
  const { PushNotifications } = await import("@capacitor/push-notifications");
  let status = await PushNotifications.checkPermissions();
  if (status.receive === "prompt" || status.receive === "prompt-with-rationale") {
    status = await PushNotifications.requestPermissions();
  }
  if (status.receive !== "granted") return false;
  await PushNotifications.register();
  return true;
}

/** Re-registers silently when permission was granted earlier (tokens can change). */
export async function refreshPushIfAllowed(): Promise<void> {
  if (!isNative) return;
  const { PushNotifications } = await import("@capacitor/push-notifications");
  const status = await PushNotifications.checkPermissions();
  if (status.receive === "granted") await PushNotifications.register();
}

/** The token to remove from the server on sign-out. */
export function currentPushToken(): string | null {
  return isNative ? storedPushToken() : null;
}

export async function initNativeShell(): Promise<void> {
  if (!isNative) return;
  document.documentElement.classList.add("native");
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: Style.Light });
  } catch {
    // not fatal
  }
}
