import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { initMotion } from "../lib/motion";
import { currentLang, tr, useLang } from "../lib/i18n";
import { syncNearbyLang } from "../lib/geofence";
import { appLinkPath } from "../../shared/app-links";
import { parseEmailLink } from "../../shared/email-links";
import { useConfig } from "../lib/config";
import { showToast } from "./Toast";
import { initNativePush, initNativeShell, isNative, openWebsite, refreshPushIfAllowed } from "../lib/native";
import { syncWidgetAccount, listenForTrackerTokens, refreshWidget } from "../lib/widget";

// Survives route/language remounts. Store fingerprints, never email credentials.
const completedEmailLinks = new Set<string>();

/** iOS app glue: push registration, notification and widget taps, widget data. Renders nothing. */
export function NativeBridge() {
  const navigate = useNavigate();
  const navigation = useRef(navigate);
  useEffect(() => { navigation.current = navigate; }, [navigate]);
  const { session, me, completeEmailLink } = useAuth();
  const { appUrl } = useConfig();
  const { lang } = useLang();
  const signedIn = useRef(false);
  const userId = session?.user.id;
  useEffect(() => {
    signedIn.current = Boolean(userId);
  }, [userId]);

  useEffect(() => {
    if (!isNative) return;
    initNativeShell();
    initMotion();
    void initNativePush({
      register: (token) => {
        if (signedIn.current) void apiPost("/api/me/push-devices", { token, lang: currentLang() }).catch(() => undefined);
      },
      open: (target) => {
        if (target.kind === "order") void navigation.current(`/orders/${target.orderId}`);
        else if (target.kind === "menu") void navigation.current("/menu");
        else openWebsite("/staff/orders");
      },
    }).catch(() => undefined);
    listenForTrackerTokens();
    let removeLinks: (() => void) | null = null;
    let cancelled = false;
    let emailWork = Promise.resolve();
    const openUrl = (url: string) => {
      if (cancelled) return;
      const email = parseEmailLink(url, appUrl);
      if (email) {
        emailWork = emailWork.catch(() => undefined).then(async () => {
          if (cancelled) return;
          try {
            const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url));
            const fingerprint = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
            if (cancelled || completedEmailLinks.has(fingerprint)) return;
            if (email.kind !== "session") throw new Error("EMAIL_LINK_INVALID");
            await completeEmailLink(email);
            completedEmailLinks.add(fingerprint);
            if (!cancelled) await navigation.current(email.path, { replace: true });
          } catch {
            if (!cancelled) {
              showToast(tr("الرابط غير صالح أو منتهي الصلاحية. اطلب رابطًا جديدًا.", "This link is invalid or expired. Request a new link."));
              await navigation.current(email.path === "/reset-password" ? "/forgot-password" : "/login", { replace: true });
            }
          }
        });
        return;
      }
      const path = appLinkPath(url);
      if (path) void navigation.current(path);
    };
    void import("@capacitor/app")
      .then(async ({ App }) => {
        const handle = await App.addListener("appUrlOpen", ({ url }) => openUrl(url));
        if (cancelled) { await handle.remove(); return; }
        removeLinks = () => void handle.remove();
        const launch = await App.getLaunchUrl();
        if (launch?.url) openUrl(launch.url);
      })
      .catch(() => undefined);
    return () => { cancelled = true; removeLinks?.(); };
  }, [appUrl, completeEmailLink]);

  // The widget follows the signed-in customer: their cups, their order.
  const stamps = me?.card?.stampCount;
  const reward = me?.card?.rewardAvailable;
  useEffect(() => {
    if (!isNative) return;
    void syncWidgetAccount(userId ?? null);
  }, [userId, stamps, reward]);

  useEffect(() => {
    if (!isNative || !userId) return;
    const onVisible = () => document.visibilityState === "visible" && void refreshWidget();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [userId]);

  // Signing in on a phone that already allowed notifications links it to this
  // user. This also runs after a language change (the app re-renders keyed by
  // language), so order notifications follow the app's language.
  useEffect(() => {
    if (isNative && userId) void refreshPushIfAllowed().catch(() => undefined);
  }, [userId]);

  // Nearby alerts are written in the language the app shows, Arabic or English.
  useEffect(() => {
    syncNearbyLang(lang);
  }, [lang]);

  return null;
}
