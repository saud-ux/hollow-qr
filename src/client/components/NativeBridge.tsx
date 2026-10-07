import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { apiPost } from "../lib/api";
import { useAuth } from "../lib/auth";
import { initMotion } from "../lib/motion";
import { currentLang } from "../lib/i18n";
import { appLinkPath } from "../../shared/app-links";
import { initNativePush, initNativeShell, isNative, openWebsite, refreshPushIfAllowed } from "../lib/native";
import { clearWidget, listenForTrackerTokens, refreshWidget } from "../lib/widget";

/** iOS app glue: push registration, notification and widget taps, widget data. Renders nothing. */
export function NativeBridge() {
  const navigate = useNavigate();
  const { session, me } = useAuth();
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
        if (target.kind === "order") void navigate(`/orders/${target.orderId}`);
        else if (target.kind === "menu") void navigate("/menu");
        else openWebsite("/staff/orders");
      },
    }).catch(() => undefined);
    listenForTrackerTokens();
    let removeLinks: (() => void) | null = null;
    void import("@capacitor/app")
      .then(({ App }) =>
        App.addListener("appUrlOpen", ({ url }) => {
          const path = appLinkPath(url);
          if (path) void navigate(path);
        }),
      )
      .then((handle) => (removeLinks = () => void handle.remove()))
      .catch(() => undefined);
    return () => removeLinks?.();
  }, [navigate]);

  // The widget follows the signed-in customer: their cups, their order.
  const stamps = me?.card?.stampCount;
  const reward = me?.card?.rewardAvailable;
  useEffect(() => {
    if (!isNative) return;
    if (userId) void refreshWidget(true);
    else void clearWidget();
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

  return null;
}
