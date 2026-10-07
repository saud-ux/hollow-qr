/**
 * iOS app: the home-screen widget and the lock-screen order tracker (Live
 * Activity). Both live in the HollowWidgets extension; the HollowWidget plugin
 * (ios/App/App/HollowWidgetPlugin.swift) is how the page talks to them.
 * Everything here is a no-op on the website.
 */
import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { isActiveStatus, type Order, type WidgetData } from "../../shared/ordering";
import { apiGet, apiPost } from "./api";
import { currentLang } from "./i18n";
import { apiUrl, isNative } from "./native";

interface HollowWidgetPlugin {
  sync(options: { json: string }): Promise<void>;
  clear(): Promise<void>;
  startOrderActivity(options: { orderId: string; orderNumber: number; fulfillment: string; status: string; lang: string }): Promise<{ started: boolean }>;
  endOrderActivity(options: { orderId: string }): Promise<void>;
  addListener(event: "activityToken", listener: (event: { orderId: string; token: string }) => void): Promise<PluginListenerHandle>;
}

const HollowWidget = registerPlugin<HollowWidgetPlugin>("HollowWidget");

/** The widget reads the API at this address; "" on the website. */
const API_BASE = apiUrl("/").replace(/\/$/, "");

let lastSync = 0;

/**
 * Hands the widget the latest card and order, plus a token to refresh them
 * itself. Called when the app opens, on sign-in, and when an order moves.
 */
export async function refreshWidget(force = false): Promise<void> {
  if (!isNative) return;
  // Several screens ask at once on start-up; one request is enough.
  if (!force && Date.now() - lastSync < 3_000) return;
  lastSync = Date.now();
  try {
    const { token, data } = await apiGet<{ token: string; data: WidgetData }>("/api/me/widget");
    await HollowWidget.sync({ json: JSON.stringify({ ...data, lang: currentLang(), token, apiBase: API_BASE }) });
  } catch {
    // The widget keeps what it had; it refreshes itself later.
  }
}

/** Sign-out: the widget shows "sign in" and any tracker goes away. */
export async function clearWidget(): Promise<void> {
  if (!isNative) return;
  lastSync = 0;
  await HollowWidget.clear().catch(() => undefined);
}

const TRACKED_KEY = "hollow.tracked-orders";

function trackedOrders(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(TRACKED_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Puts an order in progress on the lock screen, once per order (if the
 * customer swipes it away it stays away). The server moves it on from there.
 */
export async function trackOrderOnLockScreen(order: Order): Promise<void> {
  if (!isNative || !isActiveStatus(order.status)) return;
  const tracked = trackedOrders();
  if (tracked.includes(order.id)) return;
  try {
    localStorage.setItem(TRACKED_KEY, JSON.stringify([...tracked, order.id].slice(-20)));
  } catch {
    // storage blocked: it may be offered again next time
  }
  await HollowWidget.startOrderActivity({
    orderId: order.id,
    orderNumber: order.orderNumber,
    fulfillment: order.fulfillment,
    status: order.status,
    lang: currentLang(),
  }).catch(() => undefined);
}

/** The order is done: take it off the lock screen now rather than waiting for the server. */
export function endOrderOnLockScreen(orderId: string): void {
  if (!isNative) return;
  void HollowWidget.endOrderActivity({ orderId }).catch(() => undefined);
}

/** Sends each tracker's push token to the server so it can update it. Call once at start-up. */
export function listenForTrackerTokens(): void {
  if (!isNative) return;
  void HollowWidget.addListener("activityToken", ({ orderId, token }) => {
    void apiPost(`/api/orders/${orderId}/live-activity`, { token, lang: currentLang() }).catch(() => undefined);
  }).catch(() => undefined);
}
