/**
 * Website notifications (Web Push). The service worker (public/sw.js) shows
 * them; this file asks for permission, subscribes the browser and tells the
 * server where to send. The app uses APNs instead (lib/native.ts).
 *
 * Browsers only allow the permission prompt from a tap, so `turnOnWebPush`
 * starts subscribing before it awaits anything: call it straight from a click.
 */
import { apiGet, apiPost } from "./api";
import { currentLang } from "./i18n";
import { isNative } from "./native";
import { needsHomeScreen } from "./pwa";

export type WebPushState =
  /** This browser can't do notifications (or it's the app). */
  | "unsupported"
  /** iPhone Safari: add the site to the home screen first. */
  | "home-screen"
  /** The customer said no in the browser; only its settings can undo that. */
  | "blocked"
  | "off"
  | "on";

export function webPushSupported(): boolean {
  return !isNative && typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

let registration: ServiceWorkerRegistration | null = null;
let serverKey: Uint8Array<ArrayBuffer> | null = null;
let preparing: Promise<void> | null = null;

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Registers the service worker and fetches the server's key, so a later tap can subscribe at once. */
export function prepareWebPush(): Promise<void> {
  if (!webPushSupported()) return Promise.resolve();
  preparing ??= (async () => {
    registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    const { publicKey } = await apiGet<{ publicKey: string }>("/api/web-push/key");
    serverKey = keyBytes(publicKey);
  })().catch((err: unknown) => {
    preparing = null;
    throw err;
  });
  return preparing;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!webPushSupported()) return null;
  const reg = registration ?? (await navigator.serviceWorker.getRegistration("/"));
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function webPushState(): Promise<WebPushState> {
  if (needsHomeScreen()) return "home-screen";
  if (!webPushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission !== "granted") return "off";
  return (await currentSubscription().catch(() => null)) ? "on" : "off";
}

function sendToServer(sub: PushSubscription): Promise<unknown> {
  const json = sub.toJSON();
  return apiPost("/api/me/web-push", { endpoint: json.endpoint, keys: json.keys, lang: currentLang() });
}

/** Call straight from a tap. Resolves to the state it ended in. */
export function turnOnWebPush(): Promise<WebPushState> {
  if (needsHomeScreen()) return Promise.resolve("home-screen");
  if (!webPushSupported()) return Promise.resolve("unsupported");
  // Subscribing shows the prompt; it has to start inside the tap, before any await.
  const started =
    registration && serverKey
      ? registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey })
      : Notification.requestPermission().then(async (permission) => {
          if (permission !== "granted") return null;
          await prepareWebPush();
          return registration!.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey! });
        });
  return started
    .then(async (sub) => {
      if (!sub) return Notification.permission === "denied" ? "blocked" : "off";
      await sendToServer(sub);
      return "on" as const;
    })
    .catch(() => (Notification.permission === "denied" ? "blocked" : "off"));
}

/** This browser stops getting notifications (the permission itself stays). */
export async function turnOffWebPush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await apiPost("/api/me/web-push/remove", { endpoint: sub.endpoint }).catch(() => undefined);
  await sub.unsubscribe().catch(() => false);
}

/** After signing in, or a language change: points this browser's subscription at the signed-in user. */
export async function syncWebPush(): Promise<void> {
  if (!webPushSupported() || Notification.permission !== "granted") return;
  const sub = await currentSubscription();
  if (sub) await sendToServer(sub);
}

/** On sign-out: the next person on this browser shouldn't get this user's updates. */
export async function forgetWebPushOnServer(): Promise<void> {
  const sub = await currentSubscription().catch(() => null);
  if (sub) await apiPost("/api/me/web-push/remove", { endpoint: sub.endpoint }).catch(() => undefined);
}

/** Notification taps open a page: the service worker asks the open tab to route there. */
export function onNotificationOpen(open: (url: string) => void): () => void {
  if (!webPushSupported()) return () => undefined;
  const handler = (e: MessageEvent) => {
    const data = e.data as { type?: string; url?: unknown } | null;
    if (data?.type === "hollow:open" && typeof data.url === "string" && data.url.startsWith("/")) open(data.url);
  };
  navigator.serviceWorker.addEventListener("message", handler);
  return () => navigator.serviceWorker.removeEventListener("message", handler);
}
