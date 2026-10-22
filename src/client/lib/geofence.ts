/**
 * Nearby alerts (ios/App/App/HollowGeofencePlugin.swift): the iOS app invites
 * the customer in when they come near HOLLOW while it's open, at most once
 * every 12 hours. Everything here is a no-op on the website and Android.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import type { DayHours } from "../../shared/ordering";
import type { Lang } from "./i18n";

export interface NearbyStatus {
  enabled: boolean;
  authorization: "always" | "whenInUse" | "denied" | "restricted" | "notDetermined";
  locationServices: boolean;
  notificationsAllowed: boolean;
  monitoring: boolean;
  hoursKnown: boolean;
  error: string;
}

interface GeofencePlugin {
  getStatus(): Promise<NearbyStatus>;
  start(): Promise<NearbyStatus>;
  stop(): Promise<NearbyStatus>;
  setHours(options: { weeklyHours: DayHours[] }): Promise<void>;
  setLanguage(options: { lang: Lang }): Promise<void>;
  openSettings(): Promise<{ opened: boolean }>;
}

export const Nearby = registerPlugin<GeofencePlugin>("HollowGeofence");

export const nearbyAvailable = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios" && Capacitor.isPluginAvailable("HollowGeofence");

let sentHours = "";

/** Keeps the shop's opening hours on the phone, so an alert never invites anyone in while it's closed. */
export function syncShopHours(weeklyHours: DayHours[]): void {
  if (!nearbyAvailable || weeklyHours.length !== 7) return;
  const key = JSON.stringify(weeklyHours);
  if (key === sentHours) return;
  sentHours = key;
  Nearby.setHours({ weeklyHours }).catch(() => {
    sentHours = "";
  });
}

let sentLang = "";

/** The phone writes the alert itself, even with the app closed, so it keeps the app's language. */
export function syncNearbyLang(lang: Lang): void {
  if (!nearbyAvailable || lang === sentLang) return;
  sentLang = lang;
  Nearby.setLanguage({ lang }).catch(() => {
    sentLang = "";
  });
}
